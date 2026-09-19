import hashlib
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from wardogs_map.download import fetch_file, fetch_many, prepare_all, verify_chunk


def test_fetch_file_skips_existing_nonzero(tmp_path):
    dest = tmp_path / "a.bin"
    dest.write_bytes(b"hello")
    assert fetch_file("http://127.0.0.1:1/missing", dest) == "skipped"


def test_fetch_file_rejects_disallowed_url(tmp_path, monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("urlopen")

    monkeypatch.setattr("wardogs_map.download.urllib.request.urlopen", boom)
    dest = tmp_path / "x.bin"
    assert fetch_file("file:///C:/Windows/win.ini", dest) == "fail"
    assert fetch_file("https://example.com/chunks/1_2.bin", dest) == "fail"
    assert not dest.exists()


def test_fetch_file_sends_user_agent(tmp_path):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            ua = self.headers.get("User-Agent") or ""
            if "wardogs-map-studio" in ua:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"tile")
            else:
                self.send_response(403)
                self.end_headers()

        def log_message(self, *_args):
            return

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        dest = tmp_path / "0_0.webp"
        url = f"http://127.0.0.1:{httpd.server_address[1]}/0_0.webp"
        assert fetch_file(url, dest) == "ok"
        assert dest.read_bytes() == b"tile"
    finally:
        httpd.shutdown()


def test_fetch_many_downloads_in_parallel(tmp_path):
    hits = {"n": 0}
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            with lock:
                hits["n"] += 1
            self.send_response(200)
            self.end_headers()
            self.wfile.write(self.path.encode("ascii"))

        def log_message(self, *_args):
            return

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        port = httpd.server_address[1]
        jobs = [
            (f"http://127.0.0.1:{port}/{i}.bin", tmp_path / f"{i}.bin")
            for i in range(8)
        ]
        counts = fetch_many(jobs, workers=8)
        assert counts["ok"] == 8
        assert counts["fail"] == 0
        assert hits["n"] == 8
        assert (tmp_path / "3.bin").read_bytes() == b"/3.bin"
    finally:
        httpd.shutdown()


def test_verify_chunk_sha_and_size(tmp_path):
    data = b"abc"
    p = tmp_path / "c.bin"
    p.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    assert verify_chunk(p, bytes_expected=3, sha256_hex=digest) is True
    assert verify_chunk(p, bytes_expected=9, sha256_hex=digest) is False


def test_prepare_all_runs_every_map(monkeypatch):
    from wardogs_map import download

    seen: list[str] = []

    def fake_prepare(map_id: str) -> bool:
        seen.append(map_id)
        return False

    monkeypatch.setattr(download, "prepare_map", fake_prepare)
    assert prepare_all(["bakurani", "ozeti", "zestafona"]) is False
    assert seen == ["bakurani", "ozeti", "zestafona"]


def test_prepare_all_true_only_if_all_succeeded(monkeypatch):
    from wardogs_map import download

    def fake_prepare(map_id: str) -> bool:
        return map_id != "ozeti"

    monkeypatch.setattr(download, "prepare_map", fake_prepare)
    assert prepare_all(["bakurani", "ozeti", "zestafona"]) is False

    monkeypatch.setattr(download, "prepare_map", lambda _map_id: True)
    assert prepare_all(["bakurani", "ozeti"]) is True
