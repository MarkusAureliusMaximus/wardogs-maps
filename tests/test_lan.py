from wardogs_map.lan import lan_urls, private_ipv4s


def test_localhost_always_present():
    urls = lan_urls(8765)
    assert "http://127.0.0.1:8765" in urls


def test_private_ipv4_filter():
    ips = private_ipv4s()
    for ip in ips:
        a, b, *_ = (int(p) for p in ip.split("."))
        assert (
            a == 10
            or (a == 192 and b == 168)
            or (a == 172 and 16 <= b <= 31)
        )
