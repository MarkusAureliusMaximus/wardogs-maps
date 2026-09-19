def lan_urls(port: int) -> list[str]:
    return [f"http://127.0.0.1:{port}"]


def print_qr(url: str) -> None:
    print("(qr later)")
