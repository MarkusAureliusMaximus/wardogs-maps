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
  let lastMarks = null;
  let measureLine = null;
  let sampleMesh = null;
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
    const north = document.getElementById("north");
    if (north) {
      north.style.transform = "rotate(" + -yaw + "rad)";
    }
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
    if (kind === "mine") {
      return 0x7ecbff;
    }
    if (kind === "enemy-fob" || kind === "enemy") {
      return 0xc4453c;
    }
    if (kind === "friendly-fob") {
      return 0x3a6ea8;
    }
    if (kind === "mortar") {
      return 0x9b59b6;
    }
    if (kind === "aa") {
      return 0x1abc9c;
    }
    if (kind === "loot") {
      return 0xf1c40f;
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

  function metersToWorld(meters, grid) {
    return (Number(meters) / spanMeters(grid)) * TABLE;
  }

  function markSize(kind) {
    if (kind === "enemy-fob" || kind === "friendly-fob") {
      return 40;
    }
    if (kind === "aa" || kind === "mortar") {
      return 22;
    }
    if (kind === "tower") {
      return 18;
    }
    if (kind === "enemy") {
      return 12;
    }
    return 10;
  }

  function addOneMark(gx, gy, kind, label) {
    if (!lastGrid) {
      return;
    }
    const p = gameToWorld(lastGrid, gx, gy);
    const color = pinColor(kind);
    const meters = markSize(kind);
    const s = Math.max(metersToWorld(meters, lastGrid), 0.08);
    const h = s * 1.6;
    const isFob = String(kind).indexOf("fob") >= 0;
    const isTower = kind === "tower";
    const geo = isFob
      ? new THREE.BoxGeometry(s * 1.6, h, s * 1.6)
      : isTower
        ? new THREE.CylinderGeometry(s * 0.35, s * 0.45, h, 8)
        : new THREE.SphereGeometry(s * 0.55, 10, 8);
    const meshMark = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.16, roughness: 0.5 })
    );
    meshMark.position.set(p.x, p.y + h / 2, p.z);
    scene.add(meshMark);
    pins.push(meshMark);
    if (label) {
      const sprite = makeLabelSprite(label, color, s * 8);
      sprite.position.set(p.x, p.y + h + s * 1.2, p.z);
      scene.add(sprite);
      pins.push(sprite);
    }
  }

  function setMarks(marks) {
    lastMarks = marks || lastMarks;
    clearPins();
    if (measureLine) {
      scene.remove(measureLine);
      measureLine.geometry.dispose();
      measureLine.material.dispose();
      measureLine = null;
    }
    if (sampleMesh) {
      scene.remove(sampleMesh);
      sampleMesh.geometry.dispose();
      sampleMesh.material.dispose();
      sampleMesh = null;
    }
    if (!lastGrid || !lastMarks) {
      return;
    }
    (lastMarks.community || []).forEach(function (m) {
      addOneMark(m.x, m.y, m.kind, m.label);
    });
    (lastMarks.pins || []).forEach(function (m) {
      addOneMark(m.x, m.y, "mine", m.label);
    });
    (lastMarks.intel || []).forEach(function (m) {
      addOneMark(m.x, m.y, m.kind, m.label);
    });
    if (lastMarks.measure && lastMarks.measure.a && lastMarks.measure.b) {
      const a = gameToWorld(lastGrid, lastMarks.measure.a.x, lastMarks.measure.a.y);
      const b = gameToWorld(lastGrid, lastMarks.measure.b.x, lastMarks.measure.b.y);
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(a.x, a.y + 0.05, a.z),
        new THREE.Vector3(b.x, b.y + 0.05, b.z),
      ]);
      measureLine = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: 0x7ecbff })
      );
      scene.add(measureLine);
    }
    if (lastMarks.sample && Number.isFinite(Number(lastMarks.sample.x))) {
      const p = gameToWorld(lastGrid, Number(lastMarks.sample.x), Number(lastMarks.sample.y));
      const r = metersToWorld(8, lastGrid);
      sampleMesh = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(r, 0.06), 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      sampleMesh.position.set(p.x, p.y + r, p.z);
      scene.add(sampleMesh);
    }
    if (lastMarks.cz) {
      setCz(lastMarks.cz);
    }
  }

  function makeLabelSprite(text, color, worldW) {
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
    const w = worldW || 0.9;
    sprite.scale.set(w, w * 0.25, 1);
    return sprite;
  }

  function refreshPins() {
    setMarks(lastMarks);
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
    const maxTex = renderer.capabilities.maxTextureSize;
    const z = maxTex >= 8192 ? 5 : 4;
    const texUrl = "/overlay/" + encodeURIComponent(mapId) + "/table-color.jpg?z=" + z;
    const texLoader = new THREE.TextureLoader();
    const texture = await new Promise(function (resolve, reject) {
      texLoader.load(texUrl, resolve, undefined, reject);
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    buildMesh(grid, texture);
    if (typeof window.WardogsTable3D.afterLoad === "function") {
      window.WardogsTable3D.afterLoad();
    }
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
    afterLoad: null,
    setMarks: setMarks,
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
      const north = document.getElementById("north");
      if (north) {
        north.style.transform = "";
      }
    },
    setExaggeration: function (value) {
      exaggeration = Math.max(1, Math.min(4, Number(value) || 1));
      applyHeights();
      refreshPins();
    },
    setCz: setCz,
  };
})();
