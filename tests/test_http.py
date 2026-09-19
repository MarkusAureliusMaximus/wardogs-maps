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


def test_make_context_lists_maps_not_ready():
    from wardogs_map.httpapp import make_context

    ctx = make_context()
    assert ctx.stores == {}
    assert ctx.status["maps"]["bakurani"]["ready"] is False
    assert ctx.status["maps"]["ozeti"]["ready"] is False
    assert ctx.status["maps"]["zestafona"]["ready"] is False
