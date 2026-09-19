# WARDOGS Map Studio v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a LAN web app at `C:\Users\tater\wardogs-map-studio` that studies Bakurani, Ozeti, and Zestafona using published community tiles and 2 m Terrain3D chunks — never the Steam install or the live client.

**Architecture:** A small Python package (`wardogs_map`) owns coordinates, height decode, downloads, overlay bake, and an `http.server` app. `bake.py` and `server.py` are thin CLIs. A static Leaflet page on the same host is the PC and phone UI. All caches live under `data/` (gitignored).

**Tech Stack:** Python 3.11+, numpy, pillow, qrcode, pytest, Leaflet 1.9 (vendored), no JS build step.

**Work only in:** `C:\Users\tater\wardogs-map-studio`. Do not create or use a git repo inside the WARDOGS Steam folder.

**Confirmed tile URL pattern:** `https://assets.wardogs-artillery.com/releases/assets-v1/maps/tiles/{map}/zoom_{z}/{x}_{y}.webp` (and `maps/tiles-color/{map}/...` for color). Zoom 0 `0_0.webp` returns 200.

---

## File map

| Path | Responsibility |
|------|----------------|
| `wardogs_map/paths.py` | Repo roots: `ROOT`, `MAPS_DIR`, `CACHE_DIR`, `BAKED_DIR`, `WEB_DIR` |
| `wardogs_map/coords.py` | Game XY → chunk key + local quad; coverage check; no clamping |
| `wardogs_map/height.py` | u16 → localZ → worldZ → relZ |
| `wardogs_map/terrain.py` | Load verified chunks, bilinear sample |
| `wardogs_map/cz.py` | 2 km square fully inside `bounds` |
| `wardogs_map/mapspec.py` | Load vendored `maps/*.json` |
| `wardogs_map/download.py` | HTTPS fetch tiles + Terrain3D with retries and sha256 |
| `wardogs_map/overlays.py` | Hillshade, hypsometric PNG tiles, contour GeoJSON |
| `wardogs_map/httpapp.py` | Request handler for static, tiles, overlay, `/api/sample`, `/api/status` |
| `wardogs_map/lan.py` | Private IPv4 list + QR text |
| `server.py` | Bind `0.0.0.0:8765` |
| `bake.py` | `prepare` CLI |
| `maps/*.json` | Vendored community map JSON (markers in metres) |
| `web/` | `index.html`, `app.css`, `app.js`, `ramp.json`, `vendor/leaflet.*` |
| `tests/` | pytest |

Marker `x`/`y` in community JSON are **metres**. Game units = metres / `coordinateMetersPerUnit` (100). Sample API and the sticky bar speak game units.

---

### Task 1: Skeleton, deps, path policy

**Files:**
- Create: `requirements.txt`
- Create: `wardogs_map/__init__.py`
- Create: `wardogs_map/paths.py`
- Create: `tests/test_paths.py`
- Modify: `README.md`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_paths.py
from pathlib import Path
import wardogs_map.paths as paths

def test_roots_live_under_this_repo():
    assert paths.ROOT.name == "wardogs-map-studio"
    assert paths.MAPS_DIR == paths.ROOT / "maps"
    assert paths.CACHE_DIR == paths.ROOT / "data" / "cache"
    assert paths.BAKED_DIR == paths.ROOT / "data" / "baked"
    assert paths.WEB_DIR == paths.ROOT / "web"

def test_python_sources_do_not_name_the_game_install():
    root = Path(__file__).resolve().parents[1]
    banned = ("steamapps", "WardogsClient", "pakchunk", ".ucas", ".utoc")
    for path in root.rglob("*.py"):
        if ".venv" in path.parts or path.parts[-2:] == (".git",):
            continue
        text = path.read_text(encoding="utf-8")
        for token in banned:
            assert token not in text, f"{path} contains {token}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\tater\wardogs-map-studio && python -m pytest tests/test_paths.py -v`

Expected: FAIL (`ModuleNotFoundError: wardogs_map`)

- [ ] **Step 3: Write minimal implementation**

```txt
# requirements.txt
numpy>=2.0
pillow>=10.0
qrcode>=7.4
pytest>=8.0
```

```python
# wardogs_map/__init__.py
"""WARDOGS Map Studio — community terrain only."""
```

```python
# wardogs_map/paths.py
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAPS_DIR = ROOT / "maps"
CACHE_DIR = ROOT / "data" / "cache"
BAKED_DIR = ROOT / "data" / "baked"
WEB_DIR = ROOT / "web"
```

Update `README.md` to say: unofficial, not affiliated with BULKHEAD; run from this folder; never point the app at a game install; `python -m pytest`; `python bake.py prepare`; `python server.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_paths.py -v`

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add requirements.txt wardogs_map/__init__.py wardogs_map/paths.py tests/test_paths.py README.md
git commit -m "feat: add package roots and install-path policy test"
```

---

### Task 2: Game coordinates → chunk location

**Files:**
- Create: `wardogs_map/coords.py`
- Create: `tests/test_coords.py`

Published Bakurani numbers (do not reuse for other maps in production code; tests pass them in):

- `globalQuadOffsetX = 8160`, `globalQuadOffsetY = 14280`
- `gameUnitsToLandscapeQuadsX = 50`, `gameUnitsToLandscapeQuadsY = -50`
- `chunkQuads = 510`
- `chunkXMin/Max = 16/31`, `chunkYMin/Max = 12/27`
- `coverage`: gameX 0..163.2, gameY 0..163.2

- [ ] **Step 1: Write the failing test**

```python
# tests/test_coords.py
from wardogs_map.coords import locate_point

BAKURANI = {
    "globalQuadOffsetX": 8160,
    "globalQuadOffsetY": 14280,
    "gameUnitsToLandscapeQuadsX": 50,
    "gameUnitsToLandscapeQuadsY": -50,
    "chunkQuads": 510,
    "chunkXMin": 16,
    "chunkXMax": 31,
    "chunkYMin": 12,
    "chunkYMax": 27,
    "coverage": {
        "gameXMin": 0,
        "gameXMax": 163.2,
        "gameYMin": 0,
        "gameYMax": 163.2,
    },
}


def test_bakurani_known_point_chunk():
    loc = locate_point(BAKURANI, 81.2, 74.6)
    assert loc is not None
    assert loc.chunk_x == 23
    assert loc.chunk_y == 20
    assert loc.key == "23,20"
    assert abs(loc.local_x - 490.0) < 1e-6
    assert abs(loc.local_y - 350.0) < 1e-6


def test_outside_coverage_is_none_not_clamped():
    assert locate_point(BAKURANI, -1.0, 74.6) is None
    assert locate_point(BAKURANI, 81.2, 200.0) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_coords.py -v`

Expected: FAIL (`cannot import locate_point`)

- [ ] **Step 3: Write minimal implementation**

```python
# wardogs_map/coords.py
from dataclasses import dataclass


@dataclass(frozen=True)
class ChunkLocation:
    chunk_x: int
    chunk_y: int
    local_x: float
    local_y: float

    @property
    def key(self) -> str:
        return f"{self.chunk_x},{self.chunk_y}"


def _axis_scale(manifest: dict, axis: str) -> float:
    specific = manifest.get(f"gameUnitsToLandscapeQuads{axis}")
    if specific is not None and float(specific) != 0:
        return float(specific)
    return float(manifest["gameUnitsToLandscapeQuads"])


def within_coverage(manifest: dict, game_x: float, game_y: float) -> bool:
    cov = manifest.get("coverage")
    if not cov:
        return True
    eps = 1e-7
    return (
        float(cov["gameXMin"]) - eps <= game_x <= float(cov["gameXMax"]) + eps
        and float(cov["gameYMin"]) - eps <= game_y <= float(cov["gameYMax"]) + eps
    )


def locate_point(manifest: dict, game_x: float, game_y: float) -> ChunkLocation | None:
    if not within_coverage(manifest, game_x, game_y):
        return None
    chunk_quads = float(manifest["chunkQuads"])
    quad_x = float(manifest["globalQuadOffsetX"]) + game_x * _axis_scale(manifest, "X")
    quad_y = float(manifest["globalQuadOffsetY"]) + game_y * _axis_scale(manifest, "Y")
    chunk_x = int(quad_x // chunk_quads)
    chunk_y = int(quad_y // chunk_quads)
    if not (
        int(manifest["chunkXMin"]) <= chunk_x <= int(manifest["chunkXMax"])
        and int(manifest["chunkYMin"]) <= chunk_y <= int(manifest["chunkYMax"])
    ):
        return None
    local_x = quad_x - chunk_x * chunk_quads
    local_y = quad_y - chunk_y * chunk_quads
    return ChunkLocation(chunk_x, chunk_y, local_x, local_y)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_coords.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add wardogs_map/coords.py tests/test_coords.py
git commit -m "feat: map game coordinates to Terrain3D chunks"
```

---

### Task 3: Height decode and relative Z

**Files:**
- Create: `wardogs_map/height.py`
- Create: `tests/test_height.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_height.py
from wardogs_map.height import decode_raw, raw_at, rel_z, world_z

def test_raw_at_row_major_le():
    buf = bytes([
        0x01, 0x00, 0x02, 0x00,
        0x03, 0x00, 0x04, 0x00,
    ])
    assert raw_at(buf, side=2, x=0, y=0) == 1
    assert raw_at(buf, side=2, x=1, y=0) == 2
    assert raw_at(buf, side=2, x=0, y=1) == 3
    assert raw_at(buf, side=2, x=1, y=1) == 4

def test_decode_endpoints():
    entry = {"minLocalZ": -10.0, "maxLocalZ": 10.0}
    assert decode_raw(0, entry) == -10.0
    assert decode_raw(65535, entry) == 10.0

def test_world_and_rel_z():
    manifest = {"worldZOffsetMeters": 0.5, "worldZScaleMetersPerLocalUnit": 9}
    wz = world_z(manifest, local_z=-10.0)
    assert abs(wz - (0.5 + -10.0 * 9)) < 1e-9
    assert rel_z(wz, map_min_world_z=wz) == 0.0
    assert rel_z(wz + 12.0, map_min_world_z=wz) == 12.0

def test_higher_raw_means_higher_relz():
    entry = {"minLocalZ": -5.0, "maxLocalZ": 5.0}
    manifest = {"worldZOffsetMeters": 0.0, "worldZScaleMetersPerLocalUnit": 9}
    lo = world_z(manifest, decode_raw(0, entry))
    hi = world_z(manifest, decode_raw(65535, entry))
    assert hi > lo
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_height.py -v`

Expected: FAIL (import)

- [ ] **Step 3: Write minimal implementation**

```python
# wardogs_map/height.py
import struct

def raw_at(buf: bytes, side: int, x: int, y: int) -> int:
    index = y * side + x
    return struct.unpack_from("<H", buf, index * 2)[0]

def decode_raw(raw: int, entry: dict) -> float:
    lo = float(entry["minLocalZ"])
    hi = float(entry["maxLocalZ"])
    return lo + (raw / 65535.0) * (hi - lo)

def world_z(manifest: dict, local_z: float) -> float:
    return float(manifest["worldZOffsetMeters"]) + local_z * float(
        manifest["worldZScaleMetersPerLocalUnit"]
    )

def rel_z(world: float, map_min_world_z: float) -> float:
    return world - map_min_world_z
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_height.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add wardogs_map/height.py tests/test_height.py
git commit -m "feat: decode Terrain3D uint16 heights to relative metres"
```

---

### Task 4: Terrain store bilinear sample

**Files:**
- Create: `wardogs_map/terrain.py`
- Create: `tests/test_terrain.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_terrain.py
import struct
from wardogs_map.terrain import TerrainStore

SIDE = 511
QUADS = 510

def _chunk_bytes(value: int) -> bytes:
    return struct.pack("<" + "H" * (SIDE * SIDE), *([value] * SIDE * SIDE))

def _store(raw: int, min_z: float, max_z: float) -> TerrainStore:
    key = "23,20"
    entry = {
        "file": "chunks/23_20.bin",
        "bytes": SIDE * SIDE * 2,
        "minLocalZ": min_z,
        "maxLocalZ": max_z,
        "sha256": "x",
    }
    manifest = {
        "format": "wardogs-landscape-collision-u16-v1",
        "verticesPerSide": SIDE,
        "chunkQuads": QUADS,
        "globalQuadOffsetX": 8160,
        "globalQuadOffsetY": 14280,
        "gameUnitsToLandscapeQuadsX": 50,
        "gameUnitsToLandscapeQuadsY": -50,
        "chunkXMin": 16,
        "chunkXMax": 31,
        "chunkYMin": 12,
        "chunkYMax": 27,
        "worldZOffsetMeters": 0.5,
        "worldZScaleMetersPerLocalUnit": 9,
        "coverage": {
            "gameXMin": 0, "gameXMax": 163.2,
            "gameYMin": 0, "gameYMax": 163.2,
        },
        "chunks": {key: entry},
    }
    return TerrainStore(
        manifest=manifest,
        chunks={key: _chunk_bytes(raw)},
        map_min_world_z=None,
    )

def test_constant_chunk_sample_ok():
    store = _store(raw=65535, min_z=-10.0, max_z=10.0)
    result = store.sample(81.2, 74.6)
    assert result.ok is True
    assert result.in_coverage is True
    assert result.rel_z == 0.0  # only one worldZ in this store, min==that value

def test_missing_chunk_not_ok():
    store = _store(raw=0, min_z=-1.0, max_z=1.0)
    store.chunks.clear()
    result = store.sample(81.2, 74.6)
    assert result.ok is False
    assert result.rel_z is None
    assert result.in_coverage is True

def test_outside_coverage():
    store = _store(raw=0, min_z=-1.0, max_z=1.0)
    result = store.sample(-5.0, 0.0)
    assert result.ok is False
    assert result.in_coverage is False
    assert result.rel_z is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_terrain.py -v`

Expected: FAIL (import)

- [ ] **Step 3: Write minimal implementation**

```python
# wardogs_map/terrain.py
from dataclasses import dataclass
from wardogs_map.coords import locate_point
from wardogs_map.height import decode_raw, raw_at, rel_z, world_z

@dataclass(frozen=True)
class Sample:
    ok: bool
    in_coverage: bool
    rel_z: float | None
    world_z: float | None


class TerrainStore:
    def __init__(self, manifest: dict, chunks: dict[str, bytes], map_min_world_z: float | None):
        self.manifest = manifest
        self.chunks = chunks
        if map_min_world_z is None:
            self.map_min_world_z = self._compute_min_world()
        else:
            self.map_min_world_z = map_min_world_z

    def _compute_min_world(self) -> float:
        values = []
        for key, buf in self.chunks.items():
            entry = self.manifest["chunks"][key]
            values.append(world_z(self.manifest, float(entry["minLocalZ"])))
            values.append(world_z(self.manifest, float(entry["maxLocalZ"])))
        return min(values) if values else 0.0

    def sample(self, game_x: float, game_y: float) -> Sample:
        loc = locate_point(self.manifest, game_x, game_y)
        if loc is None:
            return Sample(False, False, None, None)
        buf = self.chunks.get(loc.key)
        if buf is None:
            return Sample(False, True, None, None)
        entry = self.manifest["chunks"][loc.key]
        side = int(self.manifest["verticesPerSide"])
        max_v = side - 1
        x0 = min(max(int(loc.local_x), 0), max_v)
        y0 = min(max(int(loc.local_y), 0), max_v)
        x1 = min(x0 + 1, max_v)
        y1 = min(y0 + 1, max_v)
        fx = loc.local_x - x0
        fy = loc.local_y - y0

        def z_at(x, y):
            raw = raw_at(buf, side, x, y)
            return world_z(self.manifest, decode_raw(raw, entry))

        z00, z10, z01, z11 = z_at(x0, y0), z_at(x1, y0), z_at(x0, y1), z_at(x1, y1)
        top = z00 + (z10 - z00) * fx
        bottom = z01 + (z11 - z01) * fx
        wz = top + (bottom - top) * fy
        return Sample(True, True, rel_z(wz, self.map_min_world_z), wz)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_terrain.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add wardogs_map/terrain.py tests/test_terrain.py
git commit -m "feat: bilinear-sample verified Terrain3D chunks"
```

---

### Task 5: Control Zone randomize

**Files:**
- Create: `wardogs_map/cz.py`
- Create: `tests/test_cz.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_cz.py
from wardogs_map.cz import CZ_GAME_SIZE, randomize_cz

BOUNDS = {"minX": 23.35, "maxX": 133.60, "minY": 19.34, "maxY": 129.65}

def test_size_is_two_km():
    assert abs(CZ_GAME_SIZE - 0.20) < 1e-9  # 2 km / 100 m per unit

def test_fifty_draws_stay_inside_bounds():
    for i in range(50):
        square = randomize_cz(BOUNDS, rng_seed=i)
        assert square["maxX"] - square["minX"] == CZ_GAME_SIZE
        assert square["maxY"] - square["minY"] == CZ_GAME_SIZE
        assert square["minX"] >= BOUNDS["minX"] - 1e-9
        assert square["minY"] >= BOUNDS["minY"] - 1e-9
        assert square["maxX"] <= BOUNDS["maxX"] + 1e-9
        assert square["maxY"] <= BOUNDS["maxY"] + 1e-9
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_cz.py -v`

Expected: FAIL (import)

- [ ] **Step 3: Write minimal implementation**

```python
# wardogs_map/cz.py
import random

CZ_GAME_SIZE = 0.20  # 2.00 km at 100 m per game unit

def randomize_cz(bounds: dict, rng_seed: int | None = None) -> dict:
    rng = random.Random(rng_seed)
    span_x = float(bounds["maxX"]) - float(bounds["minX"]) - CZ_GAME_SIZE
    span_y = float(bounds["maxY"]) - float(bounds["minY"]) - CZ_GAME_SIZE
    if span_x < 0 or span_y < 0:
        raise ValueError("bounds smaller than Control Zone")
    min_x = float(bounds["minX"]) + rng.random() * span_x
    min_y = float(bounds["minY"]) + rng.random() * span_y
    return {
        "minX": min_x,
        "minY": min_y,
        "maxX": min_x + CZ_GAME_SIZE,
        "maxY": min_y + CZ_GAME_SIZE,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_cz.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add wardogs_map/cz.py tests/test_cz.py
git commit -m "feat: randomize 2 km Control Zone inside map bounds"
```

---

### Task 6: Vendor map JSON and mapspec loader

**Files:**
- Create: `maps/index.json`
- Create: `maps/bakurani.json`, `maps/ozeti.json`, `maps/zestafona.json` (download, do not hand-type markers)
- Create: `wardogs_map/mapspec.py`
- Create: `tests/test_mapspec.py`

- [ ] **Step 1: Download community map JSON into `maps/`**

Run:

```powershell
New-Item -ItemType Directory -Force maps | Out-Null
$base = "https://raw.githubusercontent.com/apollyon-sys/wardogs-calculator/main/maps"
foreach ($f in @("bakurani.json","ozeti.json","zestafona.json")) {
  Invoke-WebRequest -Uri "$base/$f" -OutFile "maps\$f" -UseBasicParsing
}
```

Write `maps/index.json`:

```json
["bakurani.json", "ozeti.json", "zestafona.json"]
```

Rewrite each map file’s `tiles.path` is **not** required on disk; `mapspec.py` exposes local proxy templates. Keep the upstream JSON as-is plus these extra keys via loader, not by editing source:

- `tileTemplate`: `/tiles/{id}/grayscale/{z}/{x}/{y}.webp`
- `colorTileTemplate`: `/tiles/{id}/color/{z}/{x}/{y}.webp`

- [ ] **Step 2: Write the failing test**

```python
# tests/test_mapspec.py
from wardogs_map.mapspec import load_map, metres_to_game

def test_loads_bakurani_bounds_and_proxy_templates():
    spec = load_map("bakurani")
    assert spec["id"] == "bakurani"
    assert spec["coordinateMetersPerUnit"] == 100
    assert spec["tileTemplate"].startswith("/tiles/bakurani/grayscale/")
    assert spec["bounds"]["minX"] == 23.35

def test_marker_metres_to_game_units():
    assert abs(metres_to_game(8364, 100) - 83.64) < 1e-9
```

- [ ] **Step 3: Run test to verify it fails**

Run: `python -m pytest tests/test_mapspec.py -v`

Expected: FAIL (import)

- [ ] **Step 4: Write minimal implementation**

```python
# wardogs_map/mapspec.py
import json
from wardogs_map.paths import MAPS_DIR

def metres_to_game(metres: float, meters_per_unit: float) -> float:
    return metres / meters_per_unit

def load_map(map_id: str) -> dict:
    path = MAPS_DIR / f"{map_id}.json"
    spec = json.loads(path.read_text(encoding="utf-8"))
    spec["tileTemplate"] = f"/tiles/{map_id}/grayscale/{{z}}/{{x}}/{{y}}.webp"
    spec["colorTileTemplate"] = f"/tiles/{map_id}/color/{{z}}/{{x}}/{{y}}.webp"
    spec["hillshadeTemplate"] = f"/overlay/{map_id}/hillshade/{{z}}/{{x}}/{{y}}.png"
    spec["hypsometricTemplate"] = f"/overlay/{map_id}/hypsometric/{{z}}/{{x}}/{{y}}.png"
    spec["contoursUrl"] = f"/overlay/{map_id}/contours.geojson"
    return spec

def list_map_ids() -> list[str]:
    index = json.loads((MAPS_DIR / "index.json").read_text(encoding="utf-8"))
    return [name.removesuffix(".json") for name in index]
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_mapspec.py -v`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add maps wardogs_map/mapspec.py tests/test_mapspec.py
git commit -m "feat: vendor community map JSON and local tile templates"
```

---

### Task 7: HTTP status, maps, and sample

**Files:**
- Create: `wardogs_map/httpapp.py`
- Create: `server.py`
- Create: `tests/test_http.py`

- [ ] **Step 1: Write the failing test**

Use a temp cache with one READY map and a tiny TerrainStore injected via constructor.

```python
# tests/test_http.py
import json
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from wardogs_map.httpapp import StudioHandler

class _Ctx:
    def __init__(self, stores, status):
        self.stores = stores
        self.status = status

def _serve(handler_cls):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd

def test_status_and_missing_sample(monkeypatch, tmp_path):
    from wardogs_map import httpapp

    class H(StudioHandler):
        context = _Ctx(stores={}, status={"maps": {"bakurani": {"ready": False}}})

    httpd = _serve(H)
    port = httpd.server_address[1]
    conn = HTTPConnection("127.0.0.1", port, timeout=5)
    conn.request("GET", "/api/status")
    res = conn.getresponse()
    assert res.status == 200
    body = json.loads(res.read())
    assert body["maps"]["bakurani"]["ready"] is False
    conn.request("GET", "/api/sample?map=bakurani&x=81.2&y=74.6")
    res = conn.getresponse()
    assert res.status == 200
    sample = json.loads(res.read())
    assert sample["ok"] is False
    httpd.shutdown()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_http.py -v`

Expected: FAIL (import)

- [ ] **Step 3: Write handler + server**

`StudioHandler` (in `wardogs_map/httpapp.py`):

- `GET /` → `WEB_DIR/index.html` (404 until Task 11 adds the file; test does not hit `/` yet)
- `GET /api/status` → JSON from `self.context.status`
- `GET /api/sample?map=&x=&y=` → if store missing, `{ok:false,inCoverage:false,relZ:null,map,x,y}`; else `store.sample` plus those fields
- `GET /maps/index.json` and `GET /maps/{id}.json` from `MAPS_DIR`
- Reject anything but GET with 405
- Never follow `..` in paths (`posixpath.normpath` and ensure result stays under ROOT)

`server.py`:

```python
import argparse
from http.server import ThreadingHTTPServer
from wardogs_map.httpapp import StudioHandler, make_context
from wardogs_map.lan import lan_urls, print_qr

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--host", default="0.0.0.0")
    args = p.parse_args()
    StudioHandler.context = make_context()
    httpd = ThreadingHTTPServer((args.host, args.port), StudioHandler)
    urls = lan_urls(args.port)
    print("WARDOGS Map Studio")
    for u in urls:
        print(u)
    if urls:
        print_qr(urls[-1] if len(urls) > 1 else urls[0])
    else:
        print("No private IPv4 found. Allow Python on Private networks in Windows Firewall.")
    try:
        httpd.serve_forever()
    except OSError as exc:
        raise SystemExit(f"bind failed: {exc}") from exc

if __name__ == "__main__":
    main()
```

For this task, `lan.py` can stub `lan_urls` as `return [f"http://127.0.0.1:{port}"]` and `print_qr` as `print("(qr later)")` — Task 13 replaces them. `make_context()` returns empty stores and `ready: False` for each id in `list_map_ids()` until Task 9 loads chunks.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_http.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add wardogs_map/httpapp.py wardogs_map/lan.py server.py tests/test_http.py
git commit -m "feat: serve status and height sample over HTTP"
```

---

### Task 8: Tile and overlay static routes

**Files:**
- Modify: `wardogs_map/httpapp.py`
- Modify: `tests/test_http.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_http.py`:

```python
def test_tile_and_overlay_and_traversal(tmp_path, monkeypatch):
    from wardogs_map import paths
    monkeypatch.setattr(paths, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(paths, "BAKED_DIR", tmp_path / "baked")
    tile = paths.CACHE_DIR / "tiles" / "bakurani" / "color" / "zoom_0" / "0_0.webp"
    tile.parent.mkdir(parents=True)
    tile.write_bytes(b"RIFF....WEBP")
    overlay = paths.BAKED_DIR / "bakurani" / "hillshade" / "zoom_0" / "0_0.png"
    overlay.parent.mkdir(parents=True)
    overlay.write_bytes(b"\x89PNG")

    class H(StudioHandler):
        context = _Ctx(stores={}, status={"maps": {}})

    httpd = _serve(H)
    port = httpd.server_address[1]
    conn = HTTPConnection("127.0.0.1", port, timeout=5)
    conn.request("GET", "/tiles/bakurani/color/0/0/0.webp")
    assert conn.getresponse().status == 200
    conn.request("GET", "/overlay/bakurani/hillshade/0/0/0.png")
    assert conn.getresponse().status == 200
    conn.request("GET", "/tiles/bakurani/color/0/../0/0.webp")
    assert conn.getresponse().status == 404
    httpd.shutdown()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_http.py::test_tile_and_overlay_and_traversal -v`

Expected: FAIL (404 on tiles)

- [ ] **Step 3: Implement path mapping**

- `/tiles/{map}/{style}/{z}/{x}/{y}.webp` → `CACHE_DIR/tiles/{map}/{style}/zoom_{z}/{x}_{y}.webp`
- `/overlay/{map}/hillshade/{z}/{x}/{y}.png` → `BAKED_DIR/{map}/hillshade/zoom_{z}/{x}_{y}.png`
- same for `hypsometric`
- `/overlay/{map}/contours.geojson` → `BAKED_DIR/{map}/contours.geojson`
- If the resolved path is not inside `CACHE_DIR` or `BAKED_DIR`, 404
- `Content-Type`: `image/webp`, `image/png`, `application/json`

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/test_http.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add wardogs_map/httpapp.py tests/test_http.py
git commit -m "feat: proxy cached tiles and baked overlays"
```

---

### Task 9: Download + verify prepare (no bake yet)

**Files:**
- Create: `wardogs_map/download.py`
- Create: `bake.py`
- Create: `tests/test_download.py`

CDN:

- Tiles: `https://assets.wardogs-artillery.com/releases/assets-v1/maps/tiles/{map}/zoom_{z}/{x}_{y}.webp`
- Color: `.../maps/tiles-color/{map}/zoom_{z}/{x}_{y}.webp`
- Manifest: `https://assets.wardogs-artillery.com/releases/assets-v1/data/terrain/{map}/manifest.json`
- Chunks: URL join of manifest URL + entry `file`

- [ ] **Step 1: Write the failing test** (local HTTP fixture, no real CDN)

```python
# tests/test_download.py
import hashlib
import http.server
import threading
from pathlib import Path
from wardogs_map.download import fetch_file, verify_chunk, save_manifest_chunks

def test_fetch_file_skips_existing_nonzero(tmp_path):
    dest = tmp_path / "a.bin"
    dest.write_bytes(b"hello")
    assert fetch_file("http://127.0.0.1:1/missing", dest) == "skipped"

def test_verify_chunk_sha_and_size(tmp_path):
    data = b"abc"
    p = tmp_path / "c.bin"
    p.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    assert verify_chunk(p, bytes_expected=3, sha256_hex=digest) is True
    assert verify_chunk(p, bytes_expected=9, sha256_hex=digest) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_download.py -v`

Expected: FAIL (import)

- [ ] **Step 3: Implement download helpers and `bake.py prepare`**

`fetch_file(url, dest)`: if dest exists and `stat().st_size > 0`, return `"skipped"`. Else GET with two retries on status >=500 or timeout (urllib). Write to `dest.with_suffix(".part")` then replace. Return `"ok"` or `"fail"`.

`verify_chunk`: size match and sha256 hex digest match.

`prepare_map(map_id)`:

1. mkdir cache dirs
2. For z in 0..7, for x,y in 0..2^z-1, fetch grayscale and color into `CACHE_DIR/tiles/{map_id}/{style}/zoom_{z}/{x}_{y}.webp`
3. Fetch manifest to `CACHE_DIR/terrain/{map_id}/manifest.json`
4. For each chunk entry: download, verify; on failure delete file and record; do not keep bad bytes
5. If zero chunks verified, return False
6. Do not bake overlays yet; write `BAKED_DIR/{map_id}/height-stats.json` with min/max world Z from verified entries’ minLocalZ/maxLocalZ (no need to read bins for stats)

`bake.py`:

```python
import sys
from wardogs_map.download import prepare_all
from wardogs_map.mapspec import list_map_ids

def main():
    if len(sys.argv) < 2 or sys.argv[1] != "prepare":
        raise SystemExit("usage: python bake.py prepare")
    ok = prepare_all(list_map_ids())
    raise SystemExit(0 if ok else 1)

if __name__ == "__main__":
    main()
```

Print progress: `print(f"{map_id} zoom {z} tile {i}/{n}", flush=True)`.

- [ ] **Step 4: Run unit tests**

Run: `python -m pytest tests/test_download.py -v`

Expected: PASS

Do **not** run a full CDN prepare in this task.

- [ ] **Step 5: Commit**

```bash
git add wardogs_map/download.py bake.py tests/test_download.py
git commit -m "feat: download and hash-check community tiles and chunks"
```

---

### Task 10: Overlay bake (hillshade, hypsometric, contours)

**Files:**
- Create: `wardogs_map/overlays.py`
- Create: `web/ramp.json`
- Create: `tests/test_overlays.py`
- Modify: `wardogs_map/download.py` or `bake.py` to call bake after verify

- [ ] **Step 1: Write the failing test**

```python
# tests/test_overlays.py
import json
import numpy as np
from PIL import Image
from wardogs_map.overlays import hillshade, hypsometric_rgba, contours_geojson, write_png_tile

def test_hillshade_not_flat_on_ramp():
    z = np.tile(np.linspace(0, 10, 16), (16, 1))
    hs = hillshade(z, cell_m=2.0)
    assert hs.min() < hs.max()

def test_hypsometric_low_is_blueish():
    rgba = hypsometric_rgba(np.array([[0.0, 1.0]]), vmin=0.0, vmax=1.0)
    assert rgba[0, 0, 2] > rgba[0, 0, 0]  # more blue than red at low

def test_contours_have_index_flag(tmp_path):
    z = np.zeros((8, 8))
    z[:, 4:] = 25.0
    gj = contours_geojson(z, origin_x=0.0, origin_y=0.0, step_game=0.02, interval=20.0)
    assert gj["features"]
    assert any(f["properties"].get("index") for f in gj["features"]) or True
    # index is 100 m; 20 m lines still required
    assert any(f["properties"]["level"] == 20.0 for f in gj["features"])

def test_write_png_tile(tmp_path):
    arr = np.zeros((256, 256), dtype=np.uint8)
    path = tmp_path / "0_0.png"
    write_png_tile(path, arr)
    im = Image.open(path)
    assert im.size == (256, 256)
```

`web/ramp.json`:

```json
{
  "stops": [
    [0.00, [27, 77, 110]],
    [0.25, [61, 138, 90]],
    [0.50, [200, 196, 90]],
    [0.75, [196, 122, 58]],
    [1.00, [242, 239, 232]]
  ]
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_overlays.py -v`

Expected: FAIL (import)

- [ ] **Step 3: Implement overlays**

- `hillshade(z, cell_m)`: Horn slopes, sun azimuth 315°, altitude 45°, output uint8 0–255.
- `hypsometric_rgba(z, vmin, vmax)`: interpolate `web/ramp.json` (load from `paths.WEB_DIR / "ramp.json"`), alpha 0 where z is NaN.
- `contours_geojson`: marching squares at 20 m levels; property `level`; `index: true` when `level % 100 == 0`. Coordinates in **game units** using `origin` + `col * step_game` / `row * step_game`. `step_game = vertexSpacingMeters / coordinateMetersPerUnit` = 2/100 = 0.02.
- `bake_map(map_id, store, spec)`: for z=0..7 write hillshade and hypsometric PNG tiles covering `tileBounds`; write `contours.geojson`; write `READY` only if zoom-7 hillshade tiles for that grid exist and contours file is non-empty.

For tests, implement the math functions first; `bake_map` can be a later function in the same file. Wire `prepare_all` to call `bake_map` after chunks verify.

Keep bake resumable: skip a PNG that already exists with size > 0.

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/test_overlays.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add wardogs_map/overlays.py web/ramp.json tests/test_overlays.py bake.py wardogs_map/download.py
git commit -m "feat: bake hillshade, hypsometric tiles, and 20 m contours"
```

---

### Task 11: Leaflet page (tiles + hillshade default)

**Files:**
- Create: `web/index.html`
- Create: `web/app.css`
- Create: `web/app.js`
- Create: `web/vendor/leaflet.js` and `web/vendor/leaflet.css` (download Leaflet 1.9.4 into vendor, do not use a public CDN at runtime so the phone only talks to this PC)
- Modify: `tests/test_http.py` with `GET /` → 200

- [ ] **Step 1: Write the failing test**

```python
def test_index_served():
    class H(StudioHandler):
        context = _Ctx(stores={}, status={"maps": {}})
    httpd = _serve(H)
    conn = HTTPConnection("127.0.0.1", httpd.server_address[1], timeout=5)
    conn.request("GET", "/")
    res = conn.getresponse()
    body = res.read()
    assert res.status == 200
    assert b"leaflet" in body.lower()
    httpd.shutdown()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_http.py::test_index_served -v`

Expected: FAIL 404

- [ ] **Step 3: Implement UI**

`index.html`: map `div#map`, top bar with three map buttons (`data-map`), chips: Tiles color/gray, Hillshade, Color, Contours, Markers, CZ, Randomize CZ, From, Clear From. Bottom `#readout`.

`app.js` responsibilities:

- `fetch('/maps/bakurani.json')` (and switcher)
- CRS.Simple, `L.latLng(gameY, gameX)` (y north stored as Leaflet lat)
- `maxBounds` from `tileBounds`
- Color tile layer URL `spec.colorTileTemplate` with `{z}{x}{y}` — Leaflet uses `{z}/{x}/{y}` which matches our server
- Hillshade overlay `spec.hillshadeTemplate`, `className: 'layer-hillshade'`, opacity 1, on by default
- Hypsometric off; contours off (`L.geoJSON` when chip on)
- Click → `GET /api/sample?map=&x=&y=` where x,y are `lng, lat` of the event (game X, game Y)
- Sticky bar: `X 81.20  Y 74.60  rel +42.1 m` or `no coverage`

`app.css`:

```css
.layer-hillshade { mix-blend-mode: multiply; }
#readout {
  position: sticky;
  bottom: 0;
  padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
  font-family: ui-monospace, monospace;
}
```

If multiply looks wrong on a device, fall back in CSS to `mix-blend-mode: normal; opacity: 0.55` — still hillshade, not a new feature.

Serve `/web/*` and also `/vendor/*` from `WEB_DIR`. `/` reads `WEB_DIR/index.html`.

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/test_http.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web wardogs_map/httpapp.py tests/test_http.py
git commit -m "feat: Leaflet study map with default hillshade"
```

---

### Task 12: Markers, CZ, From/To ΔZ

**Files:**
- Modify: `web/app.js`, `web/app.css`
- Create: `tests/test_cz.py` already exists; add a tiny JS-free Python helper test if you extract CZ client math — keep CZ math in Python only for randomize via `GET /api/cz/random?map=`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_http.py`:

```python
def test_random_cz_inside_bounds():
    class H(StudioHandler):
        context = _Ctx(stores={}, status={"maps": {}})
    httpd = _serve(H)
    conn = HTTPConnection("127.0.0.1", httpd.server_address[1], timeout=5)
    conn.request("GET", "/api/cz/random?map=bakurani")
    res = conn.getresponse()
    assert res.status == 200
    body = json.loads(res.read())
    from wardogs_map.mapspec import load_map
    b = load_map("bakurani")["bounds"]
    assert body["minX"] >= b["minX"]
    assert body["maxX"] <= b["maxX"]
    httpd.shutdown()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_http.py::test_random_cz_inside_bounds -v`

Expected: FAIL 404

- [ ] **Step 3: Implement**

`GET /api/cz/random?map=` uses `randomize_cz(load_map(map_id)["bounds"])`.

Frontend:

- Draw `L.rectangle` 0.20×0.20 game units, dashed gold, draggable (`dragging.enable()` on the rectangle). No corner resize.
- Randomize button fetches `/api/cz/random` and moves the rectangle.
- Markers: for each marker, `L.marker([y/100, x/100])` using `metres_to_game` (metres / 100). Click sets sample pin.
- Polygons from JSON the same way (divide x,y by 100).
- From button: copies current sample to `fromPin`. Readout adds `ΔZ ±n.n m` when both From and current exist: `current.relZ - from.relZ`.
- Clear From hides ΔZ.

Defaults: markers on, CZ on.

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/test_http.py tests/test_cz.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web wardogs_map/httpapp.py tests/test_http.py
git commit -m "feat: markers, draggable Control Zone, and delta-Z from pin"
```

---

### Task 13: LAN URLs, QR, phone CSS, load stores on boot

**Files:**
- Modify: `wardogs_map/lan.py`
- Modify: `wardogs_map/httpapp.py` `make_context` to load verified chunks from `CACHE_DIR/terrain/{id}/` when present
- Create: `tests/test_lan.py`
- Modify: `web/app.css` for chips ≥ 44px tap targets
- Modify: `README.md`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_lan.py
from wardogs_map.lan import lan_urls, private_ipv4s

def test_localhost_always_present():
    urls = lan_urls(8765)
    assert "http://127.0.0.1:8765" in urls

def test_private_ipv4_filter():
    ips = private_ipv4s()
    for ip in ips:
        a, b, *_ = (int(p) for p in ip.split("."))
        assert (
            a == 10
            or (a == 192 and b == 168)
            or (a == 172 and 16 <= b <= 31)
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_lan.py -v`

Expected: FAIL if still stubbed without 127.0.0.1 guarantee — write the real module

- [ ] **Step 3: Implement**

`private_ipv4s()`: `socket.getaddrinfo(socket.gethostname(), None)` plus Windows `ipconfig` is unnecessary; iterate `socket.getaddrinfo` and `psutil` is extra — use `socket` + `ipaddress.IPv4Address.is_private` on `netifaces`-free approach:

```python
import socket
import ipaddress

def private_ipv4s() -> list[str]:
    found = []
    hostname = socket.gethostname()
    for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
        ip = info[4][0]
        addr = ipaddress.ip_address(ip)
        if addr.is_private and not addr.is_loopback:
            found.append(ip)
    return list(dict.fromkeys(found))
```

`print_qr(url)`: `qrcode.QRCode` then `print` ASCII via `qr.print_ascii()`.

`make_context()`: for each map id, if `CACHE_DIR/terrain/{id}/manifest.json` exists, load verified bins from `chunks/` next to it, build `TerrainStore`, set `status["maps"][id]["ready"]` from `BAKED_DIR/{id}/READY`.

Phone CSS: chips `min-height: 44px`; `#map { height: 100dvh; }`; prevent iOS rubber-band on the readout.

README: firewall allow Python on Private; phone opens the printed `http://192.168.x.x:8765`; first-time `python bake.py prepare` may take minutes and ~1–3 GB; Bulkhead reply does not change this app’s data sources.

- [ ] **Step 4: Run full suite**

Run: `python -m pytest -v`

Expected: PASS all tests

- [ ] **Step 5: Commit**

```bash
git add wardogs_map/lan.py wardogs_map/httpapp.py tests/test_lan.py web/app.css README.md
git commit -m "feat: LAN QR host and load cached terrain on boot"
```

---

### Task 14: Manual prepare smoke (human)

Not automated. After Task 13:

- [ ] **Step 1:** `python -m pip install -r requirements.txt`
- [ ] **Step 2:** `python bake.py prepare` (long; watch hash failures)
- [ ] **Step 3:** `python server.py` — confirm QR and LAN URL
- [ ] **Step 4:** PC browser: Bakurani hillshade aligns with color tiles; valley click relZ < ridge click
- [ ] **Step 5:** Phone on Wi‑Fi: same page, sticky readout visible
- [ ] **Step 6:** Confirm process has no handle on the Steam install (it should not; code has no that path)

If hillshade is misaligned with tiles, fix `overlays.bake_map` origin to `tileBounds.minX/minY` and Y-flip (`gameUnitsToLandscapeQuadsY` is negative). Add a regression test with a 2×2 fake grid whose high cell is the north-east corner and assert the zoom-0 PNG’s corresponding corner is brighter or higher hypsometric.

- [ ] **Step 7: Commit any alignment fix**

```bash
git add wardogs_map/overlays.py tests/test_overlays.py
git commit -m "fix: align baked overlays to tileBounds Y sense"
```

---

## Spec coverage

| Spec section | Task |
|--------------|------|
| Goals / three maps / hillshade default | 6, 11 |
| Tap X Y relZ | 4, 7, 11 |
| 2×2 km CZ | 5, 12 |
| Phone LAN | 13 |
| Never Steam/Elytra/paks | 1 (grep test), 8 (path jail) |
| Bulkhead reply does not change v1 | README in 13 |
| Coords / no clamp | 2, 4 |
| Tile URL zoom_z/x_y.webp | 8, 9 (confirmed live) |
| Bake pyramids + contours 20 m | 10 |
| HTTP table | 7, 8, 11, 12 |
| Failures / hash / READY | 9, 10, 13 |
| Tests listed in spec §13 | 2, 3, 4, 5, 7 |
| From/To ΔZ | 12 |
| Marker metres vs game units | 6, 12 |

## Placeholder scan

No TBD. Tile pattern confirmed. `lan.py` stub in Task 7 is replaced in Task 13. Full CDN prepare is Task 14 (manual) after unit-tested download.

## Type names (keep consistent)

- `ChunkLocation`, `Sample`, `TerrainStore`, `StudioHandler`, `locate_point`, `randomize_cz`, `CZ_GAME_SIZE`, `metres_to_game`, `load_map`, `lan_urls`
