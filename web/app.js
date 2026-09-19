"use strict";

const DEFAULT_MAP = "bakurani";
const CZ_GAME_SIZE = 0.20;

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
  markersLayer: null,
  czRect: null,
  sampleMarker: null,
  fromPin: null,
  currentSample: null,
  skipClick: false,
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
  el.textContent = text;
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
      opacity: 1,
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
          color: index ? "#1a1a1a" : "#5a4632",
          weight: index ? 1.6 : 0.8,
          opacity: 0.85,
          fill: false,
        };
      },
    });
    state.contoursLayer.addTo(state.map);
  } catch (_err) {
    state.contoursLayer = null;
  }
}

function communityMarkerIcon(kind) {
  return L.divIcon({
    className: "wd-marker wd-marker-" + (kind || "default"),
    iconSize: [12, 12],
    iconAnchor: [6, 6],
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
      icon: communityMarkerIcon(m.icon),
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

function enableCzDrag(rect) {
  const map = state.map;
  let startLatLng = null;
  let startBounds = null;
  let moved = false;
  let enabled = false;

  function onMove(ev) {
    if (!startLatLng) {
      return;
    }
    const dLat = ev.latlng.lat - startLatLng.lat;
    const dLng = ev.latlng.lng - startLatLng.lng;
    if (dLat !== 0 || dLng !== 0) {
      moved = true;
    }
    const sw = startBounds.getSouthWest();
    const ne = startBounds.getNorthEast();
    rect.setBounds([
      [sw.lat + dLat, sw.lng + dLng],
      [ne.lat + dLat, ne.lng + dLng],
    ]);
  }

  function onUp() {
    if (!startLatLng) {
      return;
    }
    startLatLng = null;
    map.off("mousemove", onMove);
    map.off("mouseup", onUp);
    map.dragging.enable();
    if (moved) {
      state.skipClick = true;
    }
  }

  function onDown(ev) {
    L.DomEvent.stop(ev);
    startLatLng = ev.latlng;
    startBounds = rect.getBounds();
    moved = false;
    map.dragging.disable();
    map.on("mousemove", onMove);
    map.on("mouseup", onUp);
  }

  rect.on("click", function (ev) {
    if (moved || state.skipClick) {
      L.DomEvent.stop(ev);
      state.skipClick = false;
      return;
    }
    onMapClick(ev);
  });

  rect.dragging = {
    enable: function () {
      if (enabled) {
        return;
      }
      enabled = true;
      rect.on("mousedown", onDown);
    },
    disable: function () {
      if (!enabled) {
        return;
      }
      enabled = false;
      rect.off("mousedown", onDown);
    },
  };
  rect.dragging.enable();
}

function addCz() {
  if (state.czRect) {
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

async function onMapClick(ev) {
  if (state.skipClick) {
    state.skipClick = false;
    return;
  }
  await sampleAt(ev.latlng.lng, ev.latlng.lat, ev.latlng);
}

function initLeaflet(spec) {
  const el = document.getElementById("map");
  if (state.map) {
    state.map.remove();
    state.map = null;
  }
  state.tileLayer = null;
  state.hillshadeLayer = null;
  state.hypsometricLayer = null;
  state.contoursLayer = null;
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

function bindUi() {
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
  document.querySelectorAll("[data-action]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const action = btn.getAttribute("data-action");
      if (action === "randomize-cz") {
        randomizeCz();
      } else if (action === "from") {
        setFrom();
      } else if (action === "clear-from") {
        clearFrom();
      }
    });
  });
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
