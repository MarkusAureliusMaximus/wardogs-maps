from __future__ import annotations

import json
import posixpath
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from wardogs_map.mapspec import list_map_ids
from wardogs_map.paths import MAPS_DIR, WEB_DIR


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
        if path == "/":
            self._send_file(WEB_DIR / "index.html", "text/html; charset=utf-8")
            return
        if path.startswith("/maps/"):
            self._send_maps(path)
            return
        self.send_error(404)

    def do_POST(self):
        self.send_error(405)

    do_PUT = do_DELETE = do_PATCH = do_HEAD = do_OPTIONS = do_POST

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
        root = MAPS_DIR.resolve()
        target = (MAPS_DIR / candidate).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            self.send_error(404)
            return
        self._send_file(target, "application/json")

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
