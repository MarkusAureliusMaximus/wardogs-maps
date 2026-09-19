import hashlib
import json
from pathlib import Path

from wardogs_map.download import (
    allowed_fetch_url,
    jailed_chunk_path,
    prepare_map,
    verify_chunk,
)


def test_relative_chunk_file_is_accepted(tmp_path):
    map_terrain_dir = tmp_path / "m"
    map_terrain_dir.mkdir()
    chunk_path = jailed_chunk_path(map_terrain_dir, "chunks/1_2.bin")
    assert chunk_path is not None
    rel = chunk_path.resolve().relative_to(map_terrain_dir.resolve())
    assert rel == Path("chunks") / "1_2.bin"


def test_parent_chunk_file_is_rejected(tmp_path):
    map_terrain_dir = tmp_path / "m"
    map_terrain_dir.mkdir()
    secret = tmp_path / "secret.bin"
    secret.write_bytes(b"keep-me")
    assert jailed_chunk_path(map_terrain_dir, "../secret.bin") is None
    assert secret.read_bytes() == b"keep-me"


def test_drive_chunk_file_is_rejected(tmp_path):
    map_terrain_dir = tmp_path / "m"
    map_terrain_dir.mkdir()
    assert jailed_chunk_path(map_terrain_dir, "C:/Windows/win.ini") is None


def test_allowed_fetch_url_https_assets_and_loopback():
    manifest = (
        "https://assets.wardogs-artillery.com/releases/assets-v1/"
        "data/terrain/bakurani/manifest.json"
    )
    assert allowed_fetch_url(manifest) is True
    assert allowed_fetch_url("http://127.0.0.1:1/missing") is True
    assert allowed_fetch_url("file:///C:/Windows/win.ini") is False
    assert allowed_fetch_url("https://example.com/chunks/1_2.bin") is False
    assert allowed_fetch_url("http://assets.wardogs-artillery.com/x") is False


def test_verify_chunk_does_not_read_when_stat_size_differs(tmp_path, monkeypatch):
    path = tmp_path / "c.bin"
    path.write_bytes(b"abc")
    digest = hashlib.sha256(b"abc").hexdigest()

    def boom(self):
        raise AssertionError("read_bytes")

    monkeypatch.setattr(Path, "read_bytes", boom)
    assert verify_chunk(path, bytes_expected=999, sha256_hex=digest) is False


def test_prepare_map_does_not_fetch_or_unlink_escaped_chunk(tmp_path, monkeypatch):
    from wardogs_map import download, paths

    monkeypatch.setattr(paths, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(paths, "BAKED_DIR", tmp_path / "baked")
    monkeypatch.setattr(download, "MAX_ZOOM", -1)

    secret = tmp_path / "secret.bin"
    secret.write_bytes(b"keep-me")
    dests: list[Path] = []

    def fake_fetch(url, dest):
        dests.append(Path(dest).resolve())
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.name == "manifest.json":
            dest.write_text(
                json.dumps(
                    {
                        "chunks": {
                            "1,2": {
                                "file": "../secret.bin",
                                "bytes": 7,
                                "sha256": "00",
                                "minLocalZ": 0,
                                "maxLocalZ": 1,
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            return "ok"
        raise AssertionError(f"unexpected fetch {url} -> {dest}")

    monkeypatch.setattr(download, "fetch_file", fake_fetch)

    unlinked: list[Path] = []
    real_unlink = Path.unlink

    def spy_unlink(self, *args, **kwargs):
        unlinked.append(self.resolve())
        return real_unlink(self, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", spy_unlink)

    assert prepare_map("bakurani") is False
    assert secret.read_bytes() == b"keep-me"
    assert secret.resolve() not in dests
    assert secret.resolve() not in unlinked
    assert not any(p.name == "secret.bin" for p in dests)
