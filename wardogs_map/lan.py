import ipaddress
import socket

import qrcode


def private_ipv4s() -> list[str]:
    found: list[str] = []
    hostname = socket.gethostname()
    for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
        ip = info[4][0]
        addr = ipaddress.ip_address(ip)
        if addr.is_private and not addr.is_loopback:
            found.append(ip)
    return list(dict.fromkeys(found))


def lan_urls(port: int) -> list[str]:
    urls = [f"http://127.0.0.1:{port}"]
    for ip in private_ipv4s():
        urls.append(f"http://{ip}:{port}")
    return urls


def print_qr(url: str) -> None:
    qr = qrcode.QRCode()
    qr.add_data(url)
    qr.make(fit=True)
    qr.print_ascii()
