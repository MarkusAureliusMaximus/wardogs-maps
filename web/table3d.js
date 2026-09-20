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
    scene.fog = new THREE.Fog(0x05070a, 180, 520);
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
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
    const scale = 28 / maxH;
    for (let i = 0; i < pos.count; i++) {
      const h = heights[i];
      const z = h == null ? 0 : h * scale;
      pos.setY(i, z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.92,
      metalness: 0.04,
    });
    mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
  }

  async function load(mapId) {
    ensure();
    resize();
    const res = await fetch("/api/heightgrid?map=" + encodeURIComponent(mapId) + "&n=128");
    if (!res.ok) {
      return;
    }
    const grid = await res.json();
    const texLoader = new THREE.TextureLoader();
    texLoader.setCrossOrigin("anonymous");
    const texture = await new Promise(function (resolve, reject) {
      texLoader.load(grid.textureUrl, resolve, undefined, reject);
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    buildMesh(grid, texture);
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
      distance = Math.min(420, Math.max(90, distance + ev.deltaY * 0.12));
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
