#!/usr/bin/env python3
"""Prepare local, redacted rehearsal cuts from the accepted MVP browser capture.

The source WebM is never modified. This script uses only the local Playwright
FFmpeg binary and bundled Pillow, and writes review artifacts under the evidence
directory. The cuts keep the original 1280x900 frame intact and letterbox it to
16:9 and 9:16, so no financial values are stretched or recomputed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "docs" / "evidence"
DEFAULT_FFMPEG = Path(r"C:\Users\RajeshShinde\AppData\Local\ms-playwright\ffmpeg-1011\ffmpeg-win64.exe")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=True, capture_output=True, text=True)


def media_info(ffmpeg: Path, source: Path) -> tuple[float, float, int, int]:
    result = subprocess.run([str(ffmpeg), "-hide_banner", "-i", str(source)], capture_output=True, text=True)
    text = result.stderr + result.stdout
    duration_match = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", text)
    video_match = re.search(r"Video:.*?(\d{3,5})x(\d{3,5}).*?(\d+(?:\.\d+)?) fps", text, re.S)
    if not duration_match or not video_match:
        raise RuntimeError("could not read the local WebM duration and video stream")
    duration = int(duration_match.group(1)) * 3600 + int(duration_match.group(2)) * 60 + float(duration_match.group(3))
    width, height, fps = int(video_match.group(1)), int(video_match.group(2)), float(video_match.group(3))
    return duration, fps, width, height


def redact_frame(image: Image.Image, timestamp: float) -> list[dict[str, int]]:
    """Opaque masks cover only known auth screens, leaving result/detail frames intact."""
    width, height = image.size
    regions: list[tuple[float, tuple[int, int, int, int]]] = [
        (1.4, (120, 100, min(width - 120, 1160), min(height - 160, 660))),
    ] if timestamp <= 1.4 else []
    if 3.15 <= timestamp <= 5.3:
        regions.append((8.5, (120, 80, min(width - 120, 1160), min(height - 120, 700))))
    if 14.0 <= timestamp <= 16.8:
        regions.append((16.8, (140, 80, min(width - 140, 1140), min(height - 180, 520))))
    applied: list[dict[str, int]] = []
    if regions:
        draw = ImageDraw.Draw(image)
        for _, (left, top, right, bottom) in regions:
            draw.rectangle((left, top, right, bottom), fill=(31, 38, 41))
            draw.text((left + 18, top + 18), "REDACTED AUTH SCREEN", fill=(230, 235, 232))
            applied.append({"left": left, "top": top, "right": right, "bottom": bottom})
    return applied


def encode(ffmpeg: Path, frames: Path, fps: float, output: Path, pad: str | None = None) -> None:
    vf = ["-vf", pad] if pad else []
    process = subprocess.Popen([
        str(ffmpeg), "-y", "-f", "image2pipe", "-framerate", f"{fps:.6f}", "-vcodec", "mjpeg", "-i", "pipe:0",
        *vf, "-c:v", "libvpx", "-b:v", "900k", "-pix_fmt", "yuv420p", "-an", str(output),
    ], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdin is not None
    try:
        for frame in sorted(frames.glob("frame-*.jpg")):
            try:
                process.stdin.write(frame.read_bytes())
            except BrokenPipeError:
                break
        process.stdin.close()
    finally:
        process.stdin = None
    _, stderr = process.communicate()
    if process.returncode:
        raise RuntimeError(f"FFmpeg encoding failed: {stderr.decode(errors='replace')[-1200:]}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path)
    parser.add_argument("--ffmpeg", type=Path, default=DEFAULT_FFMPEG)
    args = parser.parse_args()
    ffmpeg = args.ffmpeg.resolve()
    if not ffmpeg.is_file():
        raise SystemExit(f"local FFmpeg not found: {ffmpeg}")
    evidence_file = EVIDENCE / "clerk-browser-mvp-demo.json"
    evidence = json.loads(evidence_file.read_text(encoding="utf-8"))
    source = (args.source or Path(evidence["rawVideo"]["path"])).resolve()
    if not source.is_file():
        raise SystemExit(f"raw capture not found: {source}")
    if not evidence.get("rawVideo", {}).get("raw") or evidence.get("rawVideo", {}).get("shareable") is not False:
        raise SystemExit("refusing to prepare a capture without explicit raw/non-shareable evidence")

    duration, fps, width, height = media_info(ffmpeg, source)
    output_dir = EVIDENCE / "demo-edits"
    output_dir.mkdir(parents=True, exist_ok=True)
    metadata_path = output_dir / "demo-capture-redaction.json"
    with tempfile.TemporaryDirectory(prefix="truecost-demo-frames-") as temp:
        frames = Path(temp)
        run([str(ffmpeg), "-y", "-i", str(source), "-vsync", "0", str(frames / "raw-%06d.png")])
        raw_paths = sorted(frames.glob("raw-*.png"))
        frame_paths: list[Path] = []
        applied: dict[str, list[dict[str, int]]] = {}
        for index, raw_path in enumerate(raw_paths):
            frame_path = frames / f"frame-{index + 1:06d}.jpg"
            with Image.open(raw_path) as image:
                frame = image.convert("RGB")
                masks = redact_frame(frame, index / fps)
                if masks:
                    applied[str(round(index / fps, 3))] = masks
                frame.save(frame_path, format="JPEG", quality=94, optimize=True)
            raw_path.unlink()
            frame_paths.append(frame_path)
        base = output_dir / "demo-capture-rehearsal-redacted-base.webm"
        encode(ffmpeg, frames, fps, base)
        landscape = output_dir / "demo-capture-rehearsal-redacted-16x9.webm"
        portrait = output_dir / "demo-capture-rehearsal-redacted-9x16.webm"
        encode(ffmpeg, frames, fps, landscape, "pad=1600:900:160:0:color=0x111719")
        encode(ffmpeg, frames, fps, portrait, "pad=1280:2276:0:688:color=0x111719")

    metadata = {
        "kind": "local-redacted-rehearsal",
        "source": str(source),
        "sourceSha256": sha256(source),
        "durationSeconds": duration,
        "fps": fps,
        "sourceResolution": [width, height],
        "frameCount": len(frame_paths),
        "redaction": {
            "method": "opaque local masks over auth screens only",
    "intervalsSeconds": [[0, 1.4], [3.15, 5.3], [14.0, 16.8]],
            "purpose": "hide synthetic email and OTP; result/detail frames are unchanged",
        },
        "outputs": [
            {"path": str(base), "sha256": sha256(base), "label": "base rehearsal"},
            {"path": str(landscape), "sha256": sha256(landscape), "label": "16:9 letterboxed rehearsal"},
            {"path": str(portrait), "sha256": sha256(portrait), "label": "9:16 letterboxed rehearsal"},
        ],
        "review": {
            "raw": False,
            "shareable": "review-required",
            "note": "Local rehearsal cuts. Inspect all frames before sharing; no finance values were changed.",
            "maskedFrameCount": len(applied),
        },
    }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
