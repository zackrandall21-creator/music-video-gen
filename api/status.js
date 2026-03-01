// api/status.js
// Polls Kaggle kernel execution status and returns it to the frontend.
// Also proxies the final video download URL when complete.

import fetch from 'node-fetch';

const KAGGLE_USERNAME = process.env.KAGGLE_USERNAME || 'zackrandall';
const KAGGLE_KEY      = process.env.KAGGLE_KEY;
const KERNEL_SLUG     = 'music-video-pipeline';

const kaggleAuth = () => 'Basic ' + Buffer.from(`${KAGGLE_USERNAME}:${KAGGLE_KEY}`).toString('base64');

// Kaggle status → our UI stage mapping
function mapStatus(kaggleStatus, outputUrl) {
  switch (kaggleStatus) {
    case 'queued':    return { uiStage: 'analysis',  progress: 5,   running: true,  done: false, error: false };
    case 'running':   return { uiStage: 'clips',     progress: 50,  running: true,  done: false, error: false };
    case 'complete':  return { uiStage: 'done',      progress: 100, running: false, done: true,  error: false, downloadUrl: outputUrl };
    case 'error':     return { uiStage: 'error',     progress: 0,   running: false, done: false, error: true  };
    case 'cancelled': return { uiStage: 'cancelled', progress: 0,   running: false, done: false, error: true  };
    default:          return { uiStage: 'queued',    progress: 2,   running: true,  done: false, error: false };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const r = await fetch(
      `https://www.kaggle.com/api/v1/kernels/${KAGGLE_USERNAME}/${KERNEL_SLUG}/status`,
      { headers: { Authorization: kaggleAuth() } }
    );

    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: `Kaggle API error: ${text}` });
    }

    const data = await r.json();
    const kaggleStatus = data.status;
    const outputUrl    = data.failureMessage ? null : `https://www.kaggle.com/code/${KAGGLE_USERNAME}/${KERNEL_SLUG}/output`;
    const errorMsg     = data.failureMessage || null;
    const startedAt    = data.startTime || null;
    const finishedAt   = data.completionTime || null;

    const mapped = mapStatus(kaggleStatus, outputUrl);

    return res.status(200).json({
      kaggleStatus,
      ...mapped,
      errorMessage: errorMsg,
      startedAt,
      finishedAt,
      kernelUrl: `https://www.kaggle.com/code/${KAGGLE_USERNAME}/${KERNEL_SLUG}`
    });

  } catch (err) {
    console.error('[/api/status] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
