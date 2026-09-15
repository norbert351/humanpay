#!/usr/bin/env python3
"""Generate en-US-AndrewNeural narration clips (calm, warm, +8%)."""
import json, subprocess, os, time

spec = json.load(open("demo/onyx_spec.json"))
outdir = "demo/andrew_clips"
os.makedirs(outdir, exist_ok=True)
for i, (anchor, text) in enumerate(spec["lines"]):
    mp3 = f"{outdir}/c{i}.mp3"
    wav = f"{outdir}/c{i}.wav"
    subprocess.run(["edge-tts", "--voice", "en-US-AndrewNeural", "--rate=+8%",
                    "--text", text, "--write-media", mp3], check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", mp3, "-ar", "44100", "-ac", "1",
                    "-c:a", "pcm_s16le", wav], check=True)
    dur = subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",wav],
                         capture_output=True, text=True).stdout.strip()
    print(f"c{i} anchor={anchor}s dur={float(dur):.1f}s")
print("ALL ANDREW CLIPS DONE")