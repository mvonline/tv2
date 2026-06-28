import Clutter from "gi://Clutter";
import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

const TV_URL = "http://127.0.0.1:8080/";
const ADMIN_URL = "http://127.0.0.1:8080/admin";
const FEATURED_URL = "http://127.0.0.1:8080/";

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function launch(commandLine) {
  try {
    Gio.Subprocess.new(
      ["sh", "-lc", commandLine],
      Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
    );
  } catch (error) {
    Main.notifyError("TV2 Shell", String(error));
  }
}

function openUrl(url, fullscreen = false) {
  const browsers = [
    "google-chrome",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "firefox",
  ];
  const browser = browsers.find((name) => GLib.find_program_in_path(name));
  if (!browser) {
    launch(`xdg-open ${shellQuote(url)}`);
    return;
  }

  if (browser.includes("firefox")) {
    launch(`${browser} --new-window ${shellQuote(url)}`);
    return;
  }

  if (fullscreen) {
    launch(`${browser} --start-fullscreen ${shellQuote(url)}`);
    return;
  }

  launch(`${browser} --app=${shellQuote(url)}`);
}

const Tv2Indicator = GObject.registerClass(
  class Tv2Indicator extends PanelMenu.Button {
    _init() {
      super._init(0.0, "TV2 Shell");

      const box = new St.BoxLayout({
        style_class: "tv2-panel-button",
        reactive: true,
        can_focus: true,
        track_hover: true,
      });
      box.add_child(new St.Icon({
        icon_name: "video-display-symbolic",
        style_class: "system-status-icon",
      }));
      box.add_child(new St.Label({
        text: "TV2",
        y_align: Clutter.ActorAlign.CENTER,
      }));
      this.add_child(box);

      this.menu.addAction("Open TV2", () => openUrl(TV_URL));
      this.menu.addAction("Open TV2 Fullscreen", () => openUrl(TV_URL, true));
      this.menu.addAction("Open Admin", () => openUrl(ADMIN_URL));
      this.menu.addAction("Featured Rotator", () => openUrl(FEATURED_URL));
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      this.menu.addAction("Start TV2 Docker", () => {
        launch("cd ~/personal-project/tv2 && docker compose up -d");
      });
    }
  },
);

export default class Tv2ShellExtension extends Extension {
  enable() {
    this._indicator = new Tv2Indicator();
    Main.panel.addToStatusArea(this.uuid, this._indicator);
  }

  disable() {
    this._indicator?.destroy();
    this._indicator = null;
  }
}
