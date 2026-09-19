import argparse
from http.server import ThreadingHTTPServer
from wardogs_map.httpapp import StudioHandler, make_context
from wardogs_map.lan import lan_urls, print_qr


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--host", default="0.0.0.0")
    args = p.parse_args()
    StudioHandler.context = make_context()
    httpd = ThreadingHTTPServer((args.host, args.port), StudioHandler)
    urls = lan_urls(args.port)
    print("WARDOGS Map Studio")
    for u in urls:
        print(u)
    if urls:
        print_qr(urls[-1] if len(urls) > 1 else urls[0])
    else:
        print("No private IPv4 found. Allow Python on Private networks in Windows Firewall.")
    try:
        httpd.serve_forever()
    except OSError as exc:
        raise SystemExit(f"bind failed: {exc}") from exc


if __name__ == "__main__":
    main()
