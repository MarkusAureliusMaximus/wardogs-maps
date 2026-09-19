from pathlib import Path
import wardogs_map.paths as paths


def test_roots_live_under_this_repo():
    assert paths.ROOT.name == "wardogs-map-studio"
    assert paths.MAPS_DIR == paths.ROOT / "maps"
    assert paths.CACHE_DIR == paths.ROOT / "data" / "cache"
    assert paths.BAKED_DIR == paths.ROOT / "data" / "baked"
    assert paths.WEB_DIR == paths.ROOT / "web"


def test_python_sources_do_not_name_the_game_install():
    root = Path(__file__).resolve().parents[1]
    # Adjacent literals avoid embedding banned tokens in this file.
    banned = ("steam" "apps", "Wardogs" "Client", "pak" "chunk", ".uc" "as", ".ut" "oc")
    for path in root.rglob("*.py"):
        if ".venv" in path.parts or path.parts[-2:] == (".git",):
            continue
        text = path.read_text(encoding="utf-8")
        for token in banned:
            assert token not in text, f"{path} contains {token}"
