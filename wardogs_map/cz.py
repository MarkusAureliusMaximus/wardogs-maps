import random

METERS_PER_UNIT = 100.0
CZ_METERS = 2000.0
CZ_GAME_SIZE = CZ_METERS / METERS_PER_UNIT  # 20.0 game units = 2.00 km

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


def zone_height_stats(store, square: dict, samples: int = 17) -> dict:
    n = max(5, min(int(samples), 33))
    min_x = float(square["minX"])
    min_y = float(square["minY"])
    span_x = float(square["maxX"]) - min_x
    span_y = float(square["maxY"]) - min_y
    zs: list[float] = []
    for row in range(n):
        y = min_y + (row + 0.5) / n * span_y
        for col in range(n):
            x = min_x + (col + 0.5) / n * span_x
            sample = store.sample(x, y)
            if sample.ok and sample.rel_z is not None:
                zs.append(float(sample.rel_z))
    if not zs:
        return {"ok": False, "min": None, "max": None, "mean": None, "relief": None}
    lo = min(zs)
    hi = max(zs)
    return {
        "ok": True,
        "min": round(lo, 1),
        "max": round(hi, 1),
        "mean": round(sum(zs) / len(zs), 1),
        "relief": round(hi - lo, 1),
        "samples": len(zs),
    }
