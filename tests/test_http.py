import json
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from wardogs_map.httpapp import StudioHandler


class _Ctx:
    def __init__(self, stores, status):
        self.stores = stores
        self.status = status


def _serve(handler_cls):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd


def test_status_and_missing_sample():
    class H(StudioHandler):
        context = _Ctx(stores={}, status={"maps": {"bakurani": {"ready": False}}})

    httpd = _serve(H)
    try:
        port = httpd.server_address[1]
        conn = HTTPConnection("127.0.0.1", port, timeout=5)
        conn.request("GET", "/api/status")
        res = conn.getresponse()
        assert res.status == 200
        body = json.loads(res.read())
        assert body["maps"]["bakurani"]["ready"] is False
        conn.request("GET", "/api/sample?map=bakurani&x=81.2&y=74.6")
        res = conn.getresponse()
        assert res.status == 200
        sample = json.loads(res.read())
        assert sample["ok"] is False
        assert sample["inCoverage"] is False
        assert sample["relZ"] is None
    finally:
        httpd.shutdown()


def test_maps_json_and_method_not_allowed():
    class H(StudioHandler):
        context = _Ctx(stores={}, status={"maps": {}})

    httpd = _serve(H)
    try:
        conn = HTTPConnection("127.0.0.1", httpd.server_address[1], timeout=5)
        conn.request("GET", "/maps/bakurani.json")
        res = conn.getresponse()
        assert res.status == 200
        body = json.loads(res.read())
        assert body["id"] == "bakurani"
        assert body["colorTileTemplate"] == "/tiles/bakurani/color/{z}/{x}/{y}.webp"
        assert body["hillshadeTemplate"] == "/overlay/bakurani/hillshade/{z}/{x}/{y}.png"
        conn.request("GET", "/maps/index.json")
        res = conn.getresponse()
        assert res.status == 200
        index = json.loads(res.read())
        assert "bakurani.json" in index
        conn.request("POST", "/maps/bakurani.json")
        res = conn.getresponse()
        assert res.status == 405
        res.read()
        conn.request("POST", "/api/status")
        res = conn.getresponse()
        assert res.status == 405
        res.read()
    finally:
        httpd.shutdown()


def test_path_traversal_is_404():
    class H(StudioHandler):
        context = _Ctx(stores={}, status={"maps": {}})

    httpd = _serve(H)
    try:
        conn = HTTPConnection("127.0.0.1", httpd.server_address[1], timeout=5)
        conn.request("GET", "/maps/../wardogs_map/__init__.py")
        res = conn.getresponse()
        assert res.status == 404
        res.read()
        conn.request("GET", "/maps/bakurani.json/../../README.md")
        res = conn.getresponse()
        assert res.status == 404
        res.read()
    finally:
        httpd.shutdown()


def test_sample_merges_store_fields():
    from wardogs_map.terrain import Sample

    class _Store:
        def sample(self, x, y):
            assert x == 81.2
            assert y == 74.6
            return Sample(True, True, 42.1, 100.0)

    class H(StudioHandler):
        context = _Ctx(
            stores={"bakurani": _Store()},
            status={"maps": {"bakurani": {"ready": False}}},
        )

    httpd = _serve(H)
    try:
        conn = HTTPConnection("127.0.0.1", httpd.server_address[1], timeout=5)
        conn.request("GET", "/api/sample?map=bakurani&x=81.2&y=74.6")
        res = conn.getresponse()
        assert res.status == 200
        sample = json.loads(res.read())
        assert sample["ok"] is True
        assert sample["inCoverage"] is True
        assert sample["relZ"] == 42.1
        assert sample["map"] == "bakurani"
        assert sample["x"] == 81.2
        assert sample["y"] == 74.6
        assert "world_z" not in sample
        assert "worldZ" not in sample
        assert "in_coverage" not in sample
        assert "rel_z" not in sample
    finally:
        httpd.shutdown()


def test_sample_ok_false_forces_in_coverage_false():
    from wardogs_map.terrain import Sample

    class _Store:
        def sample(self, x, y):
            return Sample(False, True, None, None)

    class H(StudioHandler):
        context = _Ctx(
            stores={"bakurani": _Store()},
            status={"maps": {"bakurani": {"ready": False}}},
        )

    httpd = _serve(H)
    try:
        conn = HTTPConnection("127.0.0.1", httpd.server_address[1], timeout=5)
        conn.request("GET", "/api/sample?map=bakurani&x=81.2&y=74.6")
        res = conn.getresponse()
        assert res.status == 200
        sample = json.loads(res.read())
        assert sample["ok"] is False
        assert sample["inCoverage"] is False
        assert sample["relZ"] is None
    finally:
        httpd.shutdown()


def test_make_context_lists_maps_not_ready(tmp_path, monkeypatch):
    from wardogs_map import paths
    from wardogs_map.httpapp import make_context

    monkeypatch.setattr(paths, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(paths, "BAKED_DIR", tmp_path / "baked")
    ctx = make_context()
    assert ctx.stores == {}
    assert ctx.status["maps"]["bakurani"]["ready"] is False
    assert ctx.status["maps"]["ozeti"]["ready"] is False
    assert ctx.status["maps"]["zestafona"]["ready"] is False


def test_make_context_skips_chunk_outside_map_dir(tmp_path, monkeypatch):
    import hashlib
    from wardogs_map import paths
    from wardogs_map.httpapp import make_context

    cache = tmp_path / "cache"
    monkeypatch.setattr(paths, "CACHE_DIR", cache)
    monkeypatch.setattr(paths, "BAKED_DIR", tmp_path / "baked")
    data = b"secret"
    terrain = cache / "terrain" / "bakurani"
    terrain.mkdir(parents=True)
    secret = cache / "terrain" / "secret.bin"
    secret.write_bytes(data)
    (terrain / "manifest.json").write_text(
        json.dumps(
            {
                "chunks": {
                    "1,2": {
                        "file": "../secret.bin",
                        "bytes": len(data),
                        "sha256": hashlib.sha256(data).hexdigest(),
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    ctx = make_context()
    assert "bakurani" not in ctx.stores
    assert secret.read_bytes() == data


def test_main_bind_failed_exits(monkeypatch):
    import pytest
    import server as server_mod

    monkeypatch.setattr(server_mod, "make_context", lambda: None)

    def boom(*_args, **_kwargs):
        raise OSError("Address already in use")

    monkeypatch.setattr(server_mod, "ThreadingHTTPServer", boom)
    monkeypatch.setattr("sys.argv", ["server.py", "--host", "127.0.0.1", "--port", "1"])
    with pytest.raises(SystemExit, match="bind failed"):
        server_mod.main()


def test_tile_and_overlay_and_traversal(tmp_path, monkeypatch):
    from wardogs_map import paths

    monkeypatch.setattr(paths, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(paths, "BAKED_DIR", tmp_path / "baked")
    tile = paths.CACHE_DIR / "tiles" / "bakurani" / "color" / "zoom_0" / "0_0.webp"
    tile.parent.mkdir(parents=True, exist_ok=True)
    tile.write_bytes(b"RIFF....WEBP")
    overlay = paths.BAKED_DIR / "bakurani" / "hillshade" / "zoom_0" / "0_0.png"
    overlay.parent.mkdir(parents=True, exist_ok=True)
    overlay.write_bytes(b"\x89PNG")
    hypo = paths.BAKED_DIR / "bakurani" / "hypsometric" / "zoom_0" / "0_0.png"
    hypo.parent.mkdir(parents=True, exist_ok=True)
    hypo.write_bytes(b"\x89PNG")
    contours = paths.BAKED_DIR / "bakurani" / "contours.geojson"
    contours.parent.mkdir(parents=True, exist_ok=True)
    contours.write_text('{"type":"FeatureCollection","features":[]}', encoding="utf-8")

    class H(StudioHandler):
        context = _Ctx(stores={}, status={"maps": {}})

    httpd = _serve(H)
    try:
        port = httpd.server_address[1]
        conn = HTTPConnection("127.0.0.1", port, timeout=5)

        conn.request("GET", "/tiles/bakurani/color/0/0/0.webp")
        res = conn.getresponse()
        assert res.status == 200
        assert res.getheader("Content-Type") == "image/webp"
        assert res.read() == b"RIFF....WEBP"

        conn.request("GET", "/overlay/bakurani/hillshade/0/0/0.png")
        res = conn.getresponse()
        assert res.status == 200
        assert res.getheader("Content-Type") == "image/png"
        assert res.read() == b"\x89PNG"

        conn.request("GET", "/overlay/bakurani/hypsometric/0/0/0.png")
        res = conn.getresponse()
        assert res.status == 200
        assert res.getheader("Content-Type") == "image/png"
        assert res.read() == b"\x89PNG"

        conn.request("GET", "/overlay/bakurani/contours.geojson")
        res = conn.getresponse()
        assert res.status == 200
        assert res.getheader("Content-Type") == "application/json"
        res.read()

        conn.request("GET", "/tiles/bakurani/color/0/../0/0.webp")
        res = conn.getresponse()
        assert res.status == 404
        res.read()
    finally:
        httpd.shutdown()


def test_index_served():
    class H(StudioHandler):
        context = _Ctx(stores={}, status={"maps": {}})

    httpd = _serve(H)
    try:
        conn = HTTPConnection("127.0.0.1", httpd.server_address[1], timeout=5)
        conn.request("GET", "/")
        res = conn.getresponse()
        body = res.read()
        assert res.status == 200
        assert b"leaflet" in body.lower()
        assert b"unpkg" not in body.lower()
        assert b"cdnjs" not in body.lower()
        assert b"jsdelivr" not in body.lower()
        conn.request("GET", "/vendor/leaflet.js")
        res = conn.getresponse()
        assert res.status == 200
        res.read()
        conn.request("GET", "/web/app.js")
        res = conn.getresponse()
        assert res.status == 200
        res.read()
        conn.request("GET", "/web/app.css")
        res = conn.getresponse()
        assert res.status == 200
        res.read()
        conn.request("GET", "/vendor/../index.html")
        res = conn.getresponse()
        assert res.status == 404
        res.read()
    finally:
        httpd.shutdown()


def test_random_cz_inside_bounds():
    class H(StudioHandler):
        context = _Ctx(stores={}, status={"maps": {}})

    httpd = _serve(H)
    try:
        conn = HTTPConnection("127.0.0.1", httpd.server_address[1], timeout=5)
        conn.request("GET", "/api/cz/random?map=bakurani")
        res = conn.getresponse()
        assert res.status == 200
        body = json.loads(res.read())
        from wardogs_map.cz import CZ_GAME_SIZE
        from wardogs_map.mapspec import load_map

        b = load_map("bakurani")["bounds"]
        assert body["minX"] >= b["minX"]
        assert body["minY"] >= b["minY"]
        assert body["maxX"] <= b["maxX"]
        assert body["maxY"] <= b["maxY"]
        assert abs(body["maxX"] - body["minX"] - CZ_GAME_SIZE) < 1e-9
        assert abs(body["maxY"] - body["minY"] - CZ_GAME_SIZE) < 1e-9
    finally:
        httpd.shutdown()
