# Wayland Shortcuts

Yawp's Python daemon can register global hotkeys through `pynput`, but Wayland
compositors deliberately restrict app-level keyboard capture. If the built-in
hotkeys do not fire in your session, bind the installed `yawp` CLI in your
desktop environment instead.

## Commands

Use these as custom shortcut commands:

```bash
yawp toggle-paste
yawp toggle-notes
yawp cancel
```

`toggle-paste` records and types into the focused app. `toggle-notes` records
and saves into the Yawp library. `cancel` stops the current recording without
saving or pasting.

## GNOME

Open Settings -> Keyboard -> View and Customize Shortcuts -> Custom Shortcuts.

Recommended bindings:

| Name | Command | Shortcut |
|---|---|---|
| Yawp paste | `yawp toggle-paste` | `Ctrl+Alt+V` |
| Yawp note | `yawp toggle-notes` | `Ctrl+Alt+N` |
| Yawp cancel | `yawp cancel` | `Ctrl+Alt+Escape` |

GNOME may reserve some combinations. If a binding is rejected, choose a
function key or a Super-based chord that is not already used by the shell.

## KDE Plasma

Open System Settings -> Keyboard -> Shortcuts -> Add Command.

Create one command per Yawp action:

```text
yawp toggle-paste
yawp toggle-notes
yawp cancel
```

KDE shows conflicts before saving. Prefer one-shot toggle commands instead of
hold-to-talk bindings; compositor-level shortcuts do not expose key-release
events to Yawp.

## Sway

Add bindings to `~/.config/sway/config`:

```text
bindsym Ctrl+Mod1+v exec yawp toggle-paste
bindsym Ctrl+Mod1+n exec yawp toggle-notes
bindsym Ctrl+Mod1+Escape exec yawp cancel
```

Reload Sway after editing:

```bash
swaymsg reload
```

## Hyprland

Add bindings to `~/.config/hypr/hyprland.conf`:

```text
bind = CTRL ALT, V, exec, yawp toggle-paste
bind = CTRL ALT, N, exec, yawp toggle-notes
bind = CTRL ALT, ESCAPE, exec, yawp cancel
```

Reload Hyprland after editing:

```bash
hyprctl reload
```

## Paste Tools

Wayland paste reliability depends on the compositor and installed tooling.
Yawp prefers `wtype` and falls back to `dotool` where available. Run:

```bash
yawp doctor
```

and check the paste section before filing an issue.
