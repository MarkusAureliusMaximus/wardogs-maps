from dataclasses import dataclass
from wardogs_map.coords import locate_point
from wardogs_map.height import decode_raw, raw_at, rel_z, world_z


@dataclass(frozen=True)
class Sample:
    ok: bool
    in_coverage: bool
    rel_z: float | None
    world_z: float | None


class TerrainStore:
    def __init__(self, manifest: dict, chunks: dict[str, bytes], map_min_world_z: float | None):
        self.manifest = manifest
        self.chunks = chunks
        if map_min_world_z is None:
            self.map_min_world_z = self._compute_min_world()
        else:
            self.map_min_world_z = map_min_world_z

    def _compute_min_world(self) -> float:
        values = []
        for key, buf in self.chunks.items():
            entry = self.manifest["chunks"][key]
            values.append(world_z(self.manifest, float(entry["minLocalZ"])))
            values.append(world_z(self.manifest, float(entry["maxLocalZ"])))
        return min(values) if values else 0.0

    def sample(self, game_x: float, game_y: float) -> Sample:
        loc = locate_point(self.manifest, game_x, game_y)
        if loc is None:
            return Sample(False, False, None, None)
        buf = self.chunks.get(loc.key)
        if buf is None:
            return Sample(False, True, None, None)
        entry = self.manifest["chunks"][loc.key]
        side = int(self.manifest["verticesPerSide"])
        max_v = side - 1
        x0 = min(max(int(loc.local_x), 0), max_v)
        y0 = min(max(int(loc.local_y), 0), max_v)
        x1 = min(x0 + 1, max_v)
        y1 = min(y0 + 1, max_v)
        fx = loc.local_x - x0
        fy = loc.local_y - y0

        def z_at(x, y):
            raw = raw_at(buf, side, x, y)
            return world_z(self.manifest, decode_raw(raw, entry))

        z00, z10, z01, z11 = z_at(x0, y0), z_at(x1, y0), z_at(x0, y1), z_at(x1, y1)
        top = z00 + (z10 - z00) * fx
        bottom = z01 + (z11 - z01) * fx
        wz = top + (bottom - top) * fy
        return Sample(True, True, rel_z(wz, self.map_min_world_z), wz)
