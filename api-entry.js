import 'dotenv/config';
import express from 'express';

const app = express();
const port = Number(process.env.API_PORT || 8795);
const key = () => process.env.AGNES_API_KEY?.trim() || '';
const bridge = process.env.AGNESS_BRIDGE_URL || 'http://127.0.0.1:8790/';

app.use(express.json({ limit: '12mb' }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'pavo-api-entry', provider: 'agnes', configured: Boolean(key()) }));
app.use('/v1', async (req, res) => {
  if (!key()) return res.status(503).json({ error: { message: 'AGNES_API_KEY 未配置' } });
  try {
    const target = `https://apihub.agnes-ai.com${req.path}${req.url.includes('?') ? `?${req.url.split('?')[1]}` : ''}`;
    const response = await fetch(bridge, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: target, method: req.method, authorization: `Bearer ${key()}`, body: JSON.stringify(req.body || {}) }), signal: AbortSignal.timeout(150000) });
    const text = await response.text();
    res.status(response.status).type('application/json').send(text);
  } catch (error) { res.status(502).json({ error: { message: error.message || 'API 上游请求失败' } }); }
});
app.listen(port, () => console.log(`Pavo API entry: http://127.0.0.1:${port}`));
