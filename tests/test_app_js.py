from pathlib import Path

APP_JS = Path(__file__).resolve().parents[1] / "web" / "app.js"


def _set_readout_source() -> str:
    src = APP_JS.read_text(encoding="utf-8")
    start = src.index("function setReadout")
    end = src.index("\nfunction ", start + 1)
    return src[start:end]


def test_cz_is_two_km_in_game_units():
    src = APP_JS.read_text(encoding="utf-8")
    assert "const CZ_GAME_SIZE = 20.0" in src


def test_measure_tool_present():
    src = APP_JS.read_text(encoding="utf-8")
    assert 'action === "measure"' in src
    assert "azimuthDeg" in src


def test_markers_render_tower_labels():
    src = APP_JS.read_text(encoding="utf-8")
    assert "wd-pin-label" in src
    assert "communityMarkerIcon(m.icon, m.label)" in src
    assert 'm.icon === "tower"' in src


def test_cz_drag_uses_pointer_events():
    src = APP_JS.read_text(encoding="utf-8")
    assert "pointerdown" in src
    assert "setPointerCapture" in src
    assert "touchZoom.disable" in src
    assert "clampCzOrigin" in src


def test_set_readout_keeps_coords_when_z_missing():
    fn = _set_readout_source()
    assert "toFixed(2)" in fn
    assert '"X "' in fn
    assert '"  Y "' in fn
    assert "coords +" in fn
    assert "rel —" in fn or "no coverage" in fn
