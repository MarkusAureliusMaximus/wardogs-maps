"""Elevation samples along a ground line."""

import math

from wardogs_map.terrain import TerrainStore

METERS_PER_UNIT = 100.0
DEFAULT_N = 80
MAX_N = 160


def elevation_profile(
    store: TerrainStore,
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    n: int = DEFAULT_N,
) -> dict:
    n = max(2, min(int(n), MAX_N))
    dx = x1 - x0
    dy = y1 - y0
    length_m = math.hypot(dx, dy) * METERS_PER_UNIT
    points = []
    zs = []
    for i in range(n):
        t = i / (n - 1)
        x = x0 + dx * t
        y = y0 + dy * t
        sample = store.sample(x, y)
        rel = float(sample.rel_z) if sample.ok and sample.rel_z is not None else None
        if rel is not None:
            zs.append(rel)
        points.append(
            {
                "x": round(x, 4),
                "y": round(y, 4),
                "dist": round(length_m * t, 1),
                "relZ": None if rel is None else round(rel, 1),
                "ok": bool(sample.ok),
            }
        )
    out = {
        "ok": bool(zs),
        "lengthM": round(length_m, 1),
        "points": points,
        "min": round(min(zs), 1) if zs else None,
        "max": round(max(zs), 1) if zs else None,
    }
    if zs:
        out["delta"] = round(zs[-1] - zs[0], 1)
    else:
        out["delta"] = None
    return out
