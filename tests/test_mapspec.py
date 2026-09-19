from wardogs_map.mapspec import load_map, list_map_ids, metres_to_game


def test_load_bakurani():
    spec = load_map("bakurani")
    assert spec["id"] == "bakurani"
    assert spec["coordinateMetersPerUnit"] == 100
    assert spec["tileTemplate"].startswith("/tiles/bakurani/grayscale/")
    assert spec["bounds"]["minX"] == 23.35


def test_metres_to_game():
    assert metres_to_game(8364, 100) == 83.64


def test_list_map_ids():
    ids = list_map_ids()
    assert ids == ["bakurani", "ozeti", "zestafona"]
