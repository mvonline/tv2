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
const PROJECT_DIR = GLib.build_filenamev([GLib.get_home_dir(), "personal-project", "tv2"]);
const CHANNELS_FILE = GLib.build_filenamev([PROJECT_DIR, "backend", "data", "channels.json"]);
const MINI_PLAYER_GEOMETRY = "480x270-24-64";

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

function launchProcess(args) {
  return Gio.Subprocess.new(
    args,
    Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
  );
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

function loadChannels() {
  try {
    const file = Gio.File.new_for_path(CHANNELS_FILE);
    const [ok, contents] = file.load_contents(null);
    if (!ok) {
      return [];
    }

    const data = JSON.parse(new TextDecoder().decode(contents));
    return (data.channels ?? [])
      .filter((channel) => channel.media_type !== "radio" && channel.stream_url)
      .map((channel) => ({
        name: channel.name,
        url: channel.stream_url,
      }));
  } catch (error) {
    Main.notifyError("TV2 Mini Player", String(error));
    return [];
  }
}

const Tv2Indicator = GObject.registerClass(
  class Tv2Indicator extends PanelMenu.Button {
    _init() {
      super._init(0.0, "TV2 Shell");
      this._channels = loadChannels();
      this._channelIndex = 0;
      this._playerProcess = null;

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
      this._buildMiniPlayerMenu();
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      this.menu.addAction("Start TV2 Docker", () => {
        launch(`cd ${shellQuote(PROJECT_DIR)} && docker compose up -d`);
      });
    }

    _buildMiniPlayerMenu() {
      const miniMenu = new PopupMenu.PopupSubMenuMenuItem("Mini Player");
      this._channelLabel = new PopupMenu.PopupMenuItem(this._currentChannelLabel(), {
        reactive: false,
        can_focus: false,
      });

      miniMenu.menu.addMenuItem(this._channelLabel);
      miniMenu.menu.addAction("Play / Bring to Front", () => this._playCurrentChannel());
      miniMenu.menu.addAction("Previous Channel", () => this._stepChannel(-1));
      miniMenu.menu.addAction("Next Channel", () => this._stepChannel(1));
      miniMenu.menu.addAction("Stop Player", () => this._stopPlayer());
      miniMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._channels.slice(0, 12).forEach((channel, index) => {
        miniMenu.menu.addAction(channel.name, () => {
          this._channelIndex = index;
          this._playCurrentChannel();
        });
      });

      this.menu.addMenuItem(miniMenu);
    }

    _currentChannelLabel() {
      if (!this._channels.length) {
        return "No local channels found";
      }

      return `${this._channelIndex + 1}/${this._channels.length}: ${this._channels[this._channelIndex].name}`;
    }

    _refreshChannelLabel() {
      this._channelLabel?.label.set_text(this._currentChannelLabel());
    }

    _stepChannel(delta) {
      if (!this._channels.length) {
        Main.notifyError("TV2 Mini Player", `No channels found in ${CHANNELS_FILE}`);
        return;
      }

      this._channelIndex = (this._channelIndex + delta + this._channels.length) % this._channels.length;
      this._playCurrentChannel();
    }

    _stopPlayer() {
      if (this._playerProcess) {
        this._playerProcess.force_exit();
        this._playerProcess = null;
      }
    }

    _playCurrentChannel() {
      if (!this._channels.length) {
        Main.notifyError("TV2 Mini Player", `No channels found in ${CHANNELS_FILE}`);
        return;
      }

      if (!GLib.find_program_in_path("mpv")) {
        Main.notifyError("TV2 Mini Player", "Install mpv to use the always-on-top mini player.");
        return;
      }

      const channel = this._channels[this._channelIndex];
      this._stopPlayer();
      this._refreshChannelLabel();

      try {
        this._playerProcess = launchProcess([
          "mpv",
          "--ontop",
          "--force-window=yes",
          `--geometry=${MINI_PLAYER_GEOMETRY}`,
          "--no-terminal",
          "--title=TV2 Mini Player",
          channel.url,
        ]);
      } catch (error) {
        Main.notifyError("TV2 Mini Player", String(error));
      }
    }

    destroy() {
      this._stopPlayer();
      super.destroy();
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
