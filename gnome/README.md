# TV2 GNOME Integration

This folder adds a small GNOME Shell extension and desktop launcher for TV2.

## Install

```bash
./gnome/install-gnome-tv2.sh
gnome-extensions enable tv2@mvonline.local
```

Restart GNOME Shell after first install. On X11, press `Alt+F2`, type `r`, and press Enter. On Wayland, log out and back in.

## What It Adds

- A `TV2` item in the GNOME top bar.
- Menu actions for TV2, fullscreen TV2, admin, and the featured rotator.
- A desktop/app launcher named `TV2`.

The extension opens the Docker-proxied TV2 web app at `http://127.0.0.1:8080/`.
