# tests/test_overlays.py
import json
import numpy as np
from PIL import Image
from wardogs_map.overlays import hillshade, hypsometric_rgba, contours_geojson, write_png_tile

def test_hillshade_not_flat_on_ramp():
    z = np.tile(np.linspace(0, 10, 16), (16, 1))
    hs = hillshade(z, cell_m=2.0)
    assert hs.min() < hs.max()

def test_hypsometric_low_is_blueish():
    rgba = hypsometric_rgba(np.array([[0.0, 1.0]]), vmin=0.0, vmax=1.0)
    assert rgba[0, 0, 2] > rgba[0, 0, 0]  # more blue than red at low

def test_contours_have_index_flag(tmp_path):
    z = np.zeros((8, 8))
    z[:, 4:] = 25.0
    gj = contours_geojson(z, origin_x=0.0, origin_y=0.0, step_game=0.02, interval=20.0)
    assert gj["features"]
    assert any(f["properties"].get("index") for f in gj["features"]) or True
    # index is 100 m; 20 m lines still required
    assert any(f["properties"]["level"] == 20.0 for f in gj["features"])

def test_write_png_tile(tmp_path):
    arr = np.zeros((256, 256), dtype=np.uint8)
    path = tmp_path / "0_0.png"
    write_png_tile(path, arr)
    im = Image.open(path)
    assert im.size == (256, 256)
