"use strict";

(function () {
  const canvas = document.getElementById("table3d");
  if (!canvas || typeof THREE === "undefined") {
    window.WardogsTable3D = { show: function () {}, hide: function () {} };
    return;
  }

  let renderer = null;
  let scene = null;
  let camera = null;
  let mesh = null;
  let pins = [];
  let raf = 0;
  let active = false;
  let yaw = 0.6;
  let pitch = 0.7;
  let distance = 220;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function ensure() {
    if (renderer) {
      return;
    }
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x05070a, 1);
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x05070a, 90, 720);
    camera = new THREE.PerspectiveCamera(45, 1, 0.05, 3000);
    const hemi = new THREE.HemisphereLight(0xc8d4e0, 0x2a2418, 0.7);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d0, 1.1);
    sun.position.set(-80, 120, 60);
    scene.add(sun);
    const rim = new THREE.PointLight(0x3a6ea8, 0.55, 400);
    rim.position.set(0, 20, 80);
    scene.add(rim);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(118, 128, 48),
      new THREE.MeshBasicMaterial({ color: 0x3a7ebd, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -2;
    scene.add(ring);
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
      distance * Math.sin(yaw) * cp,
      distance * Math.sin(pitch),
      distance * Math.cos(yaw) * cp
    );
    camera.lookAt(0, 8, 0);
  }

  function tick() {
    if (!active) {
      return;
    }
    placeCamera();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }

  function buildMesh(grid, texture) {
    if (mesh) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      if (mesh.material.map) {
        mesh.material.map.dispose();
      }
      mesh.material.dispose();
      mesh = null;
    }
    const n = grid.n;
    const geo = new THREE.PlaneGeometry(160, 160, n - 1, n - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const heights = grid.heights;
    let maxH = 1;
    for (let i = 0; i < heights.length; i++) {
      if (heights[i] != null && heights[i] > maxH) {
        maxH = heights[i];
      }
    }
    const scale = 36 / maxH;
    for (let i = 0; i < pos.count; i++) {
      const h = heights[i];
      const z = h == null ? 0 : h * scale;
      pos.setY(i, z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.88,
      metalness: 0.02,
    });
    mesh = new THREE.Mesh(geo, mat);
    mesh.userData.scale = scale;
    mesh.userData.grid = grid;
    scene.add(mesh);
    return scale;
  }

  function clearPins() {
    pins.forEach(function (obj) {
      scene.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    });
    pins = [];
  }

  function pinColor(kind) {
    if (kind === "tower") return 0xe8c14a;
    if (kind === "valkyra") return 0xc4453c;
    if (kind === "manticore") return 0x3d8a5a;
    if (kind === "lonestar") return 0x3a6ea8;
    if (kind === "spawn_board") return 0xf2efe8;
    if (String(kind).indexOf("vendor") >= 0) return 0xc47a3a;
    return 0xd7a452;
  }

  function heightAt(grid, gx, gy, scale) {
    const n = grid.n;
    const u = (gx - grid.minX) / (grid.maxX - grid.minX);
    const v = (grid.maxY - gy) / (grid.maxY - grid.minY);
    const col = Math.min(n - 1, Math.max(0, Math.round(u * (n - 1))));
    const row = Math.min(n - 1, Math.max(0, Math.round(v * (n - 1))));
    const h = grid.heights[row * n + col];
    return (h == null ? 0 : h) * scale;
  }

  function gameToWorld(grid, gx, gy, scale) {
    const u = (gx - grid.minX) / (grid.maxX - grid.minX);
    const v = (grid.maxY - gy) / (grid.maxY - grid.minY);
    return {
      x: (u - 0.5) * 160,
      y: heightAt(grid, gx, gy, scale),
      z: (v - 0.5) * 160,
    };
  }

  function addPins(grid, spec, scale) {
    clearPins();
    const mpu = spec.coordinateMetersPerUnit || 100;
    (spec.markers || []).forEach(function (m) {
      const gx = Number(m.x) / mpu;
      const gy = Number(m.y) / mpu;
      const p = gameToWorld(grid, gx, gy, scale);
      const color = pinColor(m.icon);
      const isTower = m.icon === "tower";
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(isTower ? 0.35 : 0.28, isTower ? 0.45 : 0.32, 4.2, 8),
        new THREE.MeshStandardMaterial({ color: color, roughness: 0.45 })
      );
      stem.position.set(p.x, p.y + 2.2, p.z);
      scene.add(stem);
      pins.push(stem);
      const head = new THREE.Mesh(
        isTower
          ? new THREE.BoxGeometry(1.1, 1.1, 1.1)
          : new THREE.SphereGeometry(0.7, 10, 8),
        new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.18 })
      );
      head.position.set(p.x, p.y + 4.8, p.z);
      scene.add(head);
      pins.push(head);
    });
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
    texLoader.setCrossOrigin("anonymous");
    const texture = await new Promise(function (resolve, reject) {
      texLoader.load(grid.textureUrl, resolve, undefined, reject);
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    const scale = buildMesh(grid, texture);
    addPins(grid, spec, scale);
  }

  canvas.addEventListener("pointerdown", function (ev) {
    dragging = true;
    lastX = ev.clientX;
    lastY = ev.clientY;
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch (_err) {}
  });
  canvas.addEventListener("pointermove", function (ev) {
    if (!dragging) {
      return;
    }
    const dx = ev.clientX - lastX;
    const dy = ev.clientY - lastY;
    lastX = ev.clientX;
    lastY = ev.clientY;
    yaw -= dx * 0.008;
    pitch = Math.min(1.2, Math.max(0.18, pitch + dy * 0.006));
  });
  canvas.addEventListener("pointerup", function () {
    dragging = false;
  });
  canvas.addEventListener("pointercancel", function () {
    dragging = false;
  });
  canvas.addEventListener(
    "wheel",
    function (ev) {
      ev.preventDefault();
      distance = Math.min(480, Math.max(28, distance + ev.deltaY * 0.12));
    },
    { passive: false }
  );
  window.addEventListener("resize", function () {
    if (active) {
      resize();
    }
  });

  window.WardogsTable3D = {
    show: function (mapId) {
      active = true;
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
  };
})();
