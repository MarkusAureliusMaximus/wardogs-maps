"use strict";

const DEFAULT_MAP = "bakurani";
const CZ_GAME_SIZE = 20.0;
const METERS_PER_UNIT = 100;

const state = {
  mapId: DEFAULT_MAP,
  spec: null,
  map: null,
  tilesStyle: "color",
  layers: {
    hillshade: true,
    hypsometric: false,
    contours: false,
    markers: true,
    cz: true,
  },
  tileLayer: null,
  hillshadeLayer: null,
  hypsometricLayer: null,
  contoursLayer: null,
  contourLabels: null,
  markersLayer: null,
  czRect: null,
  sampleMarker: null,
  fromPin: null,
  currentSample: null,
  skipClick: false,
  measure: false,
  measureA: null,
  measureB: null,
  measureLine: null,
};

function gameLatLng(x, y) {
  return L.latLng(y, x);
}

function tileLatLngBounds(tb) {
  return L.latLngBounds(
    gameLatLng(tb.minX, tb.minY),
    gameLatLng(tb.maxX, tb.maxY)
  );
}

function makeCrs(spec) {
  const tb = spec.tileBounds;
  const tileSize = (spec.tiles && spec.tiles.tileSize) || 256;
  const width = tb.maxX - tb.minX;
  const height = tb.maxY - tb.minY;
  return L.extend({}, L.CRS.Simple, {
    transformation: L.transformation(
      tileSize / width,
      (-tb.minX * tileSize) / width,
      -tileSize / height,
      (tb.maxY * tileSize) / height
    ),
  });
}

function withTemplates(spec) {
  const id = spec.id;
  return Object.assign({}, spec, {
    tileTemplate:
      spec.tileTemplate || `/tiles/${id}/grayscale/{z}/{x}/{y}.webp`,
    colorTileTemplate:
      spec.colorTileTemplate || `/tiles/${id}/color/{z}/{x}/{y}.webp`,
    hillshadeTemplate:
      spec.hillshadeTemplate || `/overlay/${id}/hillshade/{z}/{x}/{y}.png`,
    hypsometricTemplate:
      spec.hypsometricTemplate || `/overlay/${id}/hypsometric/{z}/{x}/{y}.png`,
    contoursUrl: spec.contoursUrl || `/overlay/${id}/contours.geojson`,
  });
}

function tileLayerOptions(spec, extra) {
  const tiles = spec.tiles || {};
  return Object.assign(
    {
      tileSize: tiles.tileSize || 256,
      minZoom: tiles.minZoom ?? 0,
      maxZoom: tiles.maxZoom ?? 7,
      noWrap: true,
      bounds: tileLatLngBounds(spec.tileBounds),
    },
    extra || {}
  );
}

function baseTileUrl(spec) {
  return state.tilesStyle === "gray"
    ? spec.tileTemplate
    : spec.colorTileTemplate;
}

function metresToGame(metres, spec) {
  const mpu = (spec && spec.coordinateMetersPerUnit) || 100;
  return Number(metres) / mpu;
}

function signedMeters(value) {
  const n = Number(value);
  const sign = n >= 0 ? "+" : "";
  return sign + n.toFixed(1);
}

function setReadout(sample) {
  state.currentSample = sample || null;
  const el = document.getElementById("readout");
  if (!sample) {
    el.textContent = "";
    return;
  }
  const x = Number(sample.x);
  const y = Number(sample.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    el.textContent = "no coverage";
    return;
  }
  const coords = "X " + x.toFixed(2) + "  Y " + y.toFixed(2);
  const rel = sample.relZ;
  if (!sample.ok || rel == null || !Number.isFinite(Number(rel))) {
    el.textContent = coords + "  rel —";
    return;
  }
  let text = coords + "  rel " + signedMeters(rel) + " m";
  const fromZ = state.fromPin && state.fromPin.relZ;
  if (fromZ != null && Number.isFinite(Number(fromZ))) {
    text += "  ΔZ " + signedMeters(Number(rel) - Number(fromZ)) + " m";
  }
  if (state.measureA && state.measureB) {
    text += measureText(state.measureA, state.measureB);
  }
  el.textContent = text;
}

function azimuthDeg(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  if (deg < 0) {
    deg += 360;
  }
  return deg;
}

function measureText(a, b) {
  const meters = Math.hypot(b.x - a.x, b.y - a.y) * METERS_PER_UNIT;
  return (
    "  " +
    meters.toFixed(0) +
    " m  " +
    azimuthDeg(a, b).toFixed(0) +
    "°"
  );
}

function placeSample(latlng) {
  if (!state.map) {
    return;
  }
  if (state.sampleMarker) {
    state.sampleMarker.setLatLng(latlng);
    return;
  }
  state.sampleMarker = L.circleMarker(latlng, {
    radius: 6,
    color: "#d7a452",
    weight: 2,
    fillColor: "#fff",
    fillOpacity: 0.95,
  }).addTo(state.map);
}

function restackOverlays() {
  if (!state.map) {
    return;
  }
  if (state.layers.hypsometric && state.hypsometricLayer) {
    state.hypsometricLayer.bringToFront();
  }
  if (state.layers.hillshade && state.hillshadeLayer) {
    state.hillshadeLayer.bringToFront();
  }
  if (state.layers.contours && state.contoursLayer) {
    state.contoursLayer.bringToFront();
  }
  if (state.layers.markers && state.markersLayer) {
    state.markersLayer.bringToFront();
  }
  if (state.layers.cz && state.czRect) {
    state.czRect.bringToFront();
  }
  if (state.sampleMarker) {
    state.sampleMarker.bringToFront();
  }
}

function addBaseTiles() {
  if (state.tileLayer) {
    state.map.removeLayer(state.tileLayer);
  }
  state.tileLayer = L.tileLayer(
    baseTileUrl(state.spec),
    tileLayerOptions(state.spec, { zIndex: 1 })
  ).addTo(state.map);
  restackOverlays();
}

function addHillshade() {
  if (state.hillshadeLayer) {
    state.map.removeLayer(state.hillshadeLayer);
  }
  state.hillshadeLayer = L.tileLayer(
    state.spec.hillshadeTemplate,
    tileLayerOptions(state.spec, {
      className: "layer-hillshade",
      opacity: 0.62,
      zIndex: 3,
    })
  );
  if (state.layers.hillshade) {
    state.hillshadeLayer.addTo(state.map);
  }
}

function addHypsometric() {
  if (state.hypsometricLayer) {
    state.map.removeLayer(state.hypsometricLayer);
  }
  state.hypsometricLayer = L.tileLayer(
    state.spec.hypsometricTemplate,
    tileLayerOptions(state.spec, { zIndex: 2, opacity: 0.9 })
  );
  if (state.layers.hypsometric) {
    state.hypsometricLayer.addTo(state.map);
  }
}

async function addContours() {
  if (state.contourLabels) {
    state.map.removeLayer(state.contourLabels);
    state.contourLabels = null;
  }
  if (state.contoursLayer) {
    state.map.removeLayer(state.contoursLayer);
    state.contoursLayer = null;
  }
  if (!state.layers.contours || !state.spec) {
    return;
  }
  try {
    const res = await fetch(state.spec.contoursUrl);
    if (!res.ok) {
      return;
    }
    const gj = await res.json();
    state.contoursLayer = L.geoJSON(gj, {
      style: function (feat) {
        const index = feat && feat.properties && feat.properties.index;
        return {
          color: index ? "#f0e6c8" : "#c4b48a",
          weight: index ? 1.8 : 0.9,
          opacity: index ? 0.95 : 0.7,
          fill: false,
        };
      },
    });
    state.contoursLayer.addTo(state.map);
    refreshContourLabels();
  } catch (_err) {
    state.contoursLayer = null;
  }
}

function refreshContourLabels() {
  if (state.contourLabels) {
    state.map.removeLayer(state.contourLabels);
    state.contourLabels = null;
  }
  if (!state.map || !state.layers.contours || !state.contoursLayer) {
    return;
  }
  if (state.map.getZoom() < 5) {
    return;
  }
  const group = L.layerGroup();
  let count = 0;
  state.contoursLayer.eachLayer(function (layer) {
    if (count >= 40) {
      return;
    }
    const feat = layer.feature;
    if (!feat || !feat.properties || !feat.properties.index) {
      return;
    }
    const latlngs = layer.getLatLngs ? layer.getLatLngs() : [];
    const flat = latlngs.length && Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
    if (!flat || !flat.length) {
      return;
    }
    const mid = flat[Math.floor(flat.length / 2)];
    const tip = L.tooltip({
      permanent: true,
      direction: "center",
      className: "contour-label",
      opacity: 0.9,
    })
      .setLatLng(mid)
      .setContent(String(feat.properties.level) + " m");
    group.addLayer(tip);
    count += 1;
  });
  state.contourLabels = group;
  group.addTo(state.map);
}

function escapeHtml(text) {
  return String(text == null ? "" : text).replace(/[&<>"']/g, function (ch) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
  });
}

function communityMarkerIcon(kind, label) {
  const k = kind || "default";
  return L.divIcon({
    className: "wd-marker-wrap",
    html:
      '<div class="wd-pin wd-pin-' +
      escapeHtml(k) +
      '"></div><span class="wd-pin-label">' +
      escapeHtml(label || "") +
      "</span>",
    iconSize: [140, 22],
    iconAnchor: [8, 11],
  });
}

function addMarkersAndPolygons() {
  if (state.markersLayer) {
    state.map.removeLayer(state.markersLayer);
    state.markersLayer = null;
  }
  if (!state.map || !state.spec) {
    return;
  }
  const spec = state.spec;
  const group = L.layerGroup();
  (spec.markers || []).forEach(function (m) {
    const x = metresToGame(m.x, spec);
    const y = metresToGame(m.y, spec);
    const marker = L.marker([y, x], {
      title: m.label || "",
      icon: communityMarkerIcon(m.icon, m.label),
      zIndexOffset: m.icon === "tower" ? 500 : 200,
    });
    marker.on("click", function (ev) {
      L.DomEvent.stopPropagation(ev);
      sampleAt(x, y, marker.getLatLng());
    });
    group.addLayer(marker);
  });
  (spec.polygons || []).forEach(function (poly) {
    const latlngs = (poly.points || []).map(function (p) {
      return [metresToGame(p.y, spec), metresToGame(p.x, spec)];
    });
    if (latlngs.length < 3) {
      return;
    }
    group.addLayer(
      L.polygon(latlngs, {
        color: poly.color || "#d7a452",
        weight: poly.strokeWidth || 2,
        fillOpacity: poly.fillOpacity == null ? 0.12 : poly.fillOpacity,
        dashArray: poly.dashed === false ? null : "6 4",
        interactive: false,
      })
    );
  });
  state.markersLayer = group;
  if (state.layers.markers) {
    group.addTo(state.map);
  }
}

function czBoundsFromSquare(square) {
  return L.latLngBounds(
    gameLatLng(square.minX, square.minY),
    gameLatLng(square.maxX, square.maxY)
  );
}

function defaultCzSquare(spec) {
  const b = spec.bounds;
  const minX = (b.minX + b.maxX - CZ_GAME_SIZE) / 2;
  const minY = (b.minY + b.maxY - CZ_GAME_SIZE) / 2;
  return {
    minX: minX,
    minY: minY,
    maxX: minX + CZ_GAME_SIZE,
    maxY: minY + CZ_GAME_SIZE,
  };
}

function clampCzOrigin(minX, minY) {
  const b = state.spec.bounds;
  const size = CZ_GAME_SIZE;
  const maxOriginX = b.maxX - size;
  const maxOriginY = b.maxY - size;
  return {
    minX: Math.min(Math.max(minX, b.minX), maxOriginX),
    minY: Math.min(Math.max(minY, b.minY), maxOriginY),
    maxX: 0,
    maxY: 0,
  };
}

function enableCzDrag(rect) {
  const map = state.map;
  const el = map.getContainer();
  let dragging = false;
  let pointerId = null;
  let startLatLng = null;
  let startMin = null;
  let moved = false;

  function onDown(ev) {
    if (!state.layers.cz || !state.czRect) {
      return;
    }
    if (ev.isPrimary === false) {
      return;
    }
    const latlng = map.mouseEventToLatLng(ev);
    if (!rect.getBounds().contains(latlng)) {
      return;
    }
    ev.preventDefault();
    dragging = true;
    pointerId = ev.pointerId;
    moved = false;
    startLatLng = latlng;
    const bounds = rect.getBounds();
    startMin = { x: bounds.getWest(), y: bounds.getSouth() };
    try {
      el.setPointerCapture(pointerId);
    } catch (_err) {}
    map.dragging.disable();
    if (map.touchZoom) {
      map.touchZoom.disable();
    }
  }

  function onMove(ev) {
    if (!dragging || ev.pointerId !== pointerId) {
      return;
    }
    const latlng = map.mouseEventToLatLng(ev);
    const dx = latlng.lng - startLatLng.lng;
    const dy = latlng.lat - startLatLng.lat;
    if (dx !== 0 || dy !== 0) {
      moved = true;
    }
    const origin = clampCzOrigin(startMin.x + dx, startMin.y + dy);
    origin.maxX = origin.minX + CZ_GAME_SIZE;
    origin.maxY = origin.minY + CZ_GAME_SIZE;
    rect.setBounds(czBoundsFromSquare(origin));
  }

  function onUp(ev) {
    if (!dragging) {
      return;
    }
    if (pointerId != null && ev.pointerId !== pointerId) {
      return;
    }
    dragging = false;
    try {
      el.releasePointerCapture(pointerId);
    } catch (_err) {}
    pointerId = null;
    map.dragging.enable();
    if (map.touchZoom) {
      map.touchZoom.enable();
    }
    if (moved) {
      state.skipClick = true;
    }
    syncCz3d();
  }

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  rect._wdDragCleanup = function () {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
  };
}

function addCz() {
  if (state.czRect) {
    if (state.czRect._wdDragCleanup) {
      state.czRect._wdDragCleanup();
    }
    state.map.removeLayer(state.czRect);
    state.czRect = null;
  }
  if (!state.map || !state.spec) {
    return;
  }
  const rect = L.rectangle(czBoundsFromSquare(defaultCzSquare(state.spec)), {
    color: "#d7a452",
    weight: 2,
    dashArray: "8 6",
    fillColor: "#d7a452",
    fillOpacity: 0.12,
    className: "wd-cz",
    interactive: true,
    bubblingMouseEvents: false,
  });
  enableCzDrag(rect);
  state.czRect = rect;
  if (state.layers.cz) {
    rect.addTo(state.map);
  }
  syncCz3d();
}

function syncCz3d() {
  if (!window.WardogsTable3D || !state.czRect) {
    return;
  }
  const b = state.czRect.getBounds();
  window.WardogsTable3D.setCz({
    minX: b.getWest(),
    minY: b.getSouth(),
    maxX: b.getEast(),
    maxY: b.getNorth(),
  });
}

async function randomizeCz() {
  if (!state.czRect || !state.mapId) {
    return;
  }
  try {
    const res = await fetch(
      "/api/cz/random?map=" + encodeURIComponent(state.mapId)
    );
    if (!res.ok) {
      return;
    }
    const square = await res.json();
    state.czRect.setBounds(czBoundsFromSquare(square));
    syncCz3d();
  } catch (_err) {
    return;
  }
}

function setFrom() {
  if (!state.currentSample) {
    return;
  }
  state.fromPin = Object.assign({}, state.currentSample);
  setReadout(state.currentSample);
}

function clearFrom() {
  state.fromPin = null;
  if (state.currentSample) {
    setReadout(state.currentSample);
  }
}

async function sampleAt(x, y, latlng) {
  placeSample(latlng || gameLatLng(x, y));
  const url =
    "/api/sample?map=" +
    encodeURIComponent(state.mapId) +
    "&x=" +
    encodeURIComponent(x) +
    "&y=" +
    encodeURIComponent(y);
  try {
    const res = await fetch(url);
    const sample = await res.json();
    setReadout(sample);
  } catch (_err) {
    setReadout({ ok: false, x: x, y: y, relZ: null });
  }
}

function clearMeasure() {
  state.measureA = null;
  state.measureB = null;
  if (state.measureLine && state.map) {
    state.map.removeLayer(state.measureLine);
  }
  state.measureLine = null;
}

function onMeasurePoint(x, y) {
  const pt = { x: x, y: y };
  if (!state.measureA || state.measureB) {
    clearMeasure();
    state.measureA = pt;
    return;
  }
  state.measureB = pt;
  if (state.measureLine) {
    state.map.removeLayer(state.measureLine);
  }
  state.measureLine = L.polyline(
    [gameLatLng(state.measureA.x, state.measureA.y), gameLatLng(x, y)],
    { color: "#7ecbff", weight: 2, dashArray: "6 4" }
  ).addTo(state.map);
  if (state.currentSample) {
    setReadout(state.currentSample);
  } else {
    const el = document.getElementById("readout");
    el.textContent = "X " + x.toFixed(2) + "  Y " + y.toFixed(2) + measureText(state.measureA, pt);
  }
}

async function onMapClick(ev) {
  if (state.skipClick) {
    state.skipClick = false;
    return;
  }
  const x = ev.latlng.lng;
  const y = ev.latlng.lat;
  if (state.measure) {
    onMeasurePoint(x, y);
  }
  await sampleAt(x, y, ev.latlng);
}

function initLeaflet(spec) {
  const el = document.getElementById("map");
  if (state.czRect && state.czRect._wdDragCleanup) {
    state.czRect._wdDragCleanup();
  }
  if (state.map) {
    state.map.remove();
    state.map = null;
  }
  state.tileLayer = null;
  state.hillshadeLayer = null;
  state.hypsometricLayer = null;
  state.contoursLayer = null;
  state.contourLabels = null;
  state.markersLayer = null;
  state.czRect = null;
  state.sampleMarker = null;
  state.fromPin = null;
  state.currentSample = null;
  state.skipClick = false;
  const readout = document.getElementById("readout");
  if (readout) {
    readout.textContent = "";
  }

  const tiles = spec.tiles || {};
  const bounds = tileLatLngBounds(spec.tileBounds);
  const map = L.map(el, {
    crs: makeCrs(spec),
    minZoom: tiles.minZoom ?? 0,
    maxZoom: tiles.maxZoom ?? 7,
    maxBounds: bounds,
    maxBoundsViscosity: 1,
    attributionControl: false,
  });
  state.map = map;
  map.fitBounds(bounds);
  map.invalidateSize();
  addBaseTiles();
  addHillshade();
  addHypsometric();
  addContours();
  addMarkersAndPolygons();
  addCz();
  map.on("click", onMapClick);
  map.on("zoomend", refreshContourLabels);
}

async function loadMap(mapId) {
  const res = await fetch("/maps/" + mapId + ".json");
  if (!res.ok) {
    throw new Error("map " + mapId + " " + res.status);
  }
  const spec = withTemplates(await res.json());
  state.mapId = mapId;
  state.spec = spec;
  initLeaflet(spec);
  if (document.getElementById("table3d").classList.contains("visible") && window.WardogsTable3D) {
    window.WardogsTable3D.show(state.mapId);
  }
  document.querySelectorAll("[data-map]").forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-map") === mapId);
  });
}

function syncChips() {
  document.querySelectorAll("[data-tiles]").forEach(function (btn) {
    btn.classList.toggle(
      "active",
      btn.getAttribute("data-tiles") === state.tilesStyle
    );
  });
  document.querySelectorAll("[data-layer]").forEach(function (btn) {
    const key = btn.getAttribute("data-layer");
    if (key in state.layers) {
      btn.classList.toggle("active", !!state.layers[key]);
    }
  });
}

function setView(view) {
  const mapEl = document.getElementById("map");
  const canvas = document.getElementById("table3d");
  document.querySelectorAll("[data-view]").forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-view") === view);
  });
  if (view === "3d") {
    mapEl.classList.add("hidden-view");
    canvas.classList.add("visible");
    if (window.WardogsTable3D) {
      window.WardogsTable3D.show(state.mapId);
      setTimeout(syncCz3d, 600);
    }
  } else {
    canvas.classList.remove("visible");
    mapEl.classList.remove("hidden-view");
    if (window.WardogsTable3D) {
      window.WardogsTable3D.hide();
    }
    if (state.map) {
      state.map.invalidateSize();
    }
  }
}

function bindUi() {
  if (window.WardogsTable3D) {
    window.WardogsTable3D.onSample = function (x, y) {
      sampleAt(x, y);
    };
  }
  document.querySelectorAll("[data-map]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      loadMap(btn.getAttribute("data-map")).catch(function () {
        setReadout({ ok: false });
      });
    });
  });
  document.querySelectorAll("[data-tiles]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.tilesStyle = btn.getAttribute("data-tiles");
      if (state.map && state.spec) {
        addBaseTiles();
      }
      syncChips();
    });
  });
  document.querySelectorAll("[data-layer]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const key = btn.getAttribute("data-layer");
      if (!(key in state.layers) || !state.map || !state.spec) {
        return;
      }
      state.layers[key] = !state.layers[key];
      if (key === "hillshade") {
        if (state.layers.hillshade) {
          state.hillshadeLayer.addTo(state.map);
        } else {
          state.map.removeLayer(state.hillshadeLayer);
        }
      } else if (key === "hypsometric") {
        if (state.layers.hypsometric) {
          state.hypsometricLayer.addTo(state.map);
        } else {
          state.map.removeLayer(state.hypsometricLayer);
        }
      } else if (key === "contours") {
        addContours();
      } else if (key === "markers") {
        if (state.layers.markers) {
          state.markersLayer.addTo(state.map);
        } else {
          state.map.removeLayer(state.markersLayer);
        }
      } else if (key === "cz") {
        if (state.layers.cz) {
          state.czRect.addTo(state.map);
        } else {
          state.map.removeLayer(state.czRect);
        }
      }
      restackOverlays();
      syncChips();
    });
  });
  document.querySelectorAll("[data-view]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const view = btn.getAttribute("data-view");
      setView(view);
    });
  });
  document.querySelectorAll("[data-action]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const action = btn.getAttribute("data-action");
      if (action === "randomize-cz") {
        randomizeCz();
      } else if (action === "from") {
        setFrom();
      } else if (action === "clear-from") {
        clearFrom();
      } else if (action === "measure") {
        state.measure = !state.measure;
        if (!state.measure) {
          clearMeasure();
        }
        btn.classList.toggle("active", state.measure);
      }
    });
  });
  const exag = document.getElementById("exag");
  const exagVal = document.getElementById("exag-val");
  if (exag) {
    exag.addEventListener("input", function () {
      const n = Number(exag.value);
      if (exagVal) {
        exagVal.textContent = n === 1 ? "×1 true" : "×" + n;
      }
      if (window.WardogsTable3D) {
        window.WardogsTable3D.setExaggeration(n);
      }
    });
  }
  window.addEventListener("resize", function () {
    if (state.map) {
      state.map.invalidateSize();
    }
  });
}

bindUi();
syncChips();
loadMap(DEFAULT_MAP).catch(function () {
  setReadout({ ok: false });
});
