"""Assemble a current-build local demo candidate from a reviewed redacted capture.

The source capture is real product footage. Authentication and verification are
held away from the visible timeline, while the narration and captions explain
that omission. The script defaults to the current reviewed rehearsal and writes
new files so the historical candidate remains untouched.
"""

from __future__ import annotations

import argparse
import io
import os
import re
import subprocess
import sys
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[3]
FFMPEG = Path(r"C:\Program Files\Selects\resources\app.asar.unpacked\dist\bin\ffmpeg.exe")
DEFAULT_SOURCE = ROOT / "docs/evidence/demo-edits/demo-capture-current-1iwP4oc_H3NlGLD2I7W_j-redacted-base.webm"
DEFAULT_WAV = ROOT / "docs/evidence/demo-edits/truecost-narration-hosted-development-en-gb-george.wav"
DEFAULT_SRT = ROOT / "docs/evidence/demo-edits/truecost-narration-hosted-development.srt"
TOTAL_SECONDS = 180.683

# Output time is kept chronological, but the authentication screens are held
# out of the visible edit. Each source time is within the redacted capture.
EDL = (
    (0.000, 6.000, "hold", 0.000, 0.000, "opening / landing"),
    (6.000, 23.000, "motion", 2.611, 10.873, "comparison inputs and guest result"),
    (23.000, 60.000, "hold", 10.873, 10.873, "authentication step omitted for privacy"),
    (60.000, 77.000, "motion", 44.200, 49.340, "saved result and history"),
    (77.000, 95.000, "motion", 49.340, 67.283, "history and report"),
    (95.000, 150.000, "hold", 67.283, 67.283, "report ready"),
    (150.000, TOTAL_SECONDS, "motion", 67.283, 78.935, "sign-out and closing state"),
)


def parse_srt(path: Path):
    cues = []
    for block in re.split(r"\n\s*\n", path.read_text(encoding="utf-8").strip()):
        lines = block.splitlines()
        if len(lines) < 3:
            continue
        match = re.match(
            r"(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)",
            lines[1],
        )
        if not match:
            continue
        values = list(map(int, match.groups()))
        start = values[0] * 3600 + values[1] * 60 + values[2] + values[3] / 1000
        end = values[4] * 3600 + values[5] * 60 + values[6] + values[7] / 1000
        cues.append((start, end, " ".join(lines[2:])))
    return cues


def source_time(output_time: float) -> float:
    for start, end, kind, source_start, source_end, _label in EDL:
        if start <= output_time < end or (output_time == TOTAL_SECONDS and end == TOTAL_SECONDS):
            if kind == "hold":
                return source_start
            fraction = (output_time - start) / max(end - start, 0.001)
            return source_start + fraction * (source_end - source_start)
    return EDL[-1][4]


def build_master(source: Path, label: str) -> Path:
    master = Path(os.environ.get("TEMP", ".")) / f"truecost-current-{label}-master.mp4"
    filters = []
    labels = []
    for index, (start, end, kind, source_start, source_end, _label) in enumerate(EDL):
        out_label = f"s{index}"
        labels.append(f"[{out_label}]")
        duration = end - start
        if kind == "hold":
            filters.append(
                f"[0:v]trim=start={source_start}:end={source_start + 0.04},setpts=PTS-STARTPTS," 
                f"tpad=stop_mode=clone:stop_duration={max(duration - 0.04, 0):.3f},trim=duration={duration:.3f},setpts=PTS-STARTPTS[{out_label}]"
            )
        else:
            speed = duration / max(source_end - source_start, 0.001)
            filters.append(
                f"[0:v]trim=start={source_start}:end={source_end},setpts=PTS-STARTPTS,setpts=PTS*{speed:.8f}," 
                f"trim=duration={duration:.3f},setpts=PTS-STARTPTS[{out_label}]"
            )
    filters.append("".join(labels) + f"concat=n={len(EDL)}:v=1:a=0,format=yuv420p,setsar=1,fps=25,trim=duration={TOTAL_SECONDS:.3f},setpts=PTS-STARTPTS[outv]")
    command = [
        str(FFMPEG), "-y", "-loglevel", "error", "-i", str(source), "-filter_complex", ";".join(filters),
        "-map", "[outv]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-t", str(TOTAL_SECONDS), str(master),
    ]
    subprocess.run(command, check=True)
    return master


def render(master: Path, wav: Path, srt: Path, out_dir: Path, label: str, width: int, height: int):
    band = 170 if width > 1000 else 300
    font_path = Path(r"C:\Windows\Fonts\segoeui.ttf")
    font = ImageFont.truetype(str(font_path), 30 if width > 1000 else 24)
    source_proc = subprocess.Popen(
        [str(FFMPEG), "-loglevel", "error", "-i", str(master), "-vf", "fps=25", "-f", "image2pipe", "-vcodec", "png", "-"],
        stdout=subprocess.PIPE,
    )
    name = f"truecost-current-{label}-{'16x9' if width > 1000 else '9x16'}.mp4"
    out_path = out_dir / name
    encoder = subprocess.Popen(
        [
            str(FFMPEG), "-y", "-loglevel", "error", "-f", "image2pipe", "-vcodec", "png", "-framerate", "25", "-i", "-",
            "-i", str(wav), "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-b:a", "160k", "-t", str(TOTAL_SECONDS), "-shortest", str(out_path),
        ],
        stdin=subprocess.PIPE,
    )
    cues = parse_srt(srt)
    buffer = b""
    frame = 0
    try:
        while True:
            chunk = source_proc.stdout.read(65536)
            if not chunk:
                break
            buffer += chunk
            while True:
                start = buffer.find(b"\x89PNG\r\n\x1a\n")
                if start < 0:
                    break
                end = buffer.find(b"IEND\xaeB`\x82", start)
                if end < 0:
                    break
                end += 8
                png = buffer[start:end]
                buffer = buffer[end:]
                if frame >= round(TOTAL_SECONDS * 25):
                    break
                current = frame / 25
                target = source_time(current)
                # The pipe is sequential. Select the nearest source frame by
                # holding the decoded image until the EDL asks for a new one.
                # The source capture is already at 25 fps, so this remains exact.
                previous = Image.open(io.BytesIO(png)).convert("RGB")
                scale = min(width / 1280, (height - band - 40) / 900)
                sw, sh = round(1280 * scale), round(900 * scale)
                image = previous.resize((sw, sh), Image.Resampling.BILINEAR)
                canvas = Image.new("RGB", (width, height), (13, 57, 57))
                canvas.paste(image, ((width - sw) // 2, 20))
                cue = next((item for item in cues if item[0] <= current < item[1]), None)
                if cue:
                    wrapped = textwrap.fill(cue[2], width=68 if width > 1000 else 30)
                    layer = Image.new("RGBA", (width, band), (8, 22, 22, 230))
                    canvas.paste(layer, (0, height - band), layer)
                    draw = ImageDraw.Draw(canvas)
                    bounds = draw.multiline_textbbox((0, 0), wrapped, font=font, spacing=6)
                    tw, th = bounds[2] - bounds[0], bounds[3] - bounds[1]
                    draw.multiline_text(((width - tw) // 2, height - band + (band - th) // 2), wrapped, font=font, fill="white", spacing=6, align="center")
                encoded = io.BytesIO()
                canvas.save(encoded, format="PNG", compress_level=1)
                encoder.stdin.write(encoded.getvalue())
                frame += 1
            if frame >= round(TOTAL_SECONDS * 25):
                break
    finally:
        source_proc.stdout.close()
        source_proc.wait()
        encoder.stdin.close()
    result = encoder.wait()
    if result:
        raise SystemExit(result)
    print(name, frame, "frames", out_path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--wav", type=Path, default=DEFAULT_WAV)
    parser.add_argument("--srt", type=Path, default=DEFAULT_SRT)
    parser.add_argument("--label", default="1iwP4oc_H3NlGLD2I7W_j")
    parser.add_argument("--out-dir", type=Path, default=ROOT / "docs/evidence/demo-edits")
    args = parser.parse_args()
    if not FFMPEG.exists():
        raise SystemExit(f"ffmpeg not found: {FFMPEG}")
    args.out_dir.mkdir(parents=True, exist_ok=True)
    master = build_master(args.source, args.label)
    for dimensions in ((1600, 900), (720, 1280)):
        render(master, args.wav, args.srt, args.out_dir, args.label, *dimensions)


if __name__ == "__main__":
    main()
