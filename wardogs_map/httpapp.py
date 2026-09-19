from __future__ import annotations

import json
import posixpath
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from wardogs_map import paths
from wardogs_map.cz import randomize_cz
from wardogs_map.mapspec import list_map_ids, load_map
from wardogs_map.paths import MAPS_DIR, WEB_DIR

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
    return StudioContext(
        stores={},
        status={"maps": {map_id: {"ready": False} for map_id in list_map_ids()}},
    )


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
            self._send_overlay(path)
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
                "inCoverage": sample.in_coverage,
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

    def _send_overlay(self, path: str) -> None:
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
