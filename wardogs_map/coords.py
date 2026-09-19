from dataclasses import dataclass


@dataclass(frozen=True)
class ChunkLocation:
    chunk_x: int
    chunk_y: int
    local_x: float
    local_y: float

    @property
    def key(self) -> str:
        return f"{self.chunk_x},{self.chunk_y}"


def _axis_scale(manifest: dict, axis: str) -> float:
    specific = manifest.get(f"gameUnitsToLandscapeQuads{axis}")
    if specific is not None and float(specific) != 0:
        return float(specific)
    return float(manifest["gameUnitsToLandscapeQuads"])


def within_coverage(manifest: dict, game_x: float, game_y: float) -> bool:
    cov = manifest.get("coverage")
    if not cov:
        return True
    eps = 1e-7
    return (
        float(cov["gameXMin"]) - eps <= game_x <= float(cov["gameXMax"]) + eps
        and float(cov["gameYMin"]) - eps <= game_y <= float(cov["gameYMax"]) + eps
    )


def locate_point(manifest: dict, game_x: float, game_y: float) -> ChunkLocation | None:
    if not within_coverage(manifest, game_x, game_y):
        return None
    chunk_quads = float(manifest["chunkQuads"])
    quad_x = float(manifest["globalQuadOffsetX"]) + game_x * _axis_scale(manifest, "X")
    quad_y = float(manifest["globalQuadOffsetY"]) + game_y * _axis_scale(manifest, "Y")
    chunk_x = int(quad_x // chunk_quads)
    chunk_y = int(quad_y // chunk_quads)
    if not (
        int(manifest["chunkXMin"]) <= chunk_x <= int(manifest["chunkXMax"])
        and int(manifest["chunkYMin"]) <= chunk_y <= int(manifest["chunkYMax"])
    ):
        return None
    local_x = quad_x - chunk_x * chunk_quads
    local_y = quad_y - chunk_y * chunk_quads
    return ChunkLocation(chunk_x, chunk_y, local_x, local_y)
