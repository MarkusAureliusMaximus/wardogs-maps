import hashlib
from wardogs_map.download import fetch_file, verify_chunk

def test_fetch_file_skips_existing_nonzero(tmp_path):
    dest = tmp_path / "a.bin"
    dest.write_bytes(b"hello")
    assert fetch_file("http://127.0.0.1:1/missing", dest) == "skipped"

def test_verify_chunk_sha_and_size(tmp_path):
    data = b"abc"
    p = tmp_path / "c.bin"
    p.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    assert verify_chunk(p, bytes_expected=3, sha256_hex=digest) is True
    assert verify_chunk(p, bytes_expected=9, sha256_hex=digest) is False
