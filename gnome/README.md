# TV2 GNOME Integration

This folder adds a GNOME Shell extension and desktop launcher for TV2.

The extension adds a `TV2` item to the GNOME top bar. From that menu you can open the TV2 web app, open admin, start the Docker stack, or launch a small always-on-top mini player for live channels.

## Requirements

- GNOME Shell 45 or newer.
- `mpv` for the mini player.
- TV2 checked out at `~/personal-project/tv2`.
- Channel data at `backend/data/channels.json`.

## Install

```bash
sudo apt install mpv
./gnome/install-gnome-tv2.sh
gnome-extensions enable tv2@mvonline.local
```

Restart GNOME Shell after the first install or after changing extension files:

- X11: press `Alt+F2`, type `r`, and press Enter.
- Wayland: log out and log back in.

## What It Adds

- A `TV2` item in the GNOME top bar.
- Menu actions for TV2, fullscreen TV2, admin, and the featured rotator.
- A `Mini Player` submenu with play, previous channel, next channel, stop, and quick channel actions.
- A desktop/app launcher named `TV2`.

## Mini Player

The mini player opens the current channel in an `mpv` window using:

- Always on top.
- Fixed small geometry: `480x270`.
- Bottom-right screen placement.

The channel list is loaded from `backend/data/channels.json`. Radio entries are skipped. The menu includes quick actions for the first 12 TV channels, and the previous/next controls can move through the full list.

If `mpv` is missing, the extension shows a GNOME notification and the mini player will not start.

## URLs

- TV2 web app: `http://127.0.0.1:8080/`
- Admin: `http://127.0.0.1:8080/admin`
- Featured rotator: `http://127.0.0.1:8080/`

## Reinstall After Changes

Run the installer again whenever files in `gnome/tv2-shell-extension/` change:

```bash
./gnome/install-gnome-tv2.sh
```

Then restart GNOME Shell or log out and back in.
