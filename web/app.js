"use strict";

const DEFAULT_MAP = "bakurani";

const state = {
  mapId: DEFAULT_MAP,
  spec: null,
  map: null,
  tilesStyle: "color",
  layers: {
    hillshade: true,
    hypsometric: false,
    contours: false,
  },
  tileLayer: null,
  hillshadeLayer: null,
  hypsometricLayer: null,
  contoursLayer: null,
  sampleMarker: null,
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

function setReadout(sample) {
  const el = document.getElementById("readout");
  const rel = sample && sample.relZ;
  if (!sample || !sample.ok || rel == null || !Number.isFinite(Number(rel))) {
    el.textContent = "no coverage";
    return;
  }
  const x = Number(sample.x).toFixed(2);
  const y = Number(sample.y).toFixed(2);
  const z = Number(rel);
  const sign = z >= 0 ? "+" : "";
  el.textContent = `X ${x}  Y ${y}  rel ${sign}${z.toFixed(1)} m`;
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

async function onMapClick(ev) {
  const x = ev.latlng.lng;
  const y = ev.latlng.lat;
  placeSample(ev.latlng);
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
    setReadout({ ok: false });
  }
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
  state.sampleMarker = null;

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
      if (key === "markers" || key === "cz") {
        return;
      }
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
      }
      restackOverlays();
      syncChips();
    });
  });
  document.querySelectorAll("[data-action]").forEach(function (btn) {
    btn.addEventListener("click", function () {});
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
