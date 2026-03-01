// music-video-gen — full end-to-end frontend
// Uploads audio to /api/generate, polls /api/status, downloads via /api/download

const uploadZone    = document.getElementById('uploadZone');
const audioInput    = document.getElementById('audioInput');
const settings      = document.getElementById('settings');
const progressPanel = document.getElementById('progressPanel');
const resultPanel   = document.getElementById('resultPanel');
const errorPanel    = document.getElementById('errorPanel');
let selectedFile    = null;
let pollTimer       = null;

// ── Drag & Drop ───────────────────────────────────────────────────────────────
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault(); uploadZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('audio/')) setFile(f);
});
audioInput.addEventListener('change', e => { if (e.target.files[0]) setFile(e.target.files[0]); });

function setFile(file) {
  selectedFile = file;
  document.getElementById('fileInfo').textContent = `🎵 ${file.name}  (${(file.size/1024/1024).toFixed(1)} MB)`;
  document.getElementById('songTitle').value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  uploadZone.style.display = 'none';
  settings.style.display = 'block';
}

// ── Submit ────────────────────────────────────────────────────────────────────
async function startGeneration() {
  if (!selectedFile) return;
  settings.style.display = 'none';
  showProgress();

  const fd = new FormData();
  fd.append('audio', selectedFile);
  fd.append('title', document.getElementById('songTitle').value || 'My Song');
  fd.append('style', document.getElementById('visualStyle').value);
  fd.append('clipDuration', document.getElementById('clipDuration').value);

  try {
    setStatus('Uploading audio...', 3);
    const res = await fetch('/api/generate', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    const kaggleLink = document.getElementById('kaggleLinkBtn');
    if (data.kernelUrl) { kaggleLink.href = data.kernelUrl; kaggleLink.style.display = 'block'; }

    setStatus('Pipeline started on Kaggle. This takes ~35–45 min...', 5);
    startPolling();
  } catch (err) {
    showError(err.message);
  }
}

// ── Polling ───────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 20000; // 20 sec — respectful of Kaggle rate limits

function startPolling() {
  pollTimer = setInterval(pollStatus, POLL_INTERVAL_MS);
  pollStatus(); // immediate first check
}

async function pollStatus() {
  try {
    const res  = await fetch('/api/status');
    const data = await res.json();

    if (!res.ok) { showError(data.error || 'Status check failed'); stopPolling(); return; }
    if (data.error) { showError(data.errorMessage || 'Pipeline failed on Kaggle'); stopPolling(); return; }

    // Update UI stage indicators
    updateStageUI(data.uiStage, data.progress);

    if (data.done) {
      stopPolling();
      showResult();
    } else if (data.error) {
      stopPolling();
      showError(data.errorMessage || 'Kaggle kernel failed');
    }
  } catch (err) {
    console.warn('Poll failed (will retry):', err.message);
  }
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ── UI Helpers ────────────────────────────────────────────────────────────────
const STAGE_ORDER = ['analysis', 'prompts', 'clips', 'assembly'];
const STAGE_LABEL = {
  analysis: { pct: 10, eta: 'Analyzing audio (~1 min)...' },
  prompts:  { pct: 20, eta: 'Writing scene prompts...' },
  clips:    { pct: 60, eta: 'Generating clips — the slow part (~30–40 min)...' },
  assembly: { pct: 90, eta: 'Assembling final video (~2 min)...' },
  done:     { pct: 100, eta: 'Done!' },
};

function showProgress() {
  progressPanel.style.display = 'block';
  setProgress(0);
}

function updateStageUI(uiStage, progress) {
  const info = STAGE_LABEL[uiStage] || {};
  STAGE_ORDER.forEach((s, i) => {
    const el = document.getElementById(`stage-${s}`);
    if (!el) return;
    const stageIdx = STAGE_ORDER.indexOf(uiStage);
    if (i < stageIdx) { el.className = 'stage done'; }
    else if (i === stageIdx) { el.className = 'stage active'; }
    else { el.className = 'stage'; }
  });
  if (progress != null) setProgress(progress);
  if (info.eta) setStatus(info.eta, progress);
}

function setProgress(pct) {
  document.getElementById('progressFill').style.width = Math.min(100, pct) + '%';
}

function setStatus(msg, pct) {
  document.getElementById('etaText').textContent = msg;
  if (pct != null) setProgress(pct);
}

function showResult() {
  progressPanel.style.display = 'none';
  resultPanel.style.display = 'block';
  // The video is proxied through /api/download
  const video = document.getElementById('resultVideo');
  video.src = '/api/download';
}

function showError(msg) {
  progressPanel.style.display = 'none';
  errorPanel.style.display = 'block';
  document.getElementById('errorText').textContent = msg;
}

function resetApp() {
  stopPolling();
  selectedFile = null;
  errorPanel.style.display = 'none';
  resultPanel.style.display = 'none';
  progressPanel.style.display = 'none';
  settings.style.display = 'none';
  uploadZone.style.display = 'block';
}
