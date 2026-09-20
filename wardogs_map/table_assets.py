"""Bake a high-res overhead texture for the 3D table."""

from pathlib import Path

from PIL import Image

from wardogs_map import paths

TABLE_ZOOM = 5
FALLBACK_ZOOM = 4
TILE_PX = 256


def table_color_path(map_id: str, zoom: int = TABLE_ZOOM) -> Path:
    return paths.BAKED_DIR / map_id / f"table-color-z{zoom}.jpg"


def stitch_table_color(map_id: str, zoom: int = TABLE_ZOOM, cache_dir: Path | None = None) -> Path | None:
    out = table_color_path(map_id, zoom)
    if out.is_file() and out.stat().st_size > 0:
        return out
    cache = Path(cache_dir) if cache_dir is not None else paths.CACHE_DIR
    tile_root = cache / "tiles" / map_id / "color" / f"zoom_{zoom}"
    side = 1 << zoom
    canvas = Image.new("RGB", (side * TILE_PX, side * TILE_PX), (18, 22, 16))
    pasted = 0
    for ty in range(side):
        for tx in range(side):
            src = tile_root / f"{tx}_{ty}.webp"
            if not src.is_file():
                continue
            try:
                im = Image.open(src).convert("RGB")
            except OSError:
                continue
            if im.size != (TILE_PX, TILE_PX):
                im = im.resize((TILE_PX, TILE_PX), Image.Resampling.BILINEAR)
            canvas.paste(im, (tx * TILE_PX, ty * TILE_PX))
            pasted += 1
    if pasted == 0:
        return None
    out.parent.mkdir(parents=True, exist_ok=True)
    quality = 80 if zoom >= 5 else 86
    canvas.save(out, "JPEG", quality=quality, optimize=True)
    return out
