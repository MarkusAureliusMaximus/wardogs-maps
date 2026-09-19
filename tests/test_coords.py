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
