import struct


def raw_at(buf: bytes, side: int, x: int, y: int) -> int:
    index = y * side + x
    return struct.unpack_from("<H", buf, index * 2)[0]


def decode_raw(raw: int, entry: dict) -> float:
    lo = float(entry["minLocalZ"])
    hi = float(entry["maxLocalZ"])
    return lo + (raw / 65535.0) * (hi - lo)


def world_z(manifest: dict, local_z: float) -> float:
    return float(manifest["worldZOffsetMeters"]) + local_z * float(
        manifest["worldZScaleMetersPerLocalUnit"]
    )


def rel_z(world: float, map_min_world_z: float) -> float:
    return world - map_min_world_z
