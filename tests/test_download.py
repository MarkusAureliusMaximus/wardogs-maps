import hashlib
from wardogs_map.download import fetch_file, prepare_all, verify_chunk


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
