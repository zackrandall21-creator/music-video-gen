// music-video-gen frontend
// Handles file upload, settings, and progress tracking

const uploadZone = document.getElementById('uploadZone');
const audioInput = document.getElementById('audioInput');
const settings = document.getElementById('settings');
const progressPanel = document.getElementById('progressPanel');
const resultPanel = document.getElementById('resultPanel');
let selectedFile = null;

// ── Drag & Drop ──────────────────────────────────────────────
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('audio/')) setFile(file);
});
audioInput.addEventListener('change', e => { if (e.target.files[0]) setFile(e.target.files[0]); });

function setFile(file) {
  selectedFile = file;
  const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
  document.getElementById('fileInfo').textContent = `🎵 ${file.name}  (${sizeMB} MB)`;
  uploadZone.style.display = 'none';
  settings.style.display = 'block';
}

// ── Generation ───────────────────────────────────────────────
function startGeneration() {
  if (!selectedFile) return;
  settings.style.display = 'none';
  progressPanel.style.display = 'block';
  simulateProgress();
  // In production: POST to /api/generate with FormData, poll /api/status
}

const STAGES = ['analysis', 'prompts', 'clips', 'assembly'];
const STAGE_PROGRESS = { analysis: 10, prompts: 20, clips: 85, assembly: 100 };
const STAGE_TIMES_MIN = { analysis: 0.5, prompts: 0.5, clips: 35, assembly: 3 };

function simulateProgress() {
  let currentStage = 0;

  function advanceStage() {
    if (currentStage >= STAGES.length) {
      showResult();
      return;
    }
    const stageName = STAGES[currentStage];
    const el = document.getElementById(`stage-${stageName}`);
    // Mark previous done
    if (currentStage > 0) {
      const prev = document.getElementById(`stage-${STAGES[currentStage - 1]}`);
      prev.classList.remove('active');
      prev.classList.add('done');
    }
    el.classList.add('active');
    // Animate progress bar
    const targetPct = STAGE_PROGRESS[stageName];
    document.getElementById('progressFill').style.width = targetPct + '%';
    // ETA
    const remaining = Object.values(STAGE_TIMES_MIN).slice(currentStage).reduce((a, b) => a + b, 0);
    document.getElementById('etaText').textContent = `Estimated time remaining: ~${Math.round(remaining)} min`;
    currentStage++;
    // Advance after simulated duration (demo only)
    setTimeout(advanceStage, STAGE_TIMES_MIN[stageName] * 1000); // scaled down for demo
  }

  advanceStage();
}

function showResult() {
  progressPanel.style.display = 'none';
  resultPanel.style.display = 'block';
  // In production: set resultVideo.src and downloadBtn.href to the output URL
  document.getElementById('resultVideo').poster = '';
  document.getElementById('downloadBtn').href = '#';
  document.getElementById('downloadBtn').textContent = '⬇️ Download MP4';
}
