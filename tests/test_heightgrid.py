import struct

from wardogs_map import paths
from wardogs_map.heightgrid import build_heightgrid
from wardogs_map.terrain import TerrainStore

SIDE = 511
QUADS = 510


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
        chunks={key: struct.pack("<" + "H" * (SIDE * SIDE), *([raw] * SIDE * SIDE))},
        map_min_world_z=None,
    )


def test_heightgrid_size_and_known_cell(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "BAKED_DIR", tmp_path / "baked")
    store = _store(raw=65535, min_z=-10.0, max_z=10.0)
    spec = {
        "id": "bakurani",
        "tileBounds": {"minX": 0.0, "maxX": 163.84, "minY": 0.0, "maxY": 163.84},
    }
    grid = build_heightgrid(store, spec, n=16)
    assert grid["n"] == 16
    assert len(grid["heights"]) == 16 * 16
    assert "table-color.jpg" in grid["textureUrl"]
    # 81.2, 74.6 is in coverage for this store; corresponding cell should be 180
    col = int((81.2 - 0.0) / 163.84 * 16)
    row = int((163.84 - 74.6) / 163.84 * 16)
    value = grid["heights"][row * 16 + col]
    assert value is not None
    assert abs(value - 180.0) < 0.5


def test_heightgrid_caps_n(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "BAKED_DIR", tmp_path / "baked")
    monkeypatch.setattr("wardogs_map.heightgrid.MAX_N", 12)
    store = _store(raw=0, min_z=-1.0, max_z=1.0)
    spec = {
        "id": "bakurani",
        "tileBounds": {"minX": 0.0, "maxX": 10.0, "minY": 0.0, "maxY": 10.0},
    }
    grid = build_heightgrid(store, spec, n=9999)
    assert grid["n"] == 12
    assert len(grid["heights"]) == 12 * 12
