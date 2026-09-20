"use strict";

(function () {
  const canvas = document.getElementById("table3d");
  if (!canvas || typeof THREE === "undefined") {
    window.WardogsTable3D = {
      show: function () {},
      hide: function () {},
      setExaggeration: function () {},
      setCz: function () {},
    };
    return;
  }

  const TABLE = 160;
  let renderer = null;
  let scene = null;
  let camera = null;
  let mesh = null;
  let czMesh = null;
  let pins = [];
  let raf = 0;
  let active = false;
  let yaw = 0.6;
  let pitch = 0.55;
  let distance = 180;
  let panX = 0;
  let panZ = 0;
  let dragging = false;
  let panning = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;
  let pointerId = null;
  let exaggeration = 1;
  let lastGrid = null;
  let lastSpec = null;
  let lastTexture = null;
  let raycaster = null;

  function ensure() {
    if (renderer) {
      return;
    }
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x05070a, 1);
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x05070a, 70, 800);
    camera = new THREE.PerspectiveCamera(45, 1, 0.05, 4000);
    raycaster = new THREE.Raycaster();
    scene.add(new THREE.HemisphereLight(0xc8d4e0, 0x2a2418, 0.75));
    const sun = new THREE.DirectionalLight(0xfff1d0, 1.05);
    sun.position.set(-90, 140, 70);
    scene.add(sun);
    const rim = new THREE.PointLight(0x3a6ea8, 0.45, 500);
    rim.position.set(0, 24, 90);
    scene.add(rim);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(118, 128, 48),
      new THREE.MeshBasicMaterial({ color: 0x3a7ebd, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.4;
    scene.add(ring);
  }

  function spanMeters(grid) {
    return (grid.maxX - grid.minX) * 100;
  }

  function heightWorld(relZ, grid) {
    return (Number(relZ) / spanMeters(grid)) * TABLE * exaggeration;
  }

  function resize() {
    if (!renderer || !camera) {
      return;
    }
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 800;
    const h = canvas.clientHeight || 500;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }

  function placeCamera() {
    const cp = Math.cos(pitch);
    camera.position.set(
      panX + distance * Math.sin(yaw) * cp,
      distance * Math.sin(pitch),
      panZ + distance * Math.cos(yaw) * cp
    );
    camera.lookAt(panX, 4, panZ);
  }

  function tick() {
    if (!active) {
      return;
    }
    placeCamera();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }

  function applyHeights() {
    if (!mesh || !lastGrid) {
      return 0.01;
    }
    const pos = mesh.geometry.attributes.position;
    const heights = lastGrid.heights;
    let lookY = 0;
    let nHit = 0;
    for (let i = 0; i < pos.count; i++) {
      const h = heights[i];
      const y = h == null ? 0 : heightWorld(h, lastGrid);
      pos.setY(i, y);
      if (h != null) {
        lookY += y;
        nHit += 1;
      }
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    return nHit ? lookY / nHit : 0;
  }

  function buildMesh(grid, texture) {
    if (mesh) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      if (mesh.material.map && mesh.material.map !== texture) {
        mesh.material.map.dispose();
      }
      mesh.material.dispose();
      mesh = null;
    }
    const n = grid.n;
    const geo = new THREE.PlaneGeometry(TABLE, TABLE, n - 1, n - 1);
    geo.rotateX(-Math.PI / 2);
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.88,
      metalness: 0.02,
    });
    mesh = new THREE.Mesh(geo, mat);
    mesh.userData.grid = grid;
    scene.add(mesh);
    lastGrid = grid;
    lastTexture = texture;
    applyHeights();
  }

  function clearPins() {
    pins.forEach(function (obj) {
      scene.remove(obj);
      if (obj.geometry) {
        obj.geometry.dispose();
      }
      if (obj.material) {
        obj.material.dispose();
      }
    });
    pins = [];
  }

  function pinColor(kind) {
    if (kind === "tower") {
      return 0xe8c14a;
    }
    if (kind === "valkyra") {
      return 0xc4453c;
    }
    if (kind === "manticore") {
      return 0x3d8a5a;
    }
    if (kind === "lonestar") {
      return 0x3a6ea8;
    }
    if (kind === "spawn_board") {
      return 0xf2efe8;
    }
    if (String(kind).indexOf("vendor") >= 0) {
      return 0xc47a3a;
    }
    return 0xd7a452;
  }

  function heightAt(grid, gx, gy) {
    const n = grid.n;
    const u = (gx - grid.minX) / (grid.maxX - grid.minX);
    const v = (grid.maxY - gy) / (grid.maxY - grid.minY);
    const col = Math.min(n - 1, Math.max(0, Math.round(u * (n - 1))));
    const row = Math.min(n - 1, Math.max(0, Math.round(v * (n - 1))));
    const h = grid.heights[row * n + col];
    return h == null ? 0 : heightWorld(h, grid);
  }

  function gameToWorld(grid, gx, gy) {
    const u = (gx - grid.minX) / (grid.maxX - grid.minX);
    const v = (grid.maxY - gy) / (grid.maxY - grid.minY);
    return {
      x: (u - 0.5) * TABLE,
      y: heightAt(grid, gx, gy),
      z: (v - 0.5) * TABLE,
    };
  }

  function worldToGame(grid, wx, wz) {
    const u = wx / TABLE + 0.5;
    const v = wz / TABLE + 0.5;
    return {
      x: grid.minX + u * (grid.maxX - grid.minX),
      y: grid.maxY - v * (grid.maxY - grid.minY),
    };
  }

  function addPins(grid, spec) {
    clearPins();
    lastSpec = spec;
    const mpu = spec.coordinateMetersPerUnit || 100;
    (spec.markers || []).forEach(function (m) {
      const gx = Number(m.x) / mpu;
      const gy = Number(m.y) / mpu;
      const p = gameToWorld(grid, gx, gy);
      const kind = m.icon;
      const color = pinColor(kind);
      const isTower = kind === "tower";
      const stemH = isTower ? 2.4 : 1.8;
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(isTower ? 0.18 : 0.14, isTower ? 0.22 : 0.16, stemH, 8),
        new THREE.MeshStandardMaterial({ color: color, roughness: 0.45 })
      );
      stem.position.set(p.x, p.y + stemH / 2, p.z);
      scene.add(stem);
      pins.push(stem);
      const head = new THREE.Mesh(
        isTower
          ? new THREE.BoxGeometry(0.7, 0.7, 0.7)
          : new THREE.SphereGeometry(0.38, 10, 8),
        new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.2 })
      );
      head.position.set(p.x, p.y + stemH + 0.35, p.z);
      scene.add(head);
      pins.push(head);
      if (isTower || kind === "valkyra" || kind === "manticore" || kind === "lonestar") {
        const sprite = makeLabelSprite(m.label || kind, color);
        sprite.position.set(p.x, p.y + stemH + 1.6, p.z);
        scene.add(sprite);
        pins.push(sprite);
      }
    });
  }

  function makeLabelSprite(text, color) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "rgba(13,16,18,0.7)";
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
    ctx.font = "bold 28px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(text), 128, 32);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(8, 2, 1);
    return sprite;
  }

  function refreshPins() {
    if (lastGrid && lastSpec) {
      addPins(lastGrid, lastSpec);
    }
  }

  function setCz(square) {
    if (czMesh) {
      scene.remove(czMesh);
      czMesh.geometry.dispose();
      czMesh.material.dispose();
      czMesh = null;
    }
    if (!square || !lastGrid) {
      return;
    }
    const a = gameToWorld(lastGrid, square.minX, square.minY);
    const b = gameToWorld(lastGrid, square.maxX, square.maxY);
    const w = Math.abs(b.x - a.x);
    const d = Math.abs(b.z - a.z);
    const geo = new THREE.BoxGeometry(Math.max(w, 0.2), 1.2, Math.max(d, 0.2));
    const mat = new THREE.MeshBasicMaterial({
      color: 0xe8c14a,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    czMesh = new THREE.Mesh(geo, mat);
    czMesh.position.set((a.x + b.x) / 2, Math.max(a.y, b.y) + 0.6, (a.z + b.z) / 2);
    scene.add(czMesh);
  }

  async function load(mapId) {
    ensure();
    resize();
    const res = await fetch("/api/heightgrid?map=" + encodeURIComponent(mapId) + "&n=256");
    if (!res.ok) {
      return;
    }
    const grid = await res.json();
    const specRes = await fetch("/maps/" + encodeURIComponent(mapId) + ".json");
    const spec = specRes.ok ? await specRes.json() : { markers: [] };
    const texLoader = new THREE.TextureLoader();
    const texture = await new Promise(function (resolve, reject) {
      texLoader.load(grid.textureUrl, resolve, undefined, reject);
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    buildMesh(grid, texture);
    addPins(grid, spec);
  }

  function sampleClick(ev) {
    if (!mesh || !lastGrid || typeof window.WardogsTable3D.onSample !== "function") {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(mesh);
    if (!hits.length) {
      return;
    }
    const p = hits[0].point;
    const g = worldToGame(lastGrid, p.x, p.z);
    window.WardogsTable3D.onSample(g.x, g.y);
  }

  canvas.addEventListener("pointerdown", function (ev) {
    dragging = true;
    moved = false;
    pointerId = ev.pointerId;
    panning = ev.button === 2 || ev.shiftKey;
    lastX = ev.clientX;
    lastY = ev.clientY;
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch (_err) {}
  });
  canvas.addEventListener("pointermove", function (ev) {
    if (!dragging || ev.pointerId !== pointerId) {
      return;
    }
    const dx = ev.clientX - lastX;
    const dy = ev.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      moved = true;
    }
    lastX = ev.clientX;
    lastY = ev.clientY;
    if (panning) {
      const step = distance * 0.0025;
      panX -= Math.cos(yaw) * dx * step + Math.sin(yaw) * dy * step;
      panZ -= -Math.sin(yaw) * dx * step + Math.cos(yaw) * dy * step;
    } else {
      yaw -= dx * 0.008;
      pitch = Math.min(1.25, Math.max(0.12, pitch + dy * 0.006));
    }
  });
  canvas.addEventListener("pointerup", function (ev) {
    if (pointerId != null && ev.pointerId !== pointerId) {
      return;
    }
    if (dragging && !moved && !panning) {
      sampleClick(ev);
    }
    dragging = false;
    panning = false;
    pointerId = null;
  });
  canvas.addEventListener("pointercancel", function () {
    dragging = false;
    panning = false;
    pointerId = null;
  });
  canvas.addEventListener("contextmenu", function (ev) {
    ev.preventDefault();
  });
  canvas.addEventListener(
    "wheel",
    function (ev) {
      ev.preventDefault();
      distance = Math.min(520, Math.max(18, distance + ev.deltaY * 0.1));
    },
    { passive: false }
  );
  window.addEventListener("resize", function () {
    if (active) {
      resize();
    }
  });

  window.WardogsTable3D = {
    onSample: null,
    show: function (mapId) {
      active = true;
      const slider = document.getElementById("exag");
      if (slider) {
        exaggeration = Number(slider.value) || 1;
      }
      ensure();
      resize();
      load(mapId).catch(function () {});
      cancelAnimationFrame(raf);
      tick();
    },
    hide: function () {
      active = false;
      cancelAnimationFrame(raf);
    },
    setExaggeration: function (value) {
      exaggeration = Math.max(1, Math.min(4, Number(value) || 1));
      applyHeights();
      refreshPins();
    },
    setCz: setCz,
  };
})();
