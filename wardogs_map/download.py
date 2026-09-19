import hashlib
import json
import socket
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from wardogs_map import paths
from wardogs_map.height import world_z

ASSETS_BASE = "https://assets.wardogs-artillery.com/releases/assets-v1"
MAX_ZOOM = 7
RETRIES = 2


def _is_timeout(exc: BaseException) -> bool:
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return True
    if isinstance(exc, urllib.error.URLError):
        return _is_timeout(exc.reason) if exc.reason is not None else False
    return False


def fetch_file(url: str, dest: Path) -> str:
    if dest.exists() and dest.stat().st_size > 0:
        return "skipped"

    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(".part")
    attempts = RETRIES + 1

    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                data = resp.read()
            part.write_bytes(data)
            part.replace(dest)
            return "ok"
        except urllib.error.HTTPError as exc:
            if exc.code < 500 or attempt + 1 >= attempts:
                break
        except (TimeoutError, socket.timeout, urllib.error.URLError, OSError) as exc:
            if isinstance(exc, urllib.error.URLError) and not _is_timeout(exc):
                # Only timeouts are retried among URLErrors; other network
                # failures still get the same retry budget for prepare resilience.
                pass
            if attempt + 1 >= attempts:
                break

    if part.exists():
        part.unlink(missing_ok=True)
    return "fail"


def verify_chunk(path: Path, bytes_expected: int, sha256_hex: str) -> bool:
    if not path.exists():
        return False
    data = path.read_bytes()
    if len(data) != bytes_expected:
        return False
    return hashlib.sha256(data).hexdigest() == sha256_hex


def _tile_url(map_id: str, style: str, z: int, x: int, y: int) -> str:
    root = "tiles" if style == "grayscale" else "tiles-color"
    return f"{ASSETS_BASE}/maps/{root}/{map_id}/zoom_{z}/{x}_{y}.webp"


def _manifest_url(map_id: str) -> str:
    return f"{ASSETS_BASE}/data/terrain/{map_id}/manifest.json"


def prepare_map(map_id: str) -> bool:
    cache_dir = paths.CACHE_DIR
    baked_dir = paths.BAKED_DIR
    cache_dir.mkdir(parents=True, exist_ok=True)
    baked_dir.mkdir(parents=True, exist_ok=True)

    for z in range(0, MAX_ZOOM + 1):
        side = 1 << z
        n = side * side
        i = 0
        for x in range(side):
            for y in range(side):
                i += 1
                print(f"{map_id} zoom {z} tile {i}/{n}", flush=True)
                for style in ("grayscale", "color"):
                    dest = (
                        cache_dir
                        / "tiles"
                        / map_id
                        / style
                        / f"zoom_{z}"
                        / f"{x}_{y}.webp"
                    )
                    fetch_file(_tile_url(map_id, style, z, x, y), dest)

    manifest_url = _manifest_url(map_id)
    manifest_path = cache_dir / "terrain" / map_id / "manifest.json"
    result = fetch_file(manifest_url, manifest_path)
    if result == "fail" or not manifest_path.exists():
        return False

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    chunks = manifest.get("chunks") or {}
    verified_entries: list[dict] = []
    fail_count = 0

    for _key, entry in chunks.items():
        rel = entry["file"]
        chunk_url = urllib.parse.urljoin(manifest_url, rel)
        chunk_path = cache_dir / "terrain" / map_id / rel
        fetch_file(chunk_url, chunk_path)
        ok = verify_chunk(
            chunk_path,
            bytes_expected=int(entry["bytes"]),
            sha256_hex=str(entry["sha256"]),
        )
        if ok:
            verified_entries.append(entry)
        else:
            fail_count += 1
            if chunk_path.exists():
                chunk_path.unlink()
            print(f"{map_id} chunk fail {rel} ({fail_count})", flush=True)

    if not verified_entries:
        return False

    zs = []
    for entry in verified_entries:
        zs.append(world_z(manifest, float(entry["minLocalZ"])))
        zs.append(world_z(manifest, float(entry["maxLocalZ"])))

    stats_path = baked_dir / map_id / "height-stats.json"
    stats_path.parent.mkdir(parents=True, exist_ok=True)
    stats_path.write_text(
        json.dumps(
            {
                "mapMinWorldZ": min(zs),
                "mapMaxWorldZ": max(zs),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return True


def prepare_all(ids: list[str]) -> bool:
    return all(prepare_map(map_id) for map_id in ids)
