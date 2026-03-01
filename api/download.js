// api/download.js
// Proxies the Kaggle kernel output ZIP download to the browser.
// Kaggle output is only downloadable with auth — this proxy adds the creds server-side.

import fetch from 'node-fetch';

const KAGGLE_USERNAME = process.env.KAGGLE_USERNAME || 'zackrandall';
const KAGGLE_KEY      = process.env.KAGGLE_KEY;
const KERNEL_SLUG     = 'music-video-pipeline';

const kaggleAuth = () => 'Basic ' + Buffer.from(`${KAGGLE_USERNAME}:${KAGGLE_KEY}`).toString('base64');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // List output files
    const listRes = await fetch(
      `https://www.kaggle.com/api/v1/kernels/${KAGGLE_USERNAME}/${KERNEL_SLUG}/output?type=file`,
      { headers: { Authorization: kaggleAuth() } }
    );
    const listData = await listRes.json();
    const files = listData.files || [];

    // Find the .mp4
    const mp4 = files.find(f => f.fileName && f.fileName.endsWith('_music_video.mp4'));
    if (!mp4) {
      return res.status(404).json({ error: 'Video not found in output yet', files: files.map(f => f.fileName) });
    }

    // Proxy the file
    const fileRes = await fetch(mp4.url, { headers: { Authorization: kaggleAuth() } });
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${mp4.fileName}"`);
    if (fileRes.headers.get('content-length')) {
      res.setHeader('Content-Length', fileRes.headers.get('content-length'));
    }
    fileRes.body.pipe(res);

  } catch (err) {
    console.error('[/api/download] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
