import hashlib
import json
import socket
import threading
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from wardogs_map import paths
from wardogs_map.height import world_z
from wardogs_map.mapspec import load_map
from wardogs_map.overlays import bake_map
from wardogs_map.terrain import TerrainStore

ASSETS_BASE = "https://assets.wardogs-artillery.com/releases/assets-v1"
ASSETS_NETLOC = "assets.wardogs-artillery.com"
MAX_ZOOM = 7
RETRIES = 2
TILE_WORKERS = 16
USER_AGENT = "Mozilla/5.0 (compatible; wardogs-map-studio/1.0)"


def allowed_fetch_url(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme == "https" and parsed.netloc == ASSETS_NETLOC:
        return True
    if parsed.scheme == "http" and parsed.hostname == "127.0.0.1":
        return True
    return False


def _is_relative_chunk_file(rel: str) -> bool:
    if not isinstance(rel, str) or not rel:
        return False
    if rel.startswith(("/", "\\")) or "://" in rel:
        return False
    if len(rel) >= 2 and rel[0].isalpha() and rel[1] == ":":
        return False
    candidate = Path(rel)
    if candidate.is_absolute() or bool(candidate.drive):
        return False
    if any(part == ".." for part in candidate.parts):
        return False
    if any(part == ".." for part in rel.replace("\\", "/").split("/")):
        return False
    return True


def jailed_chunk_path(map_terrain_dir: Path, rel: object) -> Path | None:
    if not _is_relative_chunk_file(rel if isinstance(rel, str) else ""):
        return None
    chunk_path = map_terrain_dir / rel
    try:
        chunk_path.resolve().relative_to(map_terrain_dir.resolve())
    except (ValueError, OSError):
        return None
    return chunk_path


def _unlink_under_map_dir(map_terrain_dir: Path, chunk_path: Path) -> None:
    try:
        chunk_path.resolve().relative_to(map_terrain_dir.resolve())
    except (ValueError, OSError):
        return
    try:
        chunk_path.unlink(missing_ok=True)
    except OSError:
        return


def _is_timeout(exc: BaseException) -> bool:
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return True
    if isinstance(exc, urllib.error.URLError):
        return _is_timeout(exc.reason) if exc.reason is not None else False
    return False


def fetch_file(url: str, dest: Path) -> str:
    if not allowed_fetch_url(url):
        return "fail"
    if dest.exists() and dest.stat().st_size > 0:
        return "skipped"

    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(".part")
    attempts = RETRIES + 1

    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=60) as resp:
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


def fetch_many(jobs: list[tuple[str, Path]], workers: int = TILE_WORKERS) -> dict[str, int]:
    """Download independent files concurrently. Returns counts of ok/skipped/fail."""
    counts = {"ok": 0, "skipped": 0, "fail": 0}
    if not jobs:
        return counts
    lock = threading.Lock()
    total = len(jobs)
    done = 0

    def run(job: tuple[str, Path]) -> str:
        url, dest = job
        return fetch_file(url, dest)

    workers = max(1, min(workers, total))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(run, job) for job in jobs]
        for future in as_completed(futures):
            result = future.result()
            with lock:
                counts[result] = counts.get(result, 0) + 1
                done += 1
                if done == total or done % 64 == 0:
                    print(
                        f"fetch {done}/{total} ok={counts['ok']} skip={counts['skipped']} fail={counts['fail']}",
                        flush=True,
                    )
    return counts


def verify_chunk(path: Path, bytes_expected: int, sha256_hex: str) -> bool:
    try:
        if path.stat().st_size != bytes_expected:
            return False
        data = path.read_bytes()
    except OSError:
        return False
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

    tile_jobs: list[tuple[str, Path]] = []
    for z in range(0, MAX_ZOOM + 1):
        side = 1 << z
        for x in range(side):
            for y in range(side):
                for style in ("grayscale", "color"):
                    dest = (
                        cache_dir
                        / "tiles"
                        / map_id
                        / style
                        / f"zoom_{z}"
                        / f"{x}_{y}.webp"
                    )
                    tile_jobs.append((_tile_url(map_id, style, z, x, y), dest))
    print(f"{map_id} fetching {len(tile_jobs)} tiles ({TILE_WORKERS} workers)", flush=True)
    tile_counts = fetch_many(tile_jobs, workers=TILE_WORKERS)
    print(
        f"{map_id} tiles done ok={tile_counts['ok']} skip={tile_counts['skipped']} fail={tile_counts['fail']}",
        flush=True,
    )

    manifest_url = _manifest_url(map_id)
    if not allowed_fetch_url(manifest_url):
        return False
    map_terrain_dir = cache_dir / "terrain" / map_id
    manifest_path = map_terrain_dir / "manifest.json"
    result = fetch_file(manifest_url, manifest_path)
    if result == "fail" or not manifest_path.exists():
        return False

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    chunks = manifest.get("chunks") or {}
    verified_entries: list[dict] = []
    verified_bins: dict[str, bytes] = {}
    fail_count = 0
    chunk_jobs: list[tuple[str, Path]] = []
    pending: list[tuple[str, dict, Path]] = []

    for key, entry in chunks.items():
        rel = entry["file"] if isinstance(entry, dict) else None
        chunk_path = jailed_chunk_path(map_terrain_dir, rel)
        if chunk_path is None:
            fail_count += 1
            print(f"{map_id} chunk fail {rel} ({fail_count})", flush=True)
            continue
        chunk_url = urllib.parse.urljoin(manifest_url, str(rel).replace("\\", "/"))
        if not allowed_fetch_url(chunk_url):
            fail_count += 1
            print(f"{map_id} chunk fail {rel} ({fail_count})", flush=True)
            continue
        chunk_jobs.append((chunk_url, chunk_path))
        pending.append((key, entry, chunk_path))

    if chunk_jobs:
        print(f"{map_id} fetching {len(chunk_jobs)} chunks ({TILE_WORKERS} workers)", flush=True)
        fetch_many(chunk_jobs, workers=TILE_WORKERS)

    for key, entry, chunk_path in pending:
        rel = entry["file"]
        ok = verify_chunk(
            chunk_path,
            bytes_expected=int(entry["bytes"]),
            sha256_hex=str(entry["sha256"]),
        )
        if ok:
            try:
                if chunk_path.stat().st_size != int(entry["bytes"]):
                    raise OSError("size")
                verified_bins[key] = chunk_path.read_bytes()
            except OSError:
                ok = False
        if ok:
            verified_entries.append(entry)
        else:
            fail_count += 1
            _unlink_under_map_dir(map_terrain_dir, chunk_path)
            print(f"{map_id} chunk fail {rel} ({fail_count})", flush=True)

    if not verified_entries:
        return False

    zs = []
    for entry in verified_entries:
        zs.append(world_z(manifest, float(entry["minLocalZ"])))
        zs.append(world_z(manifest, float(entry["maxLocalZ"])))

    map_min = min(zs)
    stats_path = baked_dir / map_id / "height-stats.json"
    stats_path.parent.mkdir(parents=True, exist_ok=True)
    stats_path.write_text(
        json.dumps(
            {
                "mapMinWorldZ": map_min,
                "mapMaxWorldZ": max(zs),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    try:
        spec = load_map(map_id)
        store = TerrainStore(manifest, verified_bins, map_min_world_z=map_min)
        if not bake_map(map_id, store, spec):
            return False
    except Exception as exc:
        print(f"{map_id} bake fail {exc}", flush=True)
        ready = baked_dir / map_id / "READY"
        ready.unlink(missing_ok=True)
        return False
    return True


def prepare_all(ids: list[str]) -> bool:
    ok = True
    for map_id in ids:
        if not prepare_map(map_id):
            ok = False
    return ok
