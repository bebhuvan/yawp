---
name: Bug report
about: Report a reproducible Yawp problem
title: ""
labels: bug
assignees: ""
---

## What happened?

## What did you expect?

## Steps to reproduce

1.
2.
3.

## Environment

- Linux distribution:
- Desktop/session: X11 or Wayland
- Install method: `.deb`, AppImage, or source
- Yawp version or commit:

## Diagnostics

Run:

```bash
./scripts/doctor
```

Paste the output here. The report does not include your OpenRouter API key.

## Logs

```bash
journalctl --user -u yawp-sidecar --since "20 minutes ago"
journalctl --user -u yawp-daemon --since "20 minutes ago"
```

