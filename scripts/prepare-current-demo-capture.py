#!/usr/bin/env python3
"""Create local redacted rehearsal cuts for the current MVP browser capture."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "docs" / "evidence"
DEFAULT_FFMPEG = Path(r"C:\Program Files\Selects\resources\overlay-renderer\node_modules\@remotion\compositor-win32-x64-msvc\ffmpeg.exe")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def media_info(ffmpeg: Path, source: Path) -> tuple[float, float, int, int]:
    result = subprocess.run([str(ffmpeg), "-hide_banner", "-i", str(source)], capture_output=True, text=True)
    text = result.stderr + result.stdout
    duration_match = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", text)
    video_match = re.search(r"Video:.*?(\d{3,5})x(\d{3,5}).*?(\d+(?:\.\d+)?) fps", text, re.S)
    if not duration_match or not video_match:
        raise RuntimeError("could not read local WebM metadata")
    duration = int(duration_match.group(1)) * 3600 + int(duration_match.group(2)) * 60 + float(duration_match.group(3))
    return duration, float(video_match.group(3)), int(video_match.group(1)), int(video_match.group(2))


def encode(ffmpeg: Path, frames: Path, fps: float, output: Path, pad: str | None = None) -> None:
    command = [str(ffmpeg), "-y", "-loglevel", "error", "-framerate", f"{fps:.6f}", "-start_number", "1", "-i", str(frames / "frame-%06d.jpg")]
    if pad:
        command += ["-vf", pad]
    command += ["-c:v", "libvpx", "-b:v", "1200k", "-crf", "31", "-pix_fmt", "yuv420p", "-an", str(output)]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"FFmpeg encode failed: {result.stderr[-1200:]}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path)
    parser.add_argument("--ffmpeg", type=Path, default=DEFAULT_FFMPEG)
    parser.add_argument("--label", default="ydMz", help="short output label for the current capture")
    args = parser.parse_args()
    ffmpeg = args.ffmpeg.resolve()
    label = re.sub(r"[^A-Za-z0-9._-]", "-", args.label).strip("-") or "capture"
    evidence_file = EVIDENCE / "clerk-browser-mvp-demo.json"
    evidence = json.loads(evidence_file.read_text(encoding="utf-8"))
    source = (args.source or Path(evidence["rawVideo"]["path"])).resolve()
    if not ffmpeg.is_file() or not source.is_file():
        raise SystemExit("current capture or local FFmpeg binary is missing")
    if evidence.get("rawVideo", {}).get("shareable") is not False:
        raise SystemExit("refusing to process a capture without non-shareable raw evidence")

    duration, fps, width, height = media_info(ffmpeg, source)
    output_dir = EVIDENCE / "demo-edits"
    output_dir.mkdir(parents=True, exist_ok=True)
    base = output_dir / f"demo-capture-current-{label}-redacted-base.webm"
    masked = 0
    with tempfile.TemporaryDirectory(prefix="truecost-current-demo-") as temp:
        frame_dir = Path(temp)
        raw_pattern = str(frame_dir / "raw-%06d.png")
        result = subprocess.run([str(ffmpeg), "-y", "-loglevel", "error", "-i", str(source), "-vsync", "0", raw_pattern], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(f"frame extraction failed: {result.stderr[-1200:]}")
        raw_frames = sorted(frame_dir.glob("raw-*.png"))
        for index, raw_frame in enumerate(raw_frames):
            with Image.open(raw_frame) as image:
                frame = image.convert("RGB")
            timestamp = index / fps
            if 26.0 <= timestamp <= 44.0:
                draw = ImageDraw.Draw(frame)
                draw.rectangle((80, 50, width - 80, height - 50), fill=(31, 38, 41))
                draw.text((110, 80), "REDACTED AUTH SCREEN", fill=(230, 235, 232))
                masked += 1
            frame.save(frame_dir / f"frame-{index + 1:06d}.jpg", format="JPEG", quality=92, optimize=True)
            raw_frame.unlink()
        encode(ffmpeg, frame_dir, fps, base)
    metadata = {
        "kind": "local-redacted-rehearsal",
        "buildId": evidence.get("buildId"),
        "source": str(source),
        "sourceSha256": sha256(source),
        "durationSeconds": duration,
        "fps": fps,
        "sourceResolution": [width, height],
        "redaction": {"intervalsSeconds": [[26.0, 44.0]], "maskedFrameCount": masked, "method": "opaque local mask over auth transition"},
        "outputs": [{"path": str(base), "sha256": sha256(base), "label": "base 1280x900 rehearsal"}],
        "review": {"raw": False, "shareable": "review-required", "fullPlayback": "open"},
    }
    metadata_path = output_dir / f"demo-capture-current-{label}-redaction.json"
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
