from wardogs_map.height import decode_raw, raw_at, rel_z, world_z


def test_raw_at_row_major_le():
    buf = bytes([
        0x01, 0x00, 0x02, 0x00,
        0x03, 0x00, 0x04, 0x00,
    ])
    assert raw_at(buf, side=2, x=0, y=0) == 1
    assert raw_at(buf, side=2, x=1, y=0) == 2
    assert raw_at(buf, side=2, x=0, y=1) == 3
    assert raw_at(buf, side=2, x=1, y=1) == 4


def test_decode_endpoints():
    entry = {"minLocalZ": -10.0, "maxLocalZ": 10.0}
    assert decode_raw(0, entry) == -10.0
    assert decode_raw(65535, entry) == 10.0


def test_world_and_rel_z():
    manifest = {"worldZOffsetMeters": 0.5, "worldZScaleMetersPerLocalUnit": 9}
    wz = world_z(manifest, local_z=-10.0)
    assert abs(wz - (0.5 + -10.0 * 9)) < 1e-9
    assert rel_z(wz, map_min_world_z=wz) == 0.0
    assert rel_z(wz + 12.0, map_min_world_z=wz) == 12.0


def test_higher_raw_means_higher_relz():
    entry = {"minLocalZ": -5.0, "maxLocalZ": 5.0}
    manifest = {"worldZOffsetMeters": 0.0, "worldZScaleMetersPerLocalUnit": 9}
    lo = world_z(manifest, decode_raw(0, entry))
    hi = world_z(manifest, decode_raw(65535, entry))
    assert hi > lo
