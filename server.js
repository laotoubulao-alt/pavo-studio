import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';
import { fetch, ProxyAgent } from 'undici';
import { spawn } from 'node:child_process';

// Agnes can resolve to an unreachable IPv6 route on some Windows networks.
dns.setDefaultResultOrder('ipv4first');

const app = express();
const port = Number(process.env.PORT || 8787);
const root = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json({ limit: '12mb' }));

const providers = {
  puter: { label: 'Puter AI 免费入口', kind: 'puter', key: '', base: '', model: '', fallbackModel: 'gpt-5-nano' },
  pollinations: { label: 'Pollinations 免费模型', kind: 'pollinations', key: '', base: '', model: '', fallbackModel: 'openai' },
  agnes: { label: 'Agnes AI', kind: 'openai', key: 'AGNES_API_KEY', base: 'AGNES_BASE_URL', model: 'AGNES_TEXT_MODEL', fallbackBase: 'https://apihub.agnes-ai.com', fallbackModel: 'agnes-2.0-flash' },
  openai: { label: 'OpenAI', kind: 'openai', key: 'OPENAI_API_KEY', base: 'OPENAI_BASE_URL', model: 'OPENAI_TEXT_MODEL', fallbackBase: 'https://api.openai.com/v1', fallbackModel: 'gpt-5-mini' },
  anthropic: { label: 'Anthropic', kind: 'anthropic', key: 'ANTHROPIC_API_KEY', model: 'ANTHROPIC_TEXT_MODEL', fallbackModel: 'claude-sonnet-4-5' },
  gemini: { label: 'Google Gemini', kind: 'gemini', key: 'GEMINI_API_KEY', model: 'GEMINI_TEXT_MODEL', fallbackModel: 'gemini-2.5-flash' },
  deepseek: { label: 'DeepSeek', kind: 'openai', key: 'DEEPSEEK_API_KEY', base: 'DEEPSEEK_BASE_URL', model: 'DEEPSEEK_TEXT_MODEL', fallbackBase: 'https://api.deepseek.com/v1', fallbackModel: 'deepseek-chat' },
  moonshot: { label: 'Kimi / Moonshot', kind: 'openai', key: 'MOONSHOT_API_KEY', base: 'MOONSHOT_BASE_URL', model: 'MOONSHOT_TEXT_MODEL', fallbackBase: 'https://api.moonshot.cn/v1', fallbackModel: 'moonshot-v1-32k' },
  qwen: { label: '通义千问', kind: 'openai', key: 'DASHSCOPE_API_KEY', base: 'DASHSCOPE_BASE_URL', model: 'DASHSCOPE_TEXT_MODEL', fallbackBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1', fallbackModel: 'qwen-plus' },
  doubao: { label: '豆包 / 火山方舟', kind: 'openai', key: 'ARK_API_KEY', base: 'ARK_BASE_URL', model: 'ARK_TEXT_MODEL', fallbackBase: 'https://ark.cn-beijing.volces.com/api/v3', fallbackModel: '' },
  zhipu: { label: '智谱 GLM', kind: 'openai', key: 'ZHIPU_API_KEY', base: 'ZHIPU_BASE_URL', model: 'ZHIPU_TEXT_MODEL', fallbackBase: 'https://open.bigmodel.cn/api/paas/v4', fallbackModel: 'glm-4-flash' },
  custom: { label: '自定义 OpenAI 兼容接口', kind: 'openai', key: 'CUSTOM_API_KEY', base: 'CUSTOM_BASE_URL', model: 'CUSTOM_TEXT_MODEL', fallbackBase: '', fallbackModel: '' }
};

const env = name => process.env[name]?.trim() || '';
const trimSlash = value => value.replace(/\/+$/, '');
const modelApiBase = (providerId, value) => providerId === 'agnes'
  ? `${trimSlash(value).replace(/\/v1$/, '')}/v1`
  : trimSlash(value);
const proxyUrl = env('HTTPS_PROXY') || env('HTTP_PROXY');
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
const windowsJsonFetch = async (url, options = {}) => {
  const response = await fetch('http://127.0.0.1:8790/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, method: options.method || 'GET', authorization: options.headers?.Authorization || options.headers?.authorization || '', body: options.body || '' }), signal: AbortSignal.timeout(130000) });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: { message: text } }; }
  if (!response.ok) { const error = new Error(response.status === 403 ? 'Agnes 拒绝了请求（403），请更换节点后重试。' : data?.error?.message || 'Agnes 本地桥接请求失败'); error.status = response.status; throw error; }
  return data;
};
const jsonFetch = async (url, options = {}) => {
  if (process.platform === 'win32' && url.startsWith(trimSlash(env('AGNES_BASE_URL') || 'https://apihub.agnes-ai.com'))) return windowsJsonFetch(url, options);
  const response = await fetch(url, {
    ...options,
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PavoStudio/1.0', accept: 'application/json', ...options.headers },
    dispatcher, signal: AbortSignal.timeout(60000)
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `上游接口返回 ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
};

function publicConfig() {
  return Object.entries(providers).map(([id, p]) => ({
    id,
    label: p.label,
    configured: ['puter', 'pollinations'].includes(p.kind) || Boolean(env(p.key) && (p.kind !== 'openai' || env(p.base) || p.fallbackBase)),
    model: env(p.model) || p.fallbackModel,
    capabilities: id === 'agnes' ? ['text', 'image', 'video'] : id === 'puter' ? ['text'] : ['pollinations', 'openai'].includes(id) ? ['image'] : ['text']
  }));
}

app.get('/api/config', (_req, res) => res.json({ providers: publicConfig() }));

// Runtime configuration endpoint. Keys are kept in the server process only;
// they are never returned to the browser and are not written to disk.
app.post('/api/providers/:id/configure', (req, res) => {
  const p = providers[req.params.id];
  if (!p) return res.status(404).json({ error: '供应商不存在' });
  const { apiKey, baseUrl, model } = req.body || {};
  if (typeof apiKey === 'string' && apiKey.trim()) process.env[p.key] = apiKey.trim();
  if (p.base && typeof baseUrl === 'string' && baseUrl.trim()) process.env[p.base] = baseUrl.trim();
  if (p.model && typeof model === 'string' && model.trim()) process.env[p.model] = model.trim();
  res.json({ providers: publicConfig() });
});

app.post('/api/providers/:id/test', async (req, res, next) => {
  try {
    const p = providers[req.params.id];
    if (!p) return res.status(404).json({ error: '模型供应商不存在' });
    if (p.kind === 'puter') return res.json({ ok: true, configured: true, verified: true, message: '浏览器授权后可用' });
    if (p.kind === 'pollinations') return res.json({ ok: true, configured: true, verified: true, message: '免费图片模型可用' });
    const key = env(p.key);
    if (!key) return res.status(503).json({ error: `${p.label} 尚未配置 API Key` });
    if (req.params.id !== 'agnes') return res.json({ ok: true, configured: true, verified: false, message: '已配置，尚未执行付费验证' });
    const model = env(p.model) || p.fallbackModel;
    const base = modelApiBase(req.params.id, env(p.base) || p.fallbackBase);
    const data = await jsonFetch(`${base}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply exactly: ok' }], max_tokens: 5, temperature: 0 }) });
    res.json({ ok: Boolean(data.choices?.[0]?.message?.content), configured: true, verified: true, message: 'Agnes API 已验证可用' });
  } catch (error) { next(error); }
});

app.post('/api/text/generate', async (req, res, next) => {
  try {
    const { provider = 'agnes', model, system, prompt, temperature = 0.7 } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: '缺少生成提示词' });
    const p = providers[provider];
    if (!p) return res.status(400).json({ error: '不支持的模型供应商' });
    const key = env(p.key);
    if (!key) return res.status(503).json({ error: `${p.label} 尚未配置 API Key` });
    const selectedModel = model?.trim() || env(p.model) || p.fallbackModel;
    let data;
    if (p.kind === 'anthropic') {
      data = await jsonFetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: selectedModel, max_tokens: 4096, system: system || '', messages: [{ role: 'user', content: prompt }], temperature }) });
      return res.json({ text: data.content?.map(x => x.text || '').join('') || '', usage: data.usage, provider, model: selectedModel });
    }
    if (p.kind === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent?key=${encodeURIComponent(key)}`;
      data = await jsonFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature } }) });
      return res.json({ text: data.candidates?.[0]?.content?.parts?.map(x => x.text || '').join('') || '', usage: data.usageMetadata, provider, model: selectedModel });
    }
    const base = modelApiBase(provider, env(p.base) || p.fallbackBase);
    data = await jsonFetch(`${base}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: selectedModel, messages: [{ role: 'system', content: system || '你是专业的中文短剧编剧和分镜导演。' }, { role: 'user', content: prompt }], temperature }) });
    res.json({ text: data.choices?.[0]?.message?.content || '', usage: data.usage, provider, model: selectedModel });
  } catch (error) { next(error); }
});

app.post('/api/images/generate', async (req, res, next) => {
  try {
    const { provider = 'agnes', prompt, size = '1024x1536', images = [] } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: '缺少图片提示词' });
    if (provider === 'pollinations') {
      const [width, height] = size.split('x').map(Number);
      const safePrompt = prompt.replace(/\s+/g, ' ').trim().slice(0, 320);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(safePrompt)}?width=${width || 1024}&height=${height || 1536}&model=flux&nologo=true&seed=${Date.now()}`;
      return res.json({ images: [{ url }], provider, model: 'flux' });
    }
    if (!['agnes', 'openai'].includes(provider)) return res.status(400).json({ error: '该供应商未配置图片生成适配器' });
    const p = providers[provider], key = env(p.key);
    if (!key) return res.status(503).json({ error: `${p.label} 尚未配置 API Key` });
    const base = modelApiBase(provider, env(p.base) || p.fallbackBase);
    const model = provider === 'agnes' ? env('AGNES_IMAGE_MODEL') || 'agnes-image-2.1-flash' : env('OPENAI_IMAGE_MODEL') || 'gpt-image-1';
    const body = { model, prompt, size };
    if (images.length) body.extra_body = { image: images, response_format: 'url' };
    const data = await jsonFetch(`${base}/images/generations`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    res.json({ images: data.data || [], provider, model });
  } catch (error) { next(error); }
});

app.post('/api/videos', async (req, res, next) => {
  try {
    const key = env('AGNES_API_KEY');
    if (!key) return res.status(503).json({ error: 'Agnes 尚未配置 API Key' });
    const { prompt, image, width = 768, height = 1152, num_frames = 121, frame_rate = 24, seed, negative_prompt } = req.body;
    if (!prompt?.trim() || !image) return res.status(400).json({ error: '图生视频需要提示词和可公开访问的分镜图片 URL' });
    const base = trimSlash(env('AGNES_BASE_URL') || 'https://apihub.agnes-ai.com').replace(/\/v1$/, '');
    const payload = { model: env('AGNES_VIDEO_MODEL') || 'agnes-video-v2.0', prompt, image, mode: 'ti2vid', width, height, num_frames, frame_rate };
    if (seed !== undefined && seed !== '') payload.seed = Number(seed);
    if (negative_prompt) payload.negative_prompt = negative_prompt;
    const data = await jsonFetch(`${base}/v1/videos`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    res.json({ ...data, lookup_id: data.video_id || data.task_id });
  } catch (error) { next(error); }
});

app.get('/api/videos/:id', async (req, res, next) => {
  try {
    const key = env('AGNES_API_KEY');
    if (!key) return res.status(503).json({ error: 'Agnes 尚未配置 API Key' });
    const base = trimSlash(env('AGNES_BASE_URL') || 'https://apihub.agnes-ai.com').replace(/\/v1$/, '');
    const headers = { Authorization: `Bearer ${key}` };
    try {
      return res.json(await jsonFetch(`${base}/agnesapi?video_id=${encodeURIComponent(req.params.id)}`, { headers }));
    } catch (error) {
      if (error.status !== 404) throw error;
      return res.json(await jsonFetch(`${base}/v1/videos/${encodeURIComponent(req.params.id)}`, { headers }));
    }
  } catch (error) { next(error); }
});

app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));
app.use((error, _req, res, _next) => {
  console.error(error.message);
  res.status(error.status && error.status < 600 ? error.status : 500).json({ error: error.message || '服务端请求失败' });
});

app.use(express.static(path.join(root, 'dist')));
app.use((req, res, next) => {
  if (req.method !== 'GET' || !req.accepts('html')) return next();
  res.sendFile(path.join(root, 'dist', 'index.html'));
});
app.listen(port, () => console.log(`Pavo server: http://localhost:${port}`));
