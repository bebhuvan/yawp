---
name: Bug report
about: Something doesn't work as expected
labels: bug
---

## What happened

<!-- One or two sentences. -->

## What you expected

<!-- One sentence. -->

## Steps to reproduce

1.
2.
3.

## Environment

- Distro + kernel: `uname -a` →
- Session type: `echo $XDG_SESSION_TYPE` →
- Yawp commit: `git -C ~/path/to/yawp log -1 --oneline` →
- Python: `python3 --version` →
- Node: `node --version` →

## Logs

<!-- Last 20–30 lines from whichever is relevant. -->

```
journalctl --user -u yawp-sidecar -n 40
journalctl --user -u yawp-daemon  -n 40
```
