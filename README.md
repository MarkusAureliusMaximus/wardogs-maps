# WARDOGS Map Studio

Unofficial local map study tool. Not affiliated with BULKHEAD.

Run everything from this folder. Never point the app at a game install.

v1 design: `docs/superpowers/specs/2026-09-19-wardogs-map-studio-design.md`

## Commands

```bash
python -m pytest
python bake.py prepare
python server.py
```

## Phone / LAN

`server.py` binds `0.0.0.0:8765`, prints localhost and private LAN URLs, and an ASCII QR for the LAN URL. On the phone (same Wi‑Fi), open the printed `http://192.168.x.x:8765` (or scan the QR).

Allow Python through Windows Firewall on **Private** networks so phones can reach the host. If no private IPv4 is listed, check that firewall setting.

## Prepare

First-time `python bake.py prepare` downloads community tiles and Terrain3D chunks, verifies hashes, and bakes overlays. It may take several minutes and about **1–3 GB** of disk under `data/`.

## Data sources

v1 uses only published community tile pyramids and Terrain3D chunks (HTTPS), vendored map JSON under `maps/`, and files this project writes under `data/`. It never opens a Steam/Wardogs install, packs, or the game process.

A Bulkhead reply about Elytra / game-file reading does **not** change this app’s data sources for v1 — community tiles and terrain only.
