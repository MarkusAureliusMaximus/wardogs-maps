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
    grid: false,
  },
  tileLayer: null,
  hillshadeLayer: null,
  hypsometricLayer: null,
  contoursLayer: null,
  contourLabels: null,
  markersLayer: null,
  gridLayer: null,
  czRect: null,
  sampleMarker: null,
  fromPin: null,
  currentSample: null,
  skipClick: false,
  measure: false,
  measureA: null,
  measureB: null,
  measureLine: null,
  czStats: null,
  pinLayer: null,
  pendingShare: null,
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
  if (state.czStats && state.czStats.ok) {
    text +=
      "  CZ " +
      signedMeters(state.czStats.min) +
      "–" +
      signedMeters(state.czStats.max) +
      " m";
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
  if (state.layers.grid && state.gridLayer) {
    state.gridLayer.bringToFront();
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
    refreshCzStats();
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
  refreshCzStats();
}

async function refreshCzStats() {
  if (!state.czRect || !state.mapId) {
    return;
  }
  const b = state.czRect.getBounds();
  const url =
    "/api/cz/stats?map=" +
    encodeURIComponent(state.mapId) +
    "&minX=" +
    b.getWest() +
    "&minY=" +
    b.getSouth() +
    "&maxX=" +
    b.getEast() +
    "&maxY=" +
    b.getNorth();
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return;
    }
    state.czStats = await res.json();
    if (state.currentSample) {
      setReadout(state.currentSample);
    }
  } catch (_err) {
    return;
  }
}

const PINS_KEY = "wardogs-maps-pins";

function readPins() {
  try {
    const list = JSON.parse(localStorage.getItem(PINS_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch (_err) {
    return [];
  }
}

function writePins(list) {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(list));
  } catch (_err) {}
}

function addPersonalPins() {
  if (state.pinLayer && state.map) {
    state.map.removeLayer(state.pinLayer);
  }
  state.pinLayer = null;
  if (!state.map) {
    return;
  }
  const group = L.layerGroup();
  readPins()
    .filter(function (p) {
      return p.mapId === state.mapId;
    })
    .forEach(function (pin) {
      const marker = L.marker(gameLatLng(pin.x, pin.y), {
        title: pin.label || "pin",
        zIndexOffset: 800,
        icon: communityMarkerIcon("mine", pin.label || "pin"),
      });
      marker.on("click", function (ev) {
        L.DomEvent.stop(ev);
        removePin(pin.id);
      });
      group.addLayer(marker);
    });
  state.pinLayer = group;
  group.addTo(state.map);
}

function addPinHere() {
  const s = state.currentSample;
  if (!s || !Number.isFinite(Number(s.x))) {
    return;
  }
  const list = readPins();
  list.push({
    id: Date.now().toString(36),
    mapId: state.mapId,
    x: Number(s.x),
    y: Number(s.y),
    relZ: s.relZ,
    label: "X " + Number(s.x).toFixed(1) + " Y " + Number(s.y).toFixed(1),
  });
  writePins(list);
  addPersonalPins();
}

function removePin(id) {
  writePins(
    readPins().filter(function (p) {
      return p.id !== id;
    })
  );
  addPersonalPins();
}

function parseShare() {
  const q = new URLSearchParams(window.location.search);
  const out = {};
  if (q.get("map")) {
    out.map = q.get("map");
  }
  const x = Number(q.get("x"));
  const y = Number(q.get("y"));
  if (Number.isFinite(x) && Number.isFinite(y)) {
    out.x = x;
    out.y = y;
  }
  const z = Number(q.get("z"));
  if (Number.isFinite(z)) {
    out.z = z;
  }
  return out;
}

function updateShareUrl() {
  const p = new URLSearchParams();
  p.set("map", state.mapId);
  if (state.currentSample && Number.isFinite(Number(state.currentSample.x))) {
    p.set("x", Number(state.currentSample.x).toFixed(2));
    p.set("y", Number(state.currentSample.y).toFixed(2));
  }
  if (state.map) {
    p.set("z", String(state.map.getZoom()));
  }
  history.replaceState(null, "", "?" + p.toString());
}

function copyShareUrl() {
  updateShareUrl();
  const href = window.location.href;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(href);
  }
}

function addKmGrid() {
  if (state.gridLayer) {
    state.map.removeLayer(state.gridLayer);
    state.gridLayer = null;
  }
  if (!state.spec || !state.layers.grid) {
    return;
  }
  const tb = state.spec.tileBounds;
  const step = 10;
  const group = L.layerGroup();
  const style = { color: "#d7e0d4", weight: 1, opacity: 0.28, interactive: false };
  for (let x = Math.ceil(tb.minX / step) * step; x <= tb.maxX; x += step) {
    group.addLayer(
      L.polyline(
        [gameLatLng(x, tb.minY), gameLatLng(x, tb.maxY)],
        style
      )
    );
  }
  for (let y = Math.ceil(tb.minY / step) * step; y <= tb.maxY; y += step) {
    group.addLayer(
      L.polyline(
        [gameLatLng(tb.minX, y), gameLatLng(tb.maxX, y)],
        style
      )
    );
  }
  const startX = Math.ceil(tb.minX / step) * step;
  const startY = Math.ceil(tb.minY / step) * step;
  for (let x = startX, col = 0; x < tb.maxX && col < 26; x += step, col += 1) {
    const letter = String.fromCharCode(65 + col);
    group.addLayer(
      L.tooltip({ permanent: true, direction: "center", className: "grid-label", opacity: 0.85 })
        .setLatLng(gameLatLng(x + 5, tb.maxY - 4))
        .setContent(letter)
    );
  }
  for (let y = startY, row = 1; y < tb.maxY; y += step, row += 1) {
    group.addLayer(
      L.tooltip({ permanent: true, direction: "center", className: "grid-label", opacity: 0.85 })
        .setLatLng(gameLatLng(tb.minX + 4, y + 5))
        .setContent(String(row))
    );
  }
  state.gridLayer = group;
  group.addTo(state.map);
}

function addScaleBar(map) {
  const box = L.control({ position: "bottomleft" });
  box.onAdd = function () {
    const el = L.DomUtil.create("div", "wd-scale");
    el.innerHTML = "<i></i><span>1 km</span>";
    box._el = el;
    return el;
  };
  box.addTo(map);
  function update() {
    if (!box._el) {
      return;
    }
    const a = map.latLngToContainerPoint(gameLatLng(0, 0));
    const b = map.latLngToContainerPoint(gameLatLng(10, 0));
    const px = Math.max(24, Math.abs(b.x - a.x));
    const bar = box._el.querySelector("i");
    if (bar) {
      bar.style.width = px + "px";
    }
  }
  map.on("zoomend resize", update);
  setTimeout(update, 0);
}

function copyCoords() {
  const s = state.currentSample;
  if (!s || !Number.isFinite(Number(s.x))) {
    return;
  }
  const text = "X " + Number(s.x).toFixed(2) + "  Y " + Number(s.y).toFixed(2);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text);
  }
}

const PREFS_KEY = "wardogs-maps-prefs";

function savePrefs() {
  try {
    const exag = document.getElementById("exag");
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        mapId: state.mapId,
        tilesStyle: state.tilesStyle,
        layers: state.layers,
        exag: exag ? exag.value : "1",
      })
    );
  } catch (_err) {}
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) {
      return DEFAULT_MAP;
    }
    const p = JSON.parse(raw);
    if (p.tilesStyle) {
      state.tilesStyle = p.tilesStyle;
    }
    if (p.layers) {
      Object.keys(state.layers).forEach(function (k) {
        if (typeof p.layers[k] === "boolean") {
          state.layers[k] = p.layers[k];
        }
      });
    }
    const exag = document.getElementById("exag");
    const exagVal = document.getElementById("exag-val");
    if (exag && p.exag) {
      exag.value = p.exag;
      if (exagVal) {
        const n = Number(p.exag);
        exagVal.textContent = n === 1 ? "×1 true" : "×" + n;
      }
    }
    return p.mapId || DEFAULT_MAP;
  } catch (_err) {
    return DEFAULT_MAP;
  }
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
    refreshCzStats();
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
    updateShareUrl();
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
  hideProfile();
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
  fetchProfile(state.measureA, pt);
}

function hideProfile() {
  const el = document.getElementById("profile");
  if (el) {
    el.setAttribute("hidden", "");
    el.innerHTML = "";
  }
}

function drawProfile(data) {
  const el = document.getElementById("profile");
  if (!el) {
    return;
  }
  if (!data || !data.ok || !data.points) {
    hideProfile();
    return;
  }
  const pts = data.points.filter(function (p) {
    return p.relZ != null;
  });
  if (pts.length < 2) {
    hideProfile();
    return;
  }
  const w = 320;
  const h = 56;
  const pad = 4;
  const lo = data.min;
  const hi = data.max;
  const span = Math.max(1, hi - lo);
  const maxDist = data.lengthM || pts[pts.length - 1].dist || 1;
  let d = "";
  pts.forEach(function (p, i) {
    const x = pad + (p.dist / maxDist) * (w - pad * 2);
    const y = h - pad - ((p.relZ - lo) / span) * (h - pad * 2);
    d += (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
  });
  el.removeAttribute("hidden");
  el.setAttribute("viewBox", "0 0 " + w + " " + h);
  el.innerHTML =
    '<path d="' +
    d +
    '" fill="none" stroke="#7ecbff" stroke-width="2"/>' +
    '<text x="6" y="12" fill="#c8d0c8" font-size="10">' +
    lo.toFixed(0) +
    "–" +
    hi.toFixed(0) +
    " m  Δ" +
    (data.delta >= 0 ? "+" : "") +
    data.delta +
    "</text>";
}

async function fetchProfile(a, b) {
  const url =
    "/api/profile?map=" +
    encodeURIComponent(state.mapId) +
    "&x0=" +
    a.x +
    "&y0=" +
    a.y +
    "&x1=" +
    b.x +
    "&y1=" +
    b.y +
    "&n=80";
  try {
    const res = await fetch(url);
    if (!res.ok) {
      hideProfile();
      return;
    }
    drawProfile(await res.json());
  } catch (_err) {
    hideProfile();
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
  state.gridLayer = null;
  state.pinLayer = null;
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
  addKmGrid();
  addPersonalPins();
  addScaleBar(map);
  map.on("click", onMapClick);
  map.on("zoomend", refreshContourLabels);
  map.on("zoomend moveend", savePrefs);
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
  savePrefs();
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
      savePrefs();
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
      } else if (key === "grid") {
        addKmGrid();
      }
      restackOverlays();
      syncChips();
      savePrefs();
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
      } else if (action === "copy") {
        copyCoords();
      } else if (action === "pin") {
        addPinHere();
      } else if (action === "share") {
        copyShareUrl();
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
      savePrefs();
    });
  }
  window.addEventListener("resize", function () {
    if (state.map) {
      state.map.invalidateSize();
    }
  });
}

bindUi();
const share = parseShare();
const startMap = share.map || loadPrefs();
syncChips();
loadMap(startMap)
  .then(function () {
    if (share.z != null && state.map) {
      state.map.setZoom(share.z);
    }
    if (share.x != null && share.y != null) {
      return sampleAt(share.x, share.y);
    }
    return null;
  })
  .catch(function () {
    setReadout({ ok: false });
  });
