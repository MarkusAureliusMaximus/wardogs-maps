from wardogs_map.profile import elevation_profile
from wardogs_map.terrain import Sample


class _SlopeStore:
    def sample(self, x, y):
        return Sample(True, True, x * 10.0, x * 10.0)


def test_profile_length_and_slope():
    data = elevation_profile(_SlopeStore(), 1.0, 0.0, 3.0, 0.0, n=5)
    assert data["ok"] is True
    assert abs(data["lengthM"] - 200.0) < 0.1
    assert data["points"][0]["relZ"] == 10.0
    assert data["points"][-1]["relZ"] == 30.0
    assert data["delta"] == 20.0
    assert data["min"] == 10.0
    assert data["max"] == 30.0
    assert len(data["points"]) == 5
