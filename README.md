# 🎬 music-video-gen

AI-powered music video generator. Drop in any audio file → get back a full-length cinematic music video, fully synced to the beat.

## How It Works

```
Audio (.mp3/.wav)
    │
    ▼
[Stage 1] Audio Analysis
    Whisper        → lyrics + word timestamps
    Demucs         → vocal stem separation (cleaner transcription)
    librosa        → BPM, beat timestamps, song section boundaries
    │
    ▼
[Stage 2] Scene Prompt Generation
    Per segment: lyrics + mood + energy → cinematic text prompt
    Prompt chaining: each prompt shares visual anchor with previous
    │
    ▼
[Stage 3] Video Clip Generation (Kaggle GPU)
    Wan2.1 (T2V)   → one 4–6s cinematic clip per song segment
    Batch parallel execution across Kaggle T4/P100
    │
    ▼
[Stage 4] Assembly
    FFmpeg         → stitch clips + cross-dissolve on beat hits
    Audio overlay  → original song laid over full video
    Output         → final .mp4 saved to Google Drive
```

## Stack

| Component | Tool | Why |
|---|---|---|
| Transcription | Whisper (medium) | Proven params from karaoke pipeline |
| Vocal separation | Demucs | Cleaner lyrics from isolated vocal stem |
| Beat detection | librosa | Beat timestamps + BPM + energy curve |
| Prompt generation | GPT-style LLM or rule-based | Cinematic prompt per segment |
| Video generation | Wan2.1 (Alibaba) | Best photorealistic open-source T2V |
| Stitching | FFmpeg | Frame-accurate cross-dissolves on beats |
| Execution | Kaggle (free GPU, 30 hrs/wk) | P100/T4, Composio-triggered |
| Storage | Google Drive | Clips + final output |

## File Structure

```
music-video-gen/
├── kaggle/
│   └── music_video_pipeline.ipynb   ← Run this on Kaggle
├── frontend/
│   ├── index.html                   ← Vercel web UI
│   ├── app.js
│   └── styles.css
├── requirements.txt
└── README.md
```

## Quick Start

### Option A: Kaggle Notebook (Recommended)
1. Upload `kaggle/music_video_pipeline.ipynb` to Kaggle
2. Enable GPU accelerator (T4 or P100)
3. Set `AUDIO_PATH` to your audio file in Google Drive
4. Run all cells → final video saved to `/kaggle/working/output/`

### Option B: Vercel Web App
1. Deploy this repo to Vercel
2. Upload audio via browser UI
3. Pipeline runs on Kaggle in background
4. Download final video when done

## Estimated Runtime
- 3-minute song ≈ 12–15 segments × ~2–3 min each = ~35–45 min Kaggle GPU time
- Kaggle free tier = 30 hrs/week → ~40+ videos per week

## Credits
Inspired by:
- [AIMV](https://github.com/ferdavid1/AIMV) — Whisper + CogVideo pipeline
- [mugen](https://github.com/scherroman/mugen) — beat-sync video assembly
- [BeatSync Engine](https://github.com/Merserk/BeatSync-Engine) — librosa beat detection
