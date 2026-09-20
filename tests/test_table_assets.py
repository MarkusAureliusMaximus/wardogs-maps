from PIL import Image

from wardogs_map import paths
from wardogs_map.table_assets import stitch_table_color


def test_stitch_table_color_from_tiles(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "BAKED_DIR", tmp_path / "baked")
    cache = tmp_path / "cache"
    tile_dir = cache / "tiles" / "bakurani" / "color" / "zoom_1"
    tile_dir.mkdir(parents=True)
    colors = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0)]
    i = 0
    for y in range(2):
        for x in range(2):
            Image.new("RGB", (256, 256), colors[i]).save(tile_dir / f"{x}_{y}.webp", "WEBP")
            i += 1
    out = stitch_table_color("bakurani", zoom=1, cache_dir=cache)
    assert out is not None and out.is_file()
    im = Image.open(out)
    assert im.size == (512, 512)
    assert im.getpixel((10, 10))[0] > 200
    again = stitch_table_color("bakurani", zoom=1, cache_dir=cache)
    assert again == out
