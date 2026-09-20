# WARDOGS Maps (v1)

Unofficial local terrain study map for **WARDOGS**: color overhead tiles, hillshade, 20 m contours, faction markers, and a draggable 2×2 km Control Zone. Open it on this PC and on a phone on the same Wi‑Fi.

**Not affiliated with, endorsed by, or associated with BULKHEAD or Team17.** WARDOGS names and imagery belong to their owners. This repo’s **code** is MIT. Community map tiles and Terrain3D height data are **not** in git — `prepare` downloads them at runtime.

## Version 1

Tag: `v1.0.0`

- Bakurani, Ozeti, Zestafona
- Layers: color/gray tiles, hillshade (default on), color-by-height, contours, markers, Control Zone
- Click/tap for game `X Y` and **relative** height (not ASL)
- LAN server + QR for a phone companion
- Does **not** read the Steam install, packed game files, or the live client (Elytra stays out of the path)

## Setup

Python 3.11+ (3.14 works). From this folder:

```bash
python -m pip install -r requirements.txt
python -m pytest
python bake.py prepare
python server.py
```

`prepare` downloads community tiles and height chunks (16 parallel workers), verifies hashes, and bakes overlays. Budget **~10 GB** under `data/` (gitignored) and a while on first run. Re-runs skip files already on disk.

Then open **http://127.0.0.1:8765**. The terminal also prints a LAN URL and QR for your phone. Allow Python on **Private** networks in Windows Firewall if the phone cannot connect.

## Data sources

HTTPS community tile pyramids and Terrain3D chunks, plus vendored `maps/*.json`. Never a game install, pack, or process.

## Next (not in v1)

3D relief table, measure/profile tools, contour labels, phone-friendly Control Zone drag.

## Design

`docs/superpowers/specs/2026-09-19-wardogs-map-studio-design.md`
