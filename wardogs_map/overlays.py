import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

from wardogs_map import paths

MAX_ZOOM = 7
TILE_PX = 256
CONTOUR_INTERVAL = 20.0

# Marching-squares edge pairs. Bits: TL=1, TR=2, BR=4, BL=8.
# Edges: 0=top, 1=right, 2=bottom, 3=left.
_MS_EDGES = {
    1: ((3, 0),),
    2: ((0, 1),),
    3: ((3, 1),),
    4: ((1, 2),),
    5: ((3, 0), (1, 2)),
    6: ((0, 2),),
    7: ((3, 2),),
    8: ((2, 3),),
    9: ((0, 2),),
    10: ((0, 1), (2, 3)),
    11: ((1, 2),),
    12: ((3, 1),),
    13: ((0, 1),),
    14: ((3, 0),),
}

_RAMP = None


def _ramp_stops():
    global _RAMP
    if _RAMP is None:
        data = json.loads((paths.WEB_DIR / "ramp.json").read_text(encoding="utf-8"))
        stops = data["stops"]
        ts = np.array([float(s[0]) for s in stops], dtype=np.float64)
        cols = np.array([s[1] for s in stops], dtype=np.float64)
        _RAMP = (ts, cols)
    return _RAMP


def _quad_scale(manifest: dict, axis: str) -> float:
    specific = manifest.get(f"gameUnitsToLandscapeQuads{axis}")
    if specific is not None and float(specific) != 0:
        return float(specific)
    return float(manifest["gameUnitsToLandscapeQuads"])


def hillshade(z, cell_m):
    """Horn hillshade, sun azimuth 315°, altitude 45°, uint8 0–255."""
    z = np.asarray(z, dtype=np.float64)
    if z.ndim != 2 or z.size == 0:
        return np.zeros(z.shape, dtype=np.uint8)
    cell = float(cell_m)
    padded = np.pad(z, 1, mode="edge")
    w0 = padded[:-2, :-2]
    w1 = padded[:-2, 1:-1]
    w2 = padded[:-2, 2:]
    w3 = padded[1:-1, :-2]
    w5 = padded[1:-1, 2:]
    w6 = padded[2:, :-2]
    w7 = padded[2:, 1:-1]
    w8 = padded[2:, 2:]
    dx = ((w0 + 2.0 * w3 + w6) - (w2 + 2.0 * w5 + w8)) / (8.0 * cell)
    dy = ((w6 + 2.0 * w7 + w8) - (w0 + 2.0 * w1 + w2)) / (8.0 * cell)
    slope = np.arctan(np.hypot(dx, dy))
    aspect = np.arctan2(dy, dx)
    altitude = math.radians(45.0)
    azimuth = math.radians(315.0)
    cang = np.sin(altitude) * np.cos(slope) + np.cos(altitude) * np.sin(slope) * np.cos(
        azimuth - math.pi / 2.0 - aspect
    )
    cang = np.clip(cang, 0.0, 1.0)
    out = np.rint(cang * 255.0)
    out = np.where(np.isfinite(z) & np.isfinite(out), out, 0.0)
    return out.astype(np.uint8)


def hypsometric_rgba(z, vmin, vmax):
    z = np.asarray(z, dtype=np.float64)
    ts, cols = _ramp_stops()
    span = float(vmax) - float(vmin)
    if span == 0.0:
        t = np.zeros_like(z, dtype=np.float64)
    else:
        t = (z - float(vmin)) / span
    t = np.clip(t, 0.0, 1.0)
    r = np.interp(t, ts, cols[:, 0], left=cols[0, 0], right=cols[-1, 0])
    g = np.interp(t, ts, cols[:, 1], left=cols[0, 1], right=cols[-1, 1])
    b = np.interp(t, ts, cols[:, 2], left=cols[0, 2], right=cols[-1, 2])
    rgb = np.stack((r, g, b), axis=-1)
    rgb = np.clip(np.rint(np.nan_to_num(rgb, nan=0.0)), 0, 255).astype(np.uint8)
    alpha = np.where(np.isfinite(z), 255, 0).astype(np.uint8)
    return np.concatenate((rgb, alpha[..., None]), axis=-1)


def _interp_edge(p0, p1, z0, z1, level):
    dz = z1 - z0
    if dz == 0.0:
        t = 0.5
    else:
        t = (level - z0) / dz
        if t < 0.0:
            t = 0.0
        elif t > 1.0:
            t = 1.0
    return (p0[0] + t * (p1[0] - p0[0]), p0[1] + t * (p1[1] - p0[1]))


def _edge_point(edge, r, c, z_tl, z_tr, z_bl, z_br, level, origin_x, origin_y, step):
    x0 = origin_x + c * step
    y0 = origin_y + r * step
    x1 = origin_x + (c + 1) * step
    y1 = origin_y + (r + 1) * step
    if edge == 0:
        return _interp_edge((x0, y0), (x1, y0), z_tl, z_tr, level)
    if edge == 1:
        return _interp_edge((x1, y0), (x1, y1), z_tr, z_br, level)
    if edge == 2:
        return _interp_edge((x0, y1), (x1, y1), z_bl, z_br, level)
    return _interp_edge((x0, y0), (x0, y1), z_tl, z_bl, level)


def _chain_segments(segments):
    if not segments:
        return []

    def rk(pt):
        return (round(pt[0], 8), round(pt[1], 8))

    endpoints = {}
    for i, (a, b) in enumerate(segments):
        endpoints.setdefault(rk(a), []).append((i, 0))
        endpoints.setdefault(rk(b), []).append((i, 1))

    used = [False] * len(segments)
    lines = []
    for i, (a, b) in enumerate(segments):
        if used[i]:
            continue
        used[i] = True
        chain = [a, b]
        for end_idx in (1, 0):
            while True:
                pt = chain[-1] if end_idx == 1 else chain[0]
                found = None
                for j, which in endpoints.get(rk(pt), ()):
                    if not used[j]:
                        found = (j, which)
                        break
                if found is None:
                    break
                j, which = found
                used[j] = True
                p0, p1 = segments[j]
                nxt = p1 if which == 0 else p0
                if end_idx == 1:
                    chain.append(nxt)
                else:
                    chain.insert(0, nxt)
        if len(chain) >= 2:
            lines.append(chain)
    return lines


def contours_geojson(z, origin_x, origin_y, step_game, interval=20.0):
    z = np.asarray(z, dtype=np.float64)
    features = []
    if z.ndim != 2 or z.shape[0] < 2 or z.shape[1] < 2:
        return {"type": "FeatureCollection", "features": features}
    finite = np.isfinite(z)
    if not finite.any():
        return {"type": "FeatureCollection", "features": features}

    zmin = float(np.nanmin(z))
    zmax = float(np.nanmax(z))
    interval = float(interval)
    if interval <= 0.0 or not math.isfinite(zmin) or not math.isfinite(zmax):
        return {"type": "FeatureCollection", "features": features}

    k0 = math.floor(zmin / interval) + 1
    k1 = math.floor(zmax / interval)
    origin_x = float(origin_x)
    origin_y = float(origin_y)
    step = float(step_game)
    cell_ok = finite[:-1, :-1] & finite[:-1, 1:] & finite[1:, :-1] & finite[1:, 1:]

    for k in range(k0, k1 + 1):
        level = float(k * interval)
        if level <= zmin or level > zmax:
            continue
        tl = z[:-1, :-1]
        tr = z[:-1, 1:]
        bl = z[1:, :-1]
        br = z[1:, 1:]
        bits = (
            (tl >= level).astype(np.uint8)
            | ((tr >= level).astype(np.uint8) << 1)
            | ((br >= level).astype(np.uint8) << 2)
            | ((bl >= level).astype(np.uint8) << 3)
        )
        active = cell_ok & (bits > 0) & (bits < 15)
        rr, cc = np.nonzero(active)
        if rr.size == 0:
            continue
        segments = []
        for r, c, b, z_tl, z_tr, z_bl, z_br in zip(
            rr, cc, bits[rr, cc], tl[rr, cc], tr[rr, cc], bl[rr, cc], br[rr, cc]
        ):
            edges = _MS_EDGES.get(int(b))
            if not edges:
                continue
            r_i = int(r)
            c_i = int(c)
            for e0, e1 in edges:
                p0 = _edge_point(
                    e0, r_i, c_i, z_tl, z_tr, z_bl, z_br, level, origin_x, origin_y, step
                )
                p1 = _edge_point(
                    e1, r_i, c_i, z_tl, z_tr, z_bl, z_br, level, origin_x, origin_y, step
                )
                segments.append((p0, p1))
        index = (round(level) % 100) == 0
        for line in _chain_segments(segments):
            features.append(
                {
                    "type": "Feature",
                    "properties": {"level": level, "index": bool(index)},
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[float(x), float(y)] for x, y in line],
                    },
                }
            )
    return {"type": "FeatureCollection", "features": features}


def write_png_tile(path, arr):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    arr = np.asarray(arr)
    Image.fromarray(arr).save(path, format="PNG", compress_level=1)


def _stitch_rel_grid(store):
    manifest = store.manifest
    chunks = store.chunks
    if not chunks:
        return None
    side = int(manifest["verticesPerSide"])
    quads = int(manifest["chunkQuads"])
    cx0 = int(manifest["chunkXMin"])
    cx1 = int(manifest["chunkXMax"])
    cy0 = int(manifest["chunkYMin"])
    cy1 = int(manifest["chunkYMax"])
    ncols = (cx1 - cx0) * quads + side
    nrows = (cy1 - cy0) * quads + side
    z = np.full((nrows, ncols), np.nan, dtype=np.float32)
    scale_x = _quad_scale(manifest, "X")
    scale_y = _quad_scale(manifest, "Y")
    off_x = float(manifest["globalQuadOffsetX"])
    off_y = float(manifest["globalQuadOffsetY"])
    z_off = float(manifest["worldZOffsetMeters"])
    z_scl = float(manifest["worldZScaleMetersPerLocalUnit"])
    map_min = float(store.map_min_world_z)
    expected = side * side
    entries = manifest.get("chunks") or {}

    for key, buf in chunks.items():
        entry = entries.get(key)
        if entry is None:
            continue
        parts = str(key).split(",")
        if len(parts) != 2:
            continue
        cx, cy = int(parts[0]), int(parts[1])
        raw = np.frombuffer(buf, dtype="<u2")
        if raw.size != expected:
            continue
        raw = raw.reshape(side, side)
        lo = float(entry["minLocalZ"])
        hi = float(entry["maxLocalZ"])
        local = lo + raw.astype(np.float32) * np.float32((hi - lo) / 65535.0)
        rel = (z_off + local * z_scl) - map_min
        col0 = (cx - cx0) * quads
        row0 = (cy - cy0) * quads
        z[row0 : row0 + side, col0 : col0 + side] = rel

    origin_x = (cx0 * quads - off_x) / scale_x
    origin_y = (cy0 * quads - off_y) / scale_y
    step_x = 1.0 / scale_x
    step_y = 1.0 / scale_y
    if step_y > 0.0:
        z = np.flipud(z)
        origin_y = origin_y + (nrows - 1) * step_y
        step_y = -step_y
    return z, origin_x, origin_y, step_x, step_y


def _bilinear_sample(src, rows_1d, cols_1d, fill):
    h, w = src.shape[:2]
    r = rows_1d[:, np.newaxis]
    c = cols_1d[np.newaxis, :]
    r0 = np.floor(r).astype(np.intp)
    c0 = np.floor(c).astype(np.intp)
    r1 = r0 + 1
    c1 = c0 + 1
    dr = (r - r0).astype(np.float32)
    dc = (c - c0).astype(np.float32)
    inside = (r0 >= 0) & (r1 < h) & (c0 >= 0) & (c1 < w)
    r0c = np.clip(r0, 0, h - 1)
    r1c = np.clip(r1, 0, h - 1)
    c0c = np.clip(c0, 0, w - 1)
    c1c = np.clip(c1, 0, w - 1)
    w00 = (1.0 - dr) * (1.0 - dc)
    w01 = (1.0 - dr) * dc
    w10 = dr * (1.0 - dc)
    w11 = dr * dc
    if src.ndim == 2:
        v00 = src[r0c, c0c].astype(np.float32, copy=False)
        v01 = src[r0c, c1c].astype(np.float32, copy=False)
        v10 = src[r1c, c0c].astype(np.float32, copy=False)
        v11 = src[r1c, c1c].astype(np.float32, copy=False)
        val = v00 * w00 + v01 * w01 + v10 * w10 + v11 * w11
        out = np.full(val.shape, fill, dtype=src.dtype)
        sampled = np.clip(np.rint(val), 0, 255).astype(src.dtype, copy=False)
        np.copyto(out, sampled, where=inside)
        return out
    w00e = w00[..., None]
    w01e = w01[..., None]
    w10e = w10[..., None]
    w11e = w11[..., None]
    val = (
        src[r0c, c0c].astype(np.float32) * w00e
        + src[r0c, c1c].astype(np.float32) * w01e
        + src[r1c, c0c].astype(np.float32) * w10e
        + src[r1c, c1c].astype(np.float32) * w11e
    )
    out = np.zeros(val.shape, dtype=src.dtype)
    np.copyto(out, np.clip(np.rint(val), 0, 255).astype(src.dtype, copy=False), where=inside[..., None])
    return out


def _resample_to_tile(src, origin_x, origin_y, step_x, step_y, x0, x1, y_north, y_south, fill):
    gx = x0 + (np.arange(TILE_PX, dtype=np.float64) + 0.5) / TILE_PX * (x1 - x0)
    gy = y_north - (np.arange(TILE_PX, dtype=np.float64) + 0.5) / TILE_PX * (y_north - y_south)
    cols = (gx - origin_x) / step_x
    rows = (gy - origin_y) / step_y
    return _bilinear_sample(src, rows, cols, fill)


def _png_ready(path: Path) -> bool:
    return path.is_file() and path.stat().st_size > 0


def _zoom7_hillshade_complete(root: Path) -> bool:
    folder = root / "hillshade" / f"zoom_{MAX_ZOOM}"
    n = 1 << MAX_ZOOM
    for x in range(n):
        for y in range(n):
            if not _png_ready(folder / f"{x}_{y}.png"):
                return False
    return True


def _write_layer_tile(path, src, origin_x, origin_y, step_x, step_y, x0, x1, y_north, y_south, fill):
    if _png_ready(path):
        return
    arr = _resample_to_tile(
        src, origin_x, origin_y, step_x, step_y, x0, x1, y_north, y_south, fill
    )
    write_png_tile(path, arr)


def bake_map(map_id, store, spec) -> bool:
    ready_path = paths.BAKED_DIR / map_id / "READY"
    try:
        grid = _stitch_rel_grid(store)
        if grid is None:
            ready_path.unlink(missing_ok=True)
            return False
        z, origin_x, origin_y, step_x, step_y = grid
        if not np.isfinite(z).any():
            ready_path.unlink(missing_ok=True)
            return False

        out_root = paths.BAKED_DIR / map_id
        out_root.mkdir(parents=True, exist_ok=True)
        print(f"{map_id} stitch {z.shape[1]}x{z.shape[0]}", flush=True)

        meters = float(spec.get("coordinateMetersPerUnit", 100.0))
        cell_m = abs(float(step_x)) * meters
        step = abs(float(step_x))
        south_y = origin_y + (z.shape[0] - 1) * step_y
        print(f"{map_id} contours", flush=True)
        gj = contours_geojson(np.flipud(z), origin_x, south_y, step, interval=CONTOUR_INTERVAL)
        contours_path = out_root / "contours.geojson"
        contours_path.write_text(json.dumps(gj, separators=(",", ":")), encoding="utf-8")

        print(f"{map_id} hillshade", flush=True)
        hs = hillshade(z, cell_m=cell_m)
        hs = np.where(np.isfinite(z), hs, 255).astype(np.uint8)
        vmin = float(np.nanmin(z))
        vmax = float(np.nanmax(z))
        rgba = hypsometric_rgba(z, vmin, vmax)
        del z

        tb = spec["tileBounds"]
        min_x = float(tb["minX"])
        max_x = float(tb["maxX"])
        min_y = float(tb["minY"])
        max_y = float(tb["maxY"])
        span_x = max_x - min_x
        span_y = max_y - min_y

        for zoom in range(0, MAX_ZOOM + 1):
            n = 1 << zoom
            total = n * n
            tile_w = span_x / n
            tile_h = span_y / n
            hs_dir = out_root / "hillshade" / f"zoom_{zoom}"
            hy_dir = out_root / "hypsometric" / f"zoom_{zoom}"
            hs_dir.mkdir(parents=True, exist_ok=True)
            hy_dir.mkdir(parents=True, exist_ok=True)
            i = 0
            for x in range(n):
                x0 = min_x + x * tile_w
                x1 = x0 + tile_w
                for y in range(n):
                    i += 1
                    print(f"{map_id} zoom {zoom} tile {i}/{total}", flush=True)
                    y_north = max_y - y * tile_h
                    y_south = y_north - tile_h
                    _write_layer_tile(
                        hs_dir / f"{x}_{y}.png",
                        hs,
                        origin_x,
                        origin_y,
                        step_x,
                        step_y,
                        x0,
                        x1,
                        y_north,
                        y_south,
                        255,
                    )
                    _write_layer_tile(
                        hy_dir / f"{x}_{y}.png",
                        rgba,
                        origin_x,
                        origin_y,
                        step_x,
                        step_y,
                        x0,
                        x1,
                        y_north,
                        y_south,
                        0,
                    )

        contours_ok = (
            contours_path.is_file()
            and contours_path.stat().st_size > 0
            and bool(gj.get("features"))
        )
        if contours_ok and _zoom7_hillshade_complete(out_root):
            ready_path.write_text("", encoding="utf-8")
            return True
        ready_path.unlink(missing_ok=True)
        return False
    except Exception as exc:
        print(f"{map_id} bake fail {exc}", flush=True)
        ready_path.unlink(missing_ok=True)
        return False
