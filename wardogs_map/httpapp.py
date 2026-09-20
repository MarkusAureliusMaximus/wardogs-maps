from __future__ import annotations

import json
import posixpath
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from wardogs_map import paths
from wardogs_map.cz import randomize_cz, zone_height_stats
from wardogs_map.download import jailed_chunk_path, verify_chunk
from wardogs_map.heightgrid import DEFAULT_N, load_or_build_heightgrid
from wardogs_map.table_assets import stitch_table_color, table_color_path
from wardogs_map.mapspec import list_map_ids, load_map
from wardogs_map.profile import elevation_profile
from wardogs_map.paths import MAPS_DIR, WEB_DIR
from wardogs_map.terrain import TerrainStore

_CONTENT_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".geojson": "application/json",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
}


def _content_type(path: Path) -> str:
    return _CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")


@dataclass
class StudioContext:
    stores: dict
    status: dict


def make_context() -> StudioContext:
    stores: dict = {}
    status_maps: dict = {}
    for map_id in list_map_ids():
        ready = (paths.BAKED_DIR / map_id / "READY").is_file()
        status_maps[map_id] = {"ready": ready}
        manifest_path = paths.CACHE_DIR / "terrain" / map_id / "manifest.json"
        if not manifest_path.is_file():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        verified_bins: dict[str, bytes] = {}
        map_terrain_dir = paths.CACHE_DIR / "terrain" / map_id
        for key, entry in (manifest.get("chunks") or {}).items():
            if not isinstance(entry, dict):
                continue
            chunk_path = jailed_chunk_path(map_terrain_dir, entry.get("file"))
            if chunk_path is None:
                continue
            try:
                expected = int(entry["bytes"])
                sha = str(entry["sha256"])
            except (KeyError, TypeError, ValueError):
                continue
            if not verify_chunk(chunk_path, bytes_expected=expected, sha256_hex=sha):
                continue
            try:
                if chunk_path.stat().st_size != expected:
                    continue
                verified_bins[key] = chunk_path.read_bytes()
            except OSError:
                continue
        if verified_bins:
            map_min: float | None = None
            stats_path = paths.BAKED_DIR / map_id / "height-stats.json"
            if stats_path.is_file():
                try:
                    stats = json.loads(stats_path.read_text(encoding="utf-8"))
                    if "mapMinWorldZ" in stats:
                        map_min = float(stats["mapMinWorldZ"])
                except (OSError, json.JSONDecodeError, TypeError, ValueError):
                    map_min = None
            stores[map_id] = TerrainStore(manifest, verified_bins, map_min_world_z=map_min)
    return StudioContext(stores=stores, status={"maps": status_maps})


class StudioHandler(BaseHTTPRequestHandler):
    context: StudioContext | None = None

    def do_GET(self):
        parsed = urlparse(self.path)
        raw_path = unquote(parsed.path)
        if ".." in raw_path.split("/") or "\\" in raw_path:
            self.send_error(404)
            return
        path = posixpath.normpath(raw_path)
        if path != "/" and not path.startswith("/"):
            self.send_error(404)
            return

        if path == "/api/status":
            self._send_json(self.context.status)
            return
        if path == "/api/sample":
            self._handle_sample(parsed.query)
            return
        if path == "/api/cz/random":
            self._handle_cz_random(parsed.query)
            return
        if path == "/api/cz/stats":
            self._handle_cz_stats(parsed.query)
            return
        if path == "/api/heightgrid":
            self._handle_heightgrid(parsed.query)
            return
        if path == "/api/profile":
            self._handle_profile(parsed.query)
            return
        if path == "/":
            self._send_file(WEB_DIR / "index.html", "text/html; charset=utf-8")
            return
        if path.startswith("/maps/"):
            self._send_maps(path)
            return
        if path.startswith("/tiles/"):
            self._send_tiles(path)
            return
        if path.startswith("/overlay/"):
            self._send_overlay(path, parsed.query)
            return
        if path.startswith("/web/"):
            self._send_static(WEB_DIR, path[len("/web/") :])
            return
        if path.startswith("/vendor/"):
            self._send_static(WEB_DIR / "vendor", path[len("/vendor/") :])
            return
        self.send_error(404)

    def do_POST(self):
        self.send_error(405)

    do_PUT = do_DELETE = do_PATCH = do_HEAD = do_OPTIONS = do_POST

    def _handle_profile(self, query: str) -> None:
        qs = parse_qs(query)
        map_id = (qs.get("map") or [""])[0]
        stores = self.context.stores if self.context is not None else {}
        store = stores.get(map_id)
        try:
            x0 = float((qs.get("x0") or [""])[0])
            y0 = float((qs.get("y0") or [""])[0])
            x1 = float((qs.get("x1") or [""])[0])
            y1 = float((qs.get("y1") or [""])[0])
        except (TypeError, ValueError):
            self.send_error(400)
            return
        if store is None:
            self.send_error(404)
            return
        n_raw = (qs.get("n") or ["80"])[0]
        try:
            n = int(n_raw)
        except (TypeError, ValueError):
            n = 80
        self._send_json(elevation_profile(store, x0, y0, x1, y1, n=n))

    def _handle_heightgrid(self, query: str) -> None:
        qs = parse_qs(query)
        map_id = (qs.get("map") or [""])[0]
        n_raw = (qs.get("n") or [str(DEFAULT_N)])[0]
        try:
            n = int(n_raw)
        except (TypeError, ValueError):
            n = DEFAULT_N
        stores = self.context.stores if self.context is not None else {}
        store = stores.get(map_id)
        if store is None or map_id not in list_map_ids():
            self.send_error(404)
            return
        spec = load_map(map_id)
        stitch_table_color(map_id)
        self._send_json(load_or_build_heightgrid(store, spec, n=n))

    def _handle_cz_stats(self, query: str) -> None:
        qs = parse_qs(query)
        map_id = (qs.get("map") or [""])[0]
        stores = self.context.stores if self.context is not None else {}
        store = stores.get(map_id)
        try:
            square = {
                "minX": float((qs.get("minX") or [""])[0]),
                "minY": float((qs.get("minY") or [""])[0]),
                "maxX": float((qs.get("maxX") or [""])[0]),
                "maxY": float((qs.get("maxY") or [""])[0]),
            }
        except (TypeError, ValueError):
            self.send_error(400)
            return
        if store is None:
            self.send_error(404)
            return
        self._send_json(zone_height_stats(store, square))

    def _handle_cz_random(self, query: str) -> None:
        qs = parse_qs(query)
        map_id = (qs.get("map") or [""])[0]
        if map_id not in list_map_ids():
            self.send_error(404)
            return
        self._send_json(randomize_cz(load_map(map_id)["bounds"]))

    def _handle_sample(self, query: str) -> None:
        qs = parse_qs(query)
        map_id = (qs.get("map") or [""])[0]
        x_raw = (qs.get("x") or [None])[0]
        y_raw = (qs.get("y") or [None])[0]
        try:
            x = float(x_raw) if x_raw not in (None, "") else None
            y = float(y_raw) if y_raw not in (None, "") else None
        except (TypeError, ValueError):
            x, y = None, None

        stores = self.context.stores if self.context is not None else {}
        store = stores.get(map_id)
        if store is None or x is None or y is None:
            self._send_json(
                {
                    "ok": False,
                    "inCoverage": False,
                    "relZ": None,
                    "map": map_id,
                    "x": x,
                    "y": y,
                }
            )
            return

        sample = store.sample(x, y)
        self._send_json(
            {
                "ok": sample.ok,
                "inCoverage": sample.in_coverage if sample.ok else False,
                "relZ": sample.rel_z,
                "map": map_id,
                "x": x,
                "y": y,
            }
        )

    def _send_maps(self, path: str) -> None:
        rel = path[len("/maps/") :]
        if not rel or rel.endswith("/"):
            self.send_error(404)
            return
        candidate = Path(rel)
        if candidate.is_absolute() or ".." in candidate.parts:
            self.send_error(404)
            return
        map_id = candidate.stem
        if candidate.name == f"{map_id}.json" and map_id in list_map_ids():
            self._send_json(load_map(map_id))
            return
        root = MAPS_DIR.resolve()
        target = (MAPS_DIR / candidate).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            self.send_error(404)
            return
        self._send_file(target, "application/json")

    def _send_static(self, root: Path, rel: str) -> None:
        if not rel or rel.endswith("/"):
            self.send_error(404)
            return
        relative = Path(rel)
        self._send_under(root, relative, _content_type(relative))

    def _send_under(self, root: Path, relative: Path, content_type: str) -> None:
        if relative.is_absolute() or ".." in relative.parts:
            self.send_error(404)
            return
        base = root.resolve()
        target = (root / relative).resolve()
        try:
            target.relative_to(base)
        except ValueError:
            self.send_error(404)
            return
        self._send_file(target, content_type)

    def _send_tiles(self, path: str) -> None:
        # /tiles/{map}/{style}/{z}/{x}/{y}.webp
        parts = path.strip("/").split("/")
        if len(parts) != 6 or parts[0] != "tiles":
            self.send_error(404)
            return
        map_id, style, z, x, y_name = parts[1:]
        if not y_name.endswith(".webp"):
            self.send_error(404)
            return
        y = y_name[: -len(".webp")]
        relative = Path("tiles") / map_id / style / f"zoom_{z}" / f"{x}_{y}.webp"
        self._send_under(paths.CACHE_DIR, relative, "image/webp")

    def _send_overlay(self, path: str, query: str = "") -> None:
        # /overlay/{map}/contours.geojson
        # /overlay/{map}/{hillshade|hypsometric}/{z}/{x}/{y}.png
        parts = path.strip("/").split("/")
        if len(parts) < 3 or parts[0] != "overlay":
            self.send_error(404)
            return
        map_id = parts[1]
        if len(parts) == 3 and parts[2] == "contours.geojson":
            relative = Path(map_id) / "contours.geojson"
            self._send_under(paths.BAKED_DIR, relative, "application/json")
            return
        if len(parts) == 3 and parts[2] == "table-color.jpg":
            if map_id not in list_map_ids():
                self.send_error(404)
                return
            qs = parse_qs(query)
            try:
                zoom = int((qs.get("z") or ["5"])[0])
            except (TypeError, ValueError):
                zoom = 5
            if zoom not in (4, 5):
                zoom = 5
            path_out = stitch_table_color(map_id, zoom=zoom)
            if path_out is None:
                path_out = stitch_table_color(map_id, zoom=4)
            if path_out is None:
                self.send_error(404)
                return
            self._send_file(path_out, "image/jpeg")
            return
        if len(parts) == 6 and parts[2] in ("hillshade", "hypsometric"):
            layer, z, x, y_name = parts[2:]
            if not y_name.endswith(".png"):
                self.send_error(404)
                return
            y = y_name[: -len(".png")]
            relative = Path(map_id) / layer / f"zoom_{z}" / f"{x}_{y}.png"
            self._send_under(paths.BAKED_DIR, relative, "image/png")
            return
        self.send_error(404)

    def _send_json(self, payload) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path, content_type: str) -> None:
        if not path.is_file():
            self.send_error(404)
            return
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        return
