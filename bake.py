import sys
from wardogs_map.download import prepare_all
from wardogs_map.mapspec import list_map_ids


def main():
    if len(sys.argv) < 2 or sys.argv[1] != "prepare":
        raise SystemExit("usage: python bake.py prepare")
    ok = prepare_all(list_map_ids())
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
