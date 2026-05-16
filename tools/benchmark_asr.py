#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import sys
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SIDECAR = ROOT / "sidecar"
sys.path.insert(0, str(SIDECAR))

import sounddevice as sd  # noqa: E402
import soundfile as sf  # noqa: E402

from app.backends.whisper import FasterWhisperBackend  # noqa: E402


SAMPLE_RATE = 16_000


@dataclass
class BenchmarkRow:
    model: str
    device: str
    compute_type: str
    audio_sec: float
    wall_sec: float
    rtf: float
    chars: int
    text_preview: str


def main() -> int:
    args = parse_args()
    audio_path: Path
    cleanup_path: Path | None = None

    if args.audio:
        audio_path = Path(args.audio).expanduser().resolve()
        if not audio_path.exists():
            print(f"audio file not found: {audio_path}", file=sys.stderr)
            return 2
    else:
        cleanup_path = record_sample(args.record_seconds)
        audio_path = cleanup_path

    rows: list[BenchmarkRow] = []
    for model in args.models.split(","):
        model = model.strip()
        if not model:
            continue
        backend = FasterWhisperBackend(
            model_name=model,
            device=args.device,
            compute_type=args.compute_type,
        )
        print(
            f"Loading {model} ({args.device}/{args.compute_type})...",
            file=sys.stderr,
        )
        backend.preload()

        for run in range(args.runs):
            print(f"Run {run + 1}/{args.runs}: {model}", file=sys.stderr)
            t0 = time.perf_counter()
            result = backend.transcribe(str(audio_path), language=args.language)
            wall = time.perf_counter() - t0
            rtf = result.duration / wall if wall > 0 else 0.0
            rows.append(
                BenchmarkRow(
                    model=model,
                    device=args.device,
                    compute_type=args.compute_type,
                    audio_sec=result.duration,
                    wall_sec=wall,
                    rtf=rtf,
                    chars=len(result.text),
                    text_preview=result.text[:80].replace("\n", " "),
                )
            )

    print_table(rows)
    if args.csv:
        write_csv(Path(args.csv).expanduser(), rows)
    if cleanup_path:
        cleanup_path.unlink(missing_ok=True)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Benchmark Yawp's current faster-whisper ASR path.",
    )
    parser.add_argument(
        "--audio",
        help="Audio file to benchmark. If omitted, records from the default mic.",
    )
    parser.add_argument(
        "--record-seconds",
        type=float,
        default=8.0,
        help="Seconds to record when --audio is omitted.",
    )
    parser.add_argument(
        "--models",
        default="base.en,small.en",
        help="Comma-separated faster-whisper model IDs.",
    )
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--language", default="en")
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--csv", help="Optional path to write CSV results.")
    return parser.parse_args()


def record_sample(seconds: float) -> Path:
    seconds = max(1.0, seconds)
    print(f"Recording {seconds:.1f}s sample from default microphone...", file=sys.stderr)
    frames = sd.rec(
        int(seconds * SAMPLE_RATE),
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype="float32",
    )
    sd.wait()
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    path = Path(tmp.name)
    sf.write(path, frames, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    print(f"Recorded sample: {path}", file=sys.stderr)
    return path


def print_table(rows: list[BenchmarkRow]) -> None:
    if not rows:
        return
    print(
        "model\tdevice\tcompute\taudio_s\twall_s\trtf\tchars\tpreview",
    )
    for row in rows:
        print(
            f"{row.model}\t{row.device}\t{row.compute_type}\t"
            f"{row.audio_sec:.2f}\t{row.wall_sec:.2f}\t{row.rtf:.2f}\t"
            f"{row.chars}\t{row.text_preview}",
        )


def write_csv(path: Path, rows: list[BenchmarkRow]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(asdict(rows[0]).keys()))
        writer.writeheader()
        for row in rows:
            writer.writerow(asdict(row))
    print(f"Wrote {path}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
