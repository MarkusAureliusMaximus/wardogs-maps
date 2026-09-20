from wardogs_map.cz import CZ_GAME_SIZE, randomize_cz

BOUNDS = {"minX": 23.35, "maxX": 133.60, "minY": 19.34, "maxY": 129.65}

def test_true_table_height_is_not_exaggerated():
    span_m = 163.84 * 100.0
    y = 1193.2 / span_m * 160.0
    assert 11.0 < y < 12.0


def test_size_is_two_km():
    assert abs(CZ_GAME_SIZE - 20.0) < 1e-9  # 2000 m / 100 m per unit

def test_fifty_draws_stay_inside_bounds():
    for i in range(50):
        square = randomize_cz(BOUNDS, rng_seed=i)
        assert abs(square["maxX"] - square["minX"] - CZ_GAME_SIZE) < 1e-9
        assert abs(square["maxY"] - square["minY"] - CZ_GAME_SIZE) < 1e-9
        assert square["minX"] >= BOUNDS["minX"] - 1e-9
        assert square["minY"] >= BOUNDS["minY"] - 1e-9
        assert square["maxX"] <= BOUNDS["maxX"] + 1e-9
        assert square["maxY"] <= BOUNDS["maxY"] + 1e-9
