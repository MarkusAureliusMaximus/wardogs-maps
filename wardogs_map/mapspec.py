import json
from wardogs_map.paths import MAPS_DIR


def metres_to_game(metres: float, meters_per_unit: float) -> float:
    return metres / meters_per_unit


def load_map(map_id: str) -> dict:
    path = MAPS_DIR / f"{map_id}.json"
    spec = json.loads(path.read_text(encoding="utf-8"))
    spec["tileTemplate"] = f"/tiles/{map_id}/grayscale/{{z}}/{{x}}/{{y}}.webp"
    spec["colorTileTemplate"] = f"/tiles/{map_id}/color/{{z}}/{{x}}/{{y}}.webp"
    spec["hillshadeTemplate"] = f"/overlay/{map_id}/hillshade/{{z}}/{{x}}/{{y}}.png"
    spec["hypsometricTemplate"] = f"/overlay/{map_id}/hypsometric/{{z}}/{{x}}/{{y}}.png"
    spec["contoursUrl"] = f"/overlay/{map_id}/contours.geojson"
    return spec


def list_map_ids() -> list[str]:
    index = json.loads((MAPS_DIR / "index.json").read_text(encoding="utf-8"))
    return [name.removesuffix(".json") for name in index]
