"""Build a small relative-height grid for the 3D table view."""

import json

from wardogs_map import paths
from wardogs_map.terrain import TerrainStore

MAX_N = 256
DEFAULT_N = 256


def build_heightgrid(store: TerrainStore, spec: dict, n: int = DEFAULT_N) -> dict:
    n = int(n)
    if n < 8:
        n = 8
    if n > MAX_N:
        n = MAX_N
    tb = spec["tileBounds"]
    min_x = float(tb["minX"])
    max_x = float(tb["maxX"])
    min_y = float(tb["minY"])
    max_y = float(tb["maxY"])
    span_x = max_x - min_x
    span_y = max_y - min_y
    heights: list[float | None] = []
    for row in range(n):
        y = max_y - (row + 0.5) / n * span_y
        for col in range(n):
            x = min_x + (col + 0.5) / n * span_x
            sample = store.sample(x, y)
            if sample.ok and sample.rel_z is not None:
                heights.append(round(float(sample.rel_z), 2))
            else:
                heights.append(None)
    map_id = spec["id"]
    payload = {
        "map": map_id,
        "n": n,
        "minX": min_x,
        "maxX": max_x,
        "minY": min_y,
        "maxY": max_y,
        "textureUrl": f"/overlay/{map_id}/table-color.jpg?z=5",
        "heights": heights,
    }
    cache = paths.BAKED_DIR / map_id / f"heightgrid-{n}.json"
    try:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(payload), encoding="utf-8")
    except OSError:
        pass
    return payload


def load_or_build_heightgrid(store: TerrainStore, spec: dict, n: int = DEFAULT_N) -> dict:
    n = int(n)
    if n < 8:
        n = 8
    if n > MAX_N:
        n = MAX_N
    cache = paths.BAKED_DIR / spec["id"] / f"heightgrid-{n}.json"
    if cache.is_file() and cache.stat().st_size > 0:
        try:
            data = json.loads(cache.read_text(encoding="utf-8"))
            if data.get("n") == n and isinstance(data.get("heights"), list):
                data["textureUrl"] = f"/overlay/{spec['id']}/table-color.jpg?z=5"
                return data
        except (OSError, json.JSONDecodeError, TypeError):
            pass
    return build_heightgrid(store, spec, n=n)
