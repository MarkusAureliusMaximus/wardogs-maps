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
    # min_world from minLocalZ AND maxLocalZ: world(10)-world(-10)=180
    assert abs(result.rel_z - 180.0) < 1e-6


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
