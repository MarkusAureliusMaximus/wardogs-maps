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
