"""Build a small relative-height grid for the 3D table view."""

from wardogs_map.terrain import TerrainStore

MAX_N = 192
DEFAULT_N = 128


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
    return {
        "map": map_id,
        "n": n,
        "minX": min_x,
        "maxX": max_x,
        "minY": min_y,
        "maxY": max_y,
        "textureUrl": f"/tiles/{map_id}/color/0/0/0.webp",
        "heights": heights,
    }
