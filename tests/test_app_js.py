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


def test_3d_syncs_all_2d_marks_and_hires_texture():
    src = APP_JS.read_text(encoding="utf-8")
    assert "collectMarks" in src
    assert "sync3dOverlays" in src
    table = (APP_JS.parent / "table3d.js").read_text(encoding="utf-8")
    assert "table-color.jpg?z=" in table
    assert "metersToWorld" in table
    assert "setMarks" in table


def test_export_fullscreen_intel_and_north():
    src = APP_JS.read_text(encoding="utf-8")
    assert "exportPng" in src
    assert "toggleFullscreen" in src
    assert "addIntelAt" in src
    assert "enemy-fob" in src
    assert "gridRef" in src
    html = (APP_JS.parent / "index.html").read_text(encoding="utf-8")
    assert 'id="north"' in html
    assert "html2canvas.min.js" in html


def test_profile_pins_and_share():
    src = APP_JS.read_text(encoding="utf-8")
    assert "fetchProfile" in src
    assert "addPinHere" in src
    assert "updateShareUrl" in src
    assert "parseShare" in src
    assert 'action === "pin"' in src
    assert 'action === "share"' in src


def test_grid_and_copy_and_prefs():
    src = APP_JS.read_text(encoding="utf-8")
    assert "addKmGrid" in src
    assert 'action === "copy"' in src
    assert "wardogs-maps-prefs" in src


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
