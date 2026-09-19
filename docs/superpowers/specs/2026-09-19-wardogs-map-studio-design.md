# WARDOGS Map Studio — v1 Design

Date: 2026-09-19  
Status: Draft for user review  
Project path: `C:\Users\tater\wardogs-map-studio`

A local LAN web app for studying WARDOGS terrain: full-resolution overhead tiles, hillshade, color-by-height, contours, community markers, a draggable 2×2 km Control Zone, and click-to-sample relative height. The phone is a second browser on the same Wi‑Fi. It is not a live overlay on the match.

## 1. Problem

WARDOGS ships three 16×16 km maps. Terrain is cooked into encrypted Unreal IoStore packs. The live client is protected by Elytra (kernel-level). There is no loose heightmap on disk. Community Terrain3D chunks and tile pyramids already exist at ~1 m/px imagery and a 2 m height grid. We need a personal study tool that uses that published data, not the running game.

## 2. Goals (v1)

- Study Bakurani, Ozeti, and Zestafona at the same detail as the published sources (tile zoom 7 ≈ 1 m/px; height samples on the native 2 m grid).
- One map canvas with layers. Hillshade on by default.
- Tap/click a point and read game `X`, `Y`, and **relative** height in metres.
- Drag a 2.00×2.00 km Control Zone square for tabletop planning.
- Run on this PC and on a phone on the same LAN.
- Never open the Steam install, the game process, or Elytra.

## 3. Non-goals (v1)

- Live player position, loot, vehicles, or match Control Zone from the server.
- Measure tool, elevation profile, drawing/planning marks, artillery math, 3D globe.
- Unpacking, decrypting, or indexing `Wardogs\Content\Paks`.
- Memory reading, packet capture, injected overlays, DXGI capture of the game window.
- Publishing or mirroring Bulkhead/community map imagery as our own CDN.
- Waiting on Bulkhead’s reply before shipping v1. The reply cannot silently add game-file reading to this version.

## 4. Elytra and data policy

Elytra is a kernel-level anti-cheat (VAIIYA). Bulkhead has not published a companion-app allow-list. Embark’s public guidance for the same stack treats tools that interfere with the game’s **files, memory, or behavior**, plus injectors, custom overlays, macros, and memory editors, as disallowed. WARDOGS players already report injected overlays (RivaTuner, some GPU/Discord overlays) as crash or “service refused the executable” sources.

**v1 data sources are only:**

- Published community tile pyramids and Terrain3D chunks (HTTPS).
- Vendored copies of community map JSON (bounds, markers, tileBounds).
- Files this project writes under `C:\Users\tater\wardogs-map-studio\data\`.

**v1 never:**

- Opens `D:\SteamLibrary\steamapps\common\Wardogs` (or any other install path).
- Opens `WardogsClient-Win64-Shipping.exe`, `.pak`, `.ucas`, `.utoc`, `.sig`.
- Attaches to, injects into, or screenshots the game process.
- Binds a public internet port or uses UPnP.

The owner is asking Bulkhead whether reading game data would trip Elytra. That answer does **not** change v1. If they later allow a specific file class, that is a new design revision with a new spec section — not a quiet extra reader in this app.

Local `AppData\Local\Wardogs\Saved` was inspected: settings and shader cache only, empty logs, no map. It is out of scope even as a gray item.

## 5. Users and environments

- **PC (this machine):** Chrome/Edge while WARDOGS may or may not be running. The studio is a separate process and folder.
- **Phone:** Safari/Chrome on the same private Wi‑Fi. Touch pan/zoom, large layer chips, sticky readout.

Host OS: Windows 10. Python 3.11+ for the server and bake. Browser is the UI.

## 6. Architecture

```
C:\Users\tater\wardogs-map-studio\
  README.md
  requirements.txt        # numpy, pillow, qrcode, pytest
  server.py               # LAN static + sample API + QR printout
  bake.py                 # download, verify, bake overlays
  web/                    # static HTML/CSS/JS
  maps/                   # vendored bakurani.json, ozeti.json, zestafona.json, index.json
  data/cache/             # downloaded tiles + terrain bins (gitignored)
  data/baked/             # hillshade / hypsometric tiles + contours (gitignored)
  tests/
  docs/superpowers/specs/ # this document
```

Two processes conceptually, one CLI:

- `python bake.py prepare` — download + verify + bake (resumable).
- `python server.py` — bind `0.0.0.0:8765`, serve `web/` and `data/`, print LAN URL and QR.

Frontend: static page, **Leaflet** (raster XYZ tiles, GeoJSON contours, simple overlays). No build step for v1. No framework.

The server must not walk or mention the Steam library path.

## 7. Coordinate system

Per community map JSON:

- `coordinateMetersPerUnit = 100` (1.00 game unit = 100 m; 0.01 = 1 m).
- `tileBounds` maps the full tile pyramid (about 0..163.84 on Bakurani).
- `bounds` is the playable/searchable rectangle; the camera can show tileBounds but sample readout outside verified Terrain3D coverage returns no Z.

Height decode (format `wardogs-landscape-collision-u16-v1`):

- Chunk file is exactly `511 * 511 * 2 = 522242` bytes, little-endian uint16, row-major, Landscape +Y.
- `localZ = minLocalZ + (raw / 65535) * (maxLocalZ - minLocalZ)` using that chunk’s manifest entry.
- `worldZ_m = worldZOffsetMeters + localZ * worldZScaleMetersPerLocalUnit` (scale is 9 on published maps).
- **Display `relZ_m = worldZ_m - mapMinWorldZ`**, where `mapMinWorldZ` is computed once from all verified chunks of that map. Never label this ASL.
- Optional locked “from” pin: `ΔZ = relZ_to - relZ_from`. v1 includes this as a second tap modifier (set From / set To) because the sticky bar already has room; it is not a profile tool.

Quad mapping comes from each map’s Terrain3D `manifest.json` (`globalQuadOffsetX/Y`, `gameUnitsToLandscapeQuadsX/Y`, `chunkQuads = 510`). Do not hard-code one map’s offsets for all three.

Azimuth is not in v1.

## 8. External data (fetch only)

Base: `https://assets.wardogs-artillery.com/releases/assets-v1/`

| Kind | URL pattern |
|------|-------------|
| Grayscale tiles | `maps/tiles/{map}/zoom_{z}/{x}_{y}.webp` (confirm exact filename from a live GET of zoom_0 during implement; store the pattern in `maps/*.json`) |
| Color tiles | `maps/tiles-color/{map}/...` same scheme |
| Terrain manifest | `data/terrain/{map}/manifest.json` |
| Terrain chunks | resolved relative to the manifest URL (`chunks/16_12.bin`, …) |

Maps: `bakurani`, `ozeti`, `zestafona`.

Tile config from community JSON: `tileSize = 256`, `minZoom = 0`, `maxZoom = 7`, WebP.

On prepare, persist a copy of each manifest and verify every chunk `sha256` and `bytes` before use. Failed chunks are omitted from sampling and from bake; prepare prints them and exits non-zero if any map has zero usable chunks.

Vendored `maps/*.json` holds markers, polygons (faction spawn areas), bounds, tileBounds, and the tile URL *path template* (rewritten at runtime to `/tiles/...` on our host).

Community map JSON and Terrain3D format documentation are MIT-licensed **code/data schemas**. The imagery and height samples remain third-party game-derived assets. This repo does not commit `data/cache` or `data/baked`. README states personal cache only, unofficial, not affiliated with BULKHEAD.

## 9. Bake pipeline

`bake.py prepare`:

1. Create `data/cache` and `data/baked`.
2. For each map, download missing tile files for both styles, zoom 0–7. Skip files whose size is already non-zero; no need to re-hash every WebP on every run (tiles have no per-file sha in the community index). Retry a file twice on 5xx/timeout.
3. Download manifest + chunks; require sha256 match.
4. Compute `mapMinWorldZ` / `mapMaxWorldZ`; write `data/baked/{map}/height-stats.json`.
5. Rasterize the 2 m grid into overlay pyramids that share the community `tileBounds` and zoom 0–7, 256 px tiles, PNG:
   - `data/baked/{map}/hillshade/zoom_{z}/{x}_{y}.png`
   - `data/baked/{map}/hypsometric/zoom_{z}/{x}_{y}.png` (color ramp relative to that map’s min/max; include a 1-pixel alpha outside coverage)
6. Generate `data/baked/{map}/contours.geojson` from the 2 m grid: 20 m interval, every 100 m an index contour (`index: true`). Coordinates in game units so Leaflet can draw them on the same CRS as the tiles.
7. Write `data/baked/{map}/READY` when that map’s hillshade zoom-7 set and contours exist.

Hillshade: standard northwest illumination on the 2 m grid (cell size 2 m). Do not downsample the source grid before lighting; tile generation may average only when producing zoom &lt; 7.

Hypsometric ramp (relative, low → high): deep blue → green → yellow → brown → off-white. Document the exact stops in `web/ramp.json`.

Bake is CPU-heavy. Progress is line-based (`map zoom z tile i/n`). Safe to Ctrl+C and resume.

## 10. HTTP surface

`server.py` listens on `0.0.0.0:8765` (override with `--port`). Routes:

| Method | Path | Result |
|--------|------|--------|
| GET | `/` | `web/index.html` |
| GET | `/web/*` | static |
| GET | `/tiles/{map}/{style}/{z}/{x}/{y}.webp` | `data/cache/...` or 404 |
| GET | `/overlay/{map}/hillshade/{z}/{x}/{y}.png` | baked |
| GET | `/overlay/{map}/hypsometric/{z}/{x}/{y}.png` | baked |
| GET | `/overlay/{map}/contours.geojson` | baked |
| GET | `/maps/index.json` and `/maps/{id}.json` | vendored |
| GET | `/api/sample?map=&x=&y=` | JSON sample |
| GET | `/api/status` | which maps are READY, cache sizes, LAN URLs |

`GET /api/sample` response:

```json
{
  "map": "bakurani",
  "x": 81.2,
  "y": 74.6,
  "ok": true,
  "relZ": 42.1,
  "inCoverage": true
}
```

If outside coverage or chunk missing: `ok: false`, `relZ: null`, `inCoverage: false`. No fake clamp to the edge.

On start, print:

- `http://127.0.0.1:8765`
- `http://<first-private-ipv4>:8765`
- QR (ascii or generated PNG opened is unnecessary; terminal QR via a small dependency is enough)
- Windows Firewall: if bind succeeds but no private IPv4, say so.

Do not register a URL reservation that requires admin. If port in use, exit with a clear error.

## 11. UI

Single page. One map. Layer chips. Sticky readout.

**Top bar:** map tabs Bakurani / Ozeti / Zestafona. Layer chips: Tiles (color \| gray), Hillshade, Color, Contours, Markers, CZ.

**Defaults:** color tiles on, hillshade on (CSS `mix-blend-mode: multiply` or Leaflet equivalent), other overlays off, markers on, CZ on.

**Bottom sticky bar (never scrolls away on phone):** `X` `Y` to two decimals, `rel ±N m` (one decimal), coverage flag if no Z. Optional `ΔZ` when a From pin is set.

**Pointer:**

- Click/tap: sample pin at that game coordinate, fetch `/api/sample`, update bar.
- Long-press or a small “From” control: lock From pin for ΔZ.
- Map pan/zoom: pinch and wheel. No rotate.

**Control Zone:** rectangle 0.20 × 0.20 game units (2 km). Drag body to move. No independent corner resize. Button “Randomize CZ” places it uniformly inside that map’s `bounds` so the square stays fully inside bounds.

**Markers:** from vendored JSON (towers, vendors, spawn boards, faction labels) plus spawn polygons. Clicking a marker sets the sample pin to its coordinates.

**Phone:** same page, CSS that enlarges chips and pins the bottom bar with `env(safe-area-inset-bottom)`. No separate glance mode.

**Empty layers:** if hillshade is not READY, the Hill chip is disabled with “run prepare”. The map still shows tiles if those cached.

No live websocket. No user accounts.

## 12. Failures

- CDN/timeout: skip remaining files after retries; keep verified files; non-zero exit if a map cannot sample.
- Hash mismatch: delete the bad download, count as failure, do not bake from it.
- Partial bake: UI loads; missing overlay chips disabled.
- Phone cannot connect: user uses the printed LAN URL; we do not tunnel or open inbound WAN. README covers Windows Defender Firewall “Private” allow for Python.
- Sample with host down: browser shows last pin coords but Z stays “—”.

## 13. Tests

Automated (pytest):

1. Decode a synthetic 511² uint16 buffer: size, little-endian, `rawHeightAt` index.
2. Bakurani mapping fixture: one known game coordinate → expected chunk key using published manifest numbers (`globalQuadOffsetX = 8160`, `Y = 14280`, quadsX = +50, quadsY = −50).
3. `relZ` monotone: higher raw in a fake chunk with min &lt; max → higher relZ.
4. CZ randomize: 50 draws, square fully inside bounds.
5. HTTP: tmp directory with one fake tile and READY flag; `GET /` and `GET /api/status` are 200.

Manual after first real prepare:

- PC and phone show Bakurani hillshade aligned to tiles (ridge should match photo).
- Click a valley vs a ridge: relZ valley &lt; ridge.
- Firewall: phone loads on Wi‑Fi.

## 14. Implementation order

1. Repo skeleton, gitignore, vendored map JSON, status endpoint.
2. Terrain load + `/api/sample` using cached chunks (download-only path).
3. Leaflet map + community tiles proxied from cache.
4. Bake hillshade + hypsometric pyramids; layer chips.
5. Contours GeoJSON layer.
6. Markers, CZ, sticky bar, From/To ΔZ.
7. QR + LAN printout; phone CSS.
8. Tests above.

## 15. Risks

- Tile URL filename pattern may differ (`{z}/{x}/{y}` vs `zoom_z/x_y.webp`). Confirm with one HTTP HEAD in prepare; keep pattern in map JSON.
- First prepare disk/time: budget 1–3 GB and several minutes; show progress.
- Leaflet blend of hillshade over color WebP: if multiply looks washed out, switch hillshade to a grayscale tiles + `opacity` without blend — still a layer, not a new feature.
- Community CDN CORS does not matter if the PC host proxies tiles.

## 16. Success

v1 is done when: three maps open on this PC and on a phone on the LAN; hillshade default; tap shows relative Z from verified 2 m chunks; 2×2 km CZ drags; Steam/Elytra paths are not referenced in code; `pytest` passes.
