// api/generate.js
// Vercel serverless function: receives audio upload, pushes to Kaggle as dataset,
// triggers the music-video kernel, returns a job ID for polling.

import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';

export const config = { api: { bodyParser: false } };

const KAGGLE_USERNAME = process.env.KAGGLE_USERNAME || 'zackrandall';
const KAGGLE_KEY      = process.env.KAGGLE_KEY;
const KERNEL_SLUG     = 'music-video-pipeline';
const DATASET_SLUG    = 'music-video-input';

// Kaggle Basic Auth header
const kaggleAuth = () => 'Basic ' + Buffer.from(`${KAGGLE_USERNAME}:${KAGGLE_KEY}`).toString('base64');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. Parse the uploaded audio file
    const { fields, files } = await parseForm(req);
    const audioFile = Array.isArray(files.audio) ? files.audio[0] : files.audio;
    const songTitle  = (Array.isArray(fields.title)  ? fields.title[0]  : fields.title)  || 'My Song';
    const visualStyle = (Array.isArray(fields.style) ? fields.style[0] : fields.style) || 'cinematic photorealistic, golden hour lighting, shallow depth of field, 4K';
    const clipDuration = parseInt((Array.isArray(fields.clipDuration) ? fields.clipDuration[0] : fields.clipDuration) || '5', 10);

    if (!audioFile) return res.status(400).json({ error: 'No audio file provided' });

    const audioPath = audioFile.filepath || audioFile.path;
    const audioName = audioFile.originalFilename || audioFile.name || 'song.mp3';

    // 2. Create / update Kaggle dataset with the audio file
    const datasetExists = await checkDatasetExists();
    if (!datasetExists) {
      await createKaggleDataset(audioPath, audioName, songTitle);
    } else {
      await updateKaggleDataset(audioPath, audioName);
    }

    // 3. Create / update the kernel on Kaggle with the right env vars, then trigger a run
    const kernelExists = await checkKernelExists();
    if (!kernelExists) {
      await createKaggleKernel(songTitle, visualStyle, clipDuration, audioName);
    } else {
      await updateKaggleKernel(songTitle, visualStyle, clipDuration, audioName);
    }

    // 4. Return a job reference the UI can poll
    const jobId = `${KAGGLE_USERNAME}/${KERNEL_SLUG}`;
    return res.status(200).json({
      success: true,
      jobId,
      kernelUrl: `https://www.kaggle.com/code/${KAGGLE_USERNAME}/${KERNEL_SLUG}`,
      message: 'Pipeline started on Kaggle. Poll /api/status for progress.'
    });

  } catch (err) {
    console.error('[/api/generate] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({ maxFileSize: 100 * 1024 * 1024 });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

async function checkDatasetExists() {
  const r = await fetch(
    `https://www.kaggle.com/api/v1/datasets/${KAGGLE_USERNAME}/${DATASET_SLUG}`,
    { headers: { Authorization: kaggleAuth() } }
  );
  return r.status === 200;
}

async function createKaggleDataset(audioPath, audioName, songTitle) {
  // Step 1: Init the upload token
  const initRes = await fetch(`https://www.kaggle.com/api/v1/datasets/upload/file/1`, {
    method: 'POST',
    headers: { Authorization: kaggleAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: audioName })
  });
  const { token, createUrl } = await initRes.json();

  // Step 2: Upload file bytes
  const fileBytes = fs.readFileSync(audioPath);
  await fetch(createUrl, {
    method: 'PUT',
    body: fileBytes,
    headers: { 'Content-Type': 'audio/mpeg' }
  });

  // Step 3: Create dataset
  await fetch('https://www.kaggle.com/api/v1/datasets', {
    method: 'POST',
    headers: { Authorization: kaggleAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ownerSlug: KAGGLE_USERNAME,
      slug: DATASET_SLUG,
      title: 'Music Video Input',
      isPrivate: true,
      licenses: [{ name: 'other' }],
      files: [{ token }]
    })
  });
}

async function updateKaggleDataset(audioPath, audioName) {
  // Upload new version
  const initRes = await fetch(`https://www.kaggle.com/api/v1/datasets/upload/file/1`, {
    method: 'POST',
    headers: { Authorization: kaggleAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: audioName })
  });
  const { token, createUrl } = await initRes.json();
  const fileBytes = fs.readFileSync(audioPath);
  await fetch(createUrl, { method: 'PUT', body: fileBytes, headers: { 'Content-Type': 'audio/mpeg' } });

  await fetch(`https://www.kaggle.com/api/v1/datasets/${KAGGLE_USERNAME}/${DATASET_SLUG}/versions`, {
    method: 'POST',
    headers: { Authorization: kaggleAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionNotes: 'New audio upload', files: [{ token }], convertToCsv: false, deleteOldVersions: true })
  });
}

async function checkKernelExists() {
  const r = await fetch(
    `https://www.kaggle.com/api/v1/kernels/${KAGGLE_USERNAME}/${KERNEL_SLUG}`,
    { headers: { Authorization: kaggleAuth() } }
  );
  return r.status === 200;
}

function buildKernelSource(songTitle, visualStyle, clipDuration, audioName) {
  // This is the full notebook source injected as a script kernel
  // Reads env vars set at kernel level for parameterization
  return `
import os, subprocess, json, gc
import whisper, librosa, numpy as np, torch
from diffusers import AutoencoderKLWan, WanPipeline
from diffusers.schedulers.scheduling_unipc_multistep import UniPCMultistepScheduler
from tqdm import tqdm

# Config from env
SONG_TITLE    = os.environ.get('SONG_TITLE', '${songTitle.replace(/'/g, "\\'")}')
VISUAL_STYLE  = os.environ.get('VISUAL_STYLE', '${visualStyle.replace(/'/g, "\\'")}')
CLIP_DURATION = int(os.environ.get('CLIP_DURATION', '${clipDuration}'))
AUDIO_NAME    = '${audioName.replace(/'/g, "\\'")}'.split('/')[-1]
AUDIO_PATH    = f'/kaggle/input/music-video-input/{AUDIO_NAME}'
OUTPUT_DIR    = '/kaggle/working/output'
CLIPS_DIR     = f'{OUTPUT_DIR}/clips'
VIDEO_FPS     = 24
VIDEO_WIDTH   = 1280
VIDEO_HEIGHT  = 720
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(CLIPS_DIR, exist_ok=True)

print(f'=== Music Video Generator ===')
print(f'Song: {SONG_TITLE} | Style: {VISUAL_STYLE[:40]} | Clip: {CLIP_DURATION}s')
print(f'Audio: {AUDIO_PATH}')

# Stage 1: Audio Analysis
print('\n[Stage 1] Whisper transcription...')
model = whisper.load_model('medium')
result = model.transcribe(AUDIO_PATH, word_timestamps=True, temperature=0.2, best_of=5,
    compression_ratio_threshold=2.8, no_speech_threshold=1, condition_on_previous_text=True)
segments = result['segments']
print(f'  {len(segments)} segments transcribed')

print('[Stage 1] librosa beat detection...')
y, sr = librosa.load(AUDIO_PATH, sr=None)
tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
rms = librosa.feature.rms(y=y)[0]
rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr)
print(f'  BPM: {tempo:.1f}')

# Segment into clip windows
video_segments = []
current_start = 0.0; current_text = []
for seg in segments:
    if seg['end'] - current_start >= CLIP_DURATION and current_text:
        mask = (rms_times >= current_start) & (rms_times < seg['start'])
        energy = float(np.mean(rms[mask])) if mask.any() else 0.5
        video_segments.append({'start': current_start, 'end': seg['start'],
            'lyrics': ' '.join(current_text), 'energy': energy,
            'beat_count': sum(1 for b in beat_times if current_start <= b < seg['start'])})
        current_start = seg['start']; current_text = []
    current_text.append(seg['text'].strip())
if current_text:
    end = segments[-1]['end'] if segments else 0
    mask = (rms_times >= current_start) & (rms_times <= end)
    video_segments.append({'start': current_start, 'end': end,
        'lyrics': ' '.join(current_text),
        'energy': float(np.mean(rms[mask])) if mask.any() else 0.5,
        'beat_count': sum(1 for b in beat_times if current_start <= b <= end)})
print(f'  {len(video_segments)} video segments')

# Stage 2: Prompts
print('\n[Stage 2] Generating prompts...')
MOOD = {'high': 'dramatic wide shot, bold colors, dynamic movement', 'mid': 'medium shot, warm tones, gentle motion', 'low': 'intimate close-up, soft bokeh, slow motion'}
ANCHORS = ['golden wheat fields at sunset', 'downtown city streets at night', 'coastal cliffs with crashing waves', 'mountain forest trail in mist', 'open desert highway at dusk']
import random; random.seed(42)
anchor = random.choice(ANCHORS)
interval = max(3, len(video_segments) // len(ANCHORS))
al = [s['energy'] for s in video_segments]; emin, emax = min(al), max(al)
prompts = []
for i, seg in enumerate(video_segments):
    if i > 0 and i % interval == 0:
        anchor = random.choice([a for a in ANCHORS if a != anchor] or ANCHORS)
    ne = (seg['energy'] - emin) / (emax - emin + 1e-9)
    mood = 'high' if ne > .66 else 'mid' if ne > .33 else 'low'
    prompts.append({'i': i, 'mood': mood, 'prompt': f"{anchor}, {MOOD[mood]}, {VISUAL_STYLE}. Inspired by: {seg['lyrics'][:80]}. No text, no logos."})
print(f'  {len(prompts)} prompts ready')

# Write progress marker
with open(f'{OUTPUT_DIR}/progress.json', 'w') as f:
    json.dump({'stage': 'clips', 'total': len(prompts), 'done': 0}, f)

# Stage 3: Wan2.1 video generation
print('\n[Stage 3] Loading Wan2.1-T2V-1.3B...')
neg = 'worst quality, inconsistent motion, blurry, jittery, distorted, text, logo, watermark'
vae = AutoencoderKLWan.from_pretrained('Wan-AI/Wan2.1-T2V-1.3B-Diffusers', subfolder='vae', torch_dtype=torch.float32)
pipe = WanPipeline.from_pretrained('Wan-AI/Wan2.1-T2V-1.3B-Diffusers', vae=vae, torch_dtype=torch.bfloat16)
pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config, flow_shift=8.0)
pipe.to('cuda')
print('  Model loaded')

clip_paths = []
for p in tqdm(prompts, desc='Generating'):
    i = p['i']; cp = f'{CLIPS_DIR}/clip_{i:03d}.mp4'
    if os.path.exists(cp):
        clip_paths.append(cp); continue
    seg = video_segments[i]
    nf = max(16, min(81, int((seg['end'] - seg['start']) * VIDEO_FPS)))
    out = pipe(prompt=p['prompt'], negative_prompt=neg, height=VIDEO_HEIGHT, width=VIDEO_WIDTH,
               num_frames=nf, guidance_scale=5.0, num_inference_steps=30,
               generator=torch.Generator(device='cuda').manual_seed(i * 42))
    fd = f'{CLIPS_DIR}/frames_{i:03d}'; os.makedirs(fd, exist_ok=True)
    for fi, fr in enumerate(out.frames[0]): fr.save(f'{fd}/{fi:04d}.png')
    os.system(f'ffmpeg -y -framerate {VIDEO_FPS} -i {fd}/%04d.png -c:v libx264 -pix_fmt yuv420p -crf 18 {cp} -loglevel quiet')
    import shutil; shutil.rmtree(fd)
    clip_paths.append(cp)
    with open(f'{OUTPUT_DIR}/progress.json', 'w') as f:
        json.dump({'stage': 'clips', 'total': len(prompts), 'done': i+1}, f)
    torch.cuda.empty_cache(); gc.collect()

print(f'  {len(clip_paths)} clips done')

# Stage 4: Assembly
print('\n[Stage 4] Assembling...')
with open(f'{OUTPUT_DIR}/progress.json', 'w') as f:
    json.dump({'stage': 'assembly', 'total': len(prompts), 'done': len(clip_paths)}, f)
cf = f'{OUTPUT_DIR}/concat.txt'
with open(cf, 'w') as f:
    for cp in clip_paths: f.write(f"file '{cp}'\n")
raw = f'{OUTPUT_DIR}/raw_video.mp4'
subprocess.run(['ffmpeg','-y','-f','concat','-safe','0','-i',cf,'-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-r',str(VIDEO_FPS),raw], check=True, capture_output=True)
out_file = f"{OUTPUT_DIR}/{SONG_TITLE.replace(' ','_')}_music_video.mp4"
subprocess.run(['ffmpeg','-y','-i',raw,'-i',AUDIO_PATH,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-shortest',out_file], check=True, capture_output=True)
size = os.path.getsize(out_file)/(1024*1024)
print(f'  Done! {out_file} ({size:.1f} MB)')
with open(f'{OUTPUT_DIR}/progress.json', 'w') as f:
    json.dump({'stage': 'done', 'total': len(prompts), 'done': len(clip_paths), 'output': out_file, 'size_mb': round(size, 1)}, f)
`;
}

async function createKaggleKernel(songTitle, visualStyle, clipDuration, audioName) {
  const source = buildKernelSource(songTitle, visualStyle, clipDuration, audioName);
  await fetch('https://www.kaggle.com/api/v1/kernels/push', {
    method: 'POST',
    headers: { Authorization: kaggleAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug: KERNEL_SLUG,
      newTitle: 'Music Video Pipeline',
      source,
      language: 'python',
      kernelType: 'script',
      isPrivate: true,
      enableGpu: true,
      enableInternet: true,
      datasetDataSources: [`${KAGGLE_USERNAME}/${DATASET_SLUG}`],
      categoryIds: []
    })
  });
}

async function updateKaggleKernel(songTitle, visualStyle, clipDuration, audioName) {
  // Same as create — Kaggle push API creates a new version if slug exists
  return createKaggleKernel(songTitle, visualStyle, clipDuration, audioName);
}
