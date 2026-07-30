import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Aperture, Check, ChevronRight, CircleAlert, Clapperboard, Download, Film, Image as ImageIcon, LoaderCircle, Pause, Play, RefreshCw, Settings2, Sparkles, Video, WandSparkles } from 'lucide-react';
import './style.css';
import './style-tech.css';

const stages = [
  { id: 'idea', label: '创作需求', icon: Sparkles },
  { id: 'script', label: '剧本', icon: Clapperboard },
  { id: 'shots', label: '分镜脚本', icon: Film },
  { id: 'frames', label: '分镜图', icon: ImageIcon },
  { id: 'video', label: '图生视频', icon: Video }
];

const emptyProject = { idea: '', script: '', shots: '', framePrompt: '', frameUrl: '', videoPrompt: '人物保持一致，轻微呼吸，缓慢抬眼看向镜头；镜头稳定向前推进，电影感光影，自然运动。', videoJob: null };
const api = async (url, options = {}) => {
  const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
};

function App() {
  const saved = useMemo(() => { try { return { ...emptyProject, ...JSON.parse(localStorage.getItem('pavo-project') || '{}') }; } catch { return emptyProject; } }, []);
  const [config, setConfig] = useState({ providers: [] });
  const [provider, setProvider] = useState('agnes');
  const [model, setModel] = useState('');
  const [stage, setStage] = useState('idea');
  const [project, setProject] = useState(saved);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(false);
  const [providerHealth, setProviderHealth] = useState({ status: 'checking', message: '正在验证' });
  const [previewPlaying, setPreviewPlaying] = useState(true);
  const selected = useMemo(() => config.providers.find(item => item.id === provider), [config, provider]);
  const patchProject = values => setProject(current => ({ ...current, ...values }));

  useEffect(() => { api('/api/config').then(data => { setConfig(data); const first = data.providers.find(item => item.configured); if (first) setProvider(first.id); }).catch(e => setError(e.message)); }, []);
  useEffect(() => { setModel(selected?.model || ''); }, [selected]);
  useEffect(() => {
    if (!selected) return;
    if (!selected.configured) { setProviderHealth({ status: 'missing', message: '未配置' }); return; }
    if (selected.id !== 'agnes') { setProviderHealth({ status: 'configured', message: '已配置' }); return; }
    setProviderHealth({ status: 'checking', message: '正在验证' });
    api(`/api/providers/${selected.id}/test`, { method: 'POST', body: '{}' })
      .then(data => setProviderHealth({ status: data.verified ? 'verified' : 'configured', message: data.verified ? '已验证' : '已配置' }))
      .catch(error => setProviderHealth({ status: 'failed', message: '连接失败', detail: error.message }));
  }, [selected]);
  useEffect(() => { localStorage.setItem('pavo-project', JSON.stringify(project)); }, [project]);

  const completed = { idea: Boolean(project.idea.trim()), script: Boolean(project.script.trim()), shots: Boolean(project.shots.trim()), frames: Boolean(project.frameUrl.trim()), video: Boolean(project.videoJob?.url) };
  const progress = Object.values(completed).filter(Boolean).length;

  const runText = async kind => {
    const source = kind === 'script' ? project.idea : kind === 'shots' ? project.script : project.shots;
    if (!source.trim()) return setError(kind === 'script' ? '请先填写故事设定。' : kind === 'shots' ? '请先生成或粘贴剧本。' : '请先准备分镜脚本。');
    setError(''); setBusy(kind);
    const prompts = {
      script: `请把以下创意写成可拍摄的竖屏短剧剧本。要求：中文；约3分钟；包含片名、人物小传、场次、动作、台词和结尾钩子；不要解释创作过程。\n\n创意：${source}`,
      shots: `请把以下短剧拆成专业分镜表。每个镜头必须包含：编号、时长、景别、画面内容、人物动作、台词或声音、运镜、首帧画面提示词。人物外观和服装要跨镜头一致。\n\n剧本：${source}`,
      frame: `根据以下分镜脚本，提炼第一个镜头的单帧生图提示词。输出中文提示词，包含人物固定外观、场景、动作瞬间、构图、镜头焦段、光线、色彩、电影质感，并明确要求无文字、无水印、9:16。只输出提示词。\n\n${source}`
    };
    try {
      const data = await api('/api/text/generate', { method: 'POST', body: JSON.stringify({ provider, model, prompt: prompts[kind], system: '你是专业的中国短剧编剧、分镜导演和视觉提示词设计师。输出必须具体、可执行。' }) });
      if (kind === 'script') { patchProject({ script: data.text }); setStage('script'); }
      if (kind === 'shots') { patchProject({ shots: data.text }); setStage('shots'); }
      if (kind === 'frame') { patchProject({ framePrompt: data.text }); setStage('frames'); }
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  const createImage = async () => {
    if (!project.framePrompt.trim()) return setError('请先生成或填写分镜图提示词。');
    setError(''); setBusy('image');
    try {
      const imageProvider = selected?.capabilities.includes('image') ? provider : 'agnes';
      const data = await api('/api/images/generate', { method: 'POST', body: JSON.stringify({ provider: imageProvider, prompt: project.framePrompt, size: '1024x1536' }) });
      const item = data.images?.[0] || {};
      patchProject({ frameUrl: item.url || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : '') });
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  const createVideo = async () => {
    if (!project.frameUrl.trim() || project.frameUrl.startsWith('data:')) return setError('Agnes 图生视频需要可公开访问的图片 URL，Base64 图片请先上传到对象存储。');
    setError(''); setBusy('video');
    try {
      const data = await api('/api/videos', { method: 'POST', body: JSON.stringify({ prompt: project.videoPrompt, image: project.frameUrl, width: 768, height: 1152, num_frames: 121, frame_rate: 24 }) });
      patchProject({ videoJob: { id: data.lookup_id, status: data.status || 'queued', raw: data } }); setStage('video');
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  const pollVideo = async () => {
    if (!project.videoJob?.id) return;
    setBusy('poll'); setError('');
    try {
      const data = await api(`/api/videos/${encodeURIComponent(project.videoJob.id)}`);
      patchProject({ videoJob: { ...project.videoJob, status: data.status || project.videoJob.status, url: data.video_url || data.url || data.output?.url, raw: data } });
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  return <div className="appShell">
    <aside className="sidebar">
      <div className="brand"><span>P</span><div><b>Pavo</b><small>短剧工作台</small></div></div>
      <div className="projectLabel"><span>当前项目</span><b>{project.idea.trim().slice(0, 18) || '未命名短剧'}</b></div>
      <nav>{stages.map(({ id, label, icon: Icon }, index) => <button key={id} className={stage === id ? 'active' : ''} onClick={() => setStage(id)}><span className="stepIndex">{completed[id] ? <Check/> : String(index + 1).padStart(2, '0')}</span><Icon/><span>{label}</span>{stage === id && <ChevronRight/>}</button>)}</nav>
      <div className="railProgress"><div><span>制作进度</span><b>{progress}/5</b></div><i><em style={{ width: `${progress * 20}%` }}/></i></div>
      <button className="settingsButton" onClick={() => setSettings(true)}><Settings2/> 模型与接口</button>
    </aside>

    <main className="main">
      <header className="topbar"><div><small>REAL GENERATION WORKSPACE</small><h1>{stages.find(item => item.id === stage)?.label}</h1></div><div className="topActions"><span className="autosave"><Check/>已自动保存</span><button className={`providerState ${providerHealth.status}`} onClick={() => setSettings(true)} title={providerHealth.detail || providerHealth.message}><i/>{selected?.label || '加载中'} · {providerHealth.message}</button></div></header>
      {error && <div className="error"><CircleAlert/><span>{error}</span><button onClick={() => setError('')}>关闭</button></div>}

      <section className="workspace">
        {stage === 'idea' && <div className="ideaLayout"><Panel eyebrow="STORY DEVELOPMENT" title="把灵感变成可拍的故事" note="描述人物、冲突和结局，真实模型会完成后续创作。">
          <textarea className="largeInput" value={project.idea} onChange={e => patchProject({ idea: e.target.value })} placeholder="例如：被裁员的女程序员回到县城，意外发现父亲留下的照相馆能拍到客人十年后的样子……" />
          <div className="promptFooter"><div className="chips"><button onClick={() => patchProject({ idea: '失业女程序员回到县城，发现父亲留下的照相馆能拍到客人十年后的样子。她必须在母亲病情恶化前，决定是否拍下母亲的未来。' })}>都市奇幻</button><button onClick={() => patchProject({ idea: '新来的乡村教师发现班里唯一的学生每天都在替十年前失踪的同学点名。' })}>悬疑反转</button></div><Action busy={busy === 'script'} disabled={!project.idea.trim()} onClick={() => runText('script')}><WandSparkles/>生成剧本</Action></div>
        </Panel><CinematicPreview playing={previewPlaying} setPlaying={setPreviewPlaying}/></div>}

        {stage === 'script' && <Panel eyebrow="SCRIPT ROOM" title="剧本编辑器" note="可直接校改生成结果；内容会在本地自动保存。"><textarea className="editor" value={project.script} onChange={e => patchProject({ script: e.target.value })} placeholder="生成结果会显示在这里，也可以粘贴自己的剧本。" /><Action busy={busy === 'shots'} disabled={!project.script.trim()} onClick={() => runText('shots')}>拆解专业分镜</Action></Panel>}

        {stage === 'shots' && <Panel eyebrow="SHOT DESIGN" title="分镜脚本" note="校对人物一致性、景别和运镜，再提炼首帧提示词。"><textarea className="editor" value={project.shots} onChange={e => patchProject({ shots: e.target.value })} placeholder="分镜表会显示在这里。" /><Action busy={busy === 'frame'} disabled={!project.shots.trim()} onClick={() => runText('frame')}>提炼首帧提示词</Action></Panel>}

        {stage === 'frames' && <div className="split"><Panel eyebrow="KEYFRAME" title="分镜图提示词" note="生图接口已保留，也可直接粘贴已有分镜图 URL。"><textarea className="promptInput" value={project.framePrompt} onChange={e => patchProject({ framePrompt: e.target.value })} placeholder="分镜图提示词" /><Action busy={busy === 'image'} disabled={!project.framePrompt.trim()} onClick={createImage}>调用生图模型</Action><Field label="分镜图公开 URL"><input value={project.frameUrl} onChange={e => patchProject({ frameUrl: e.target.value })} placeholder="https://.../storyboard-frame.png" /></Field></Panel><FramePreview url={project.frameUrl}/></div>}

        {stage === 'video' && <div className="split"><Panel eyebrow="MOTION LAB" title="Agnes 图生视频" note="只在此步骤调用 Agnes Video v2.0。"><Field label="分镜图公开 URL"><input value={project.frameUrl} onChange={e => patchProject({ frameUrl: e.target.value })} placeholder="https://..." /></Field><Field label="运动提示词"><textarea value={project.videoPrompt} onChange={e => patchProject({ videoPrompt: e.target.value })} /></Field><div className="videoSpecs"><span>9:16</span><span>121 帧</span><span>24 FPS</span><span>约 5 秒</span></div><Action busy={busy === 'video'} disabled={!project.frameUrl.trim()} onClick={createVideo}><Play/>创建视频任务</Action></Panel><VideoJob job={project.videoJob} busy={busy} poll={pollVideo}/></div>}
      </section>
    </main>

    {settings && <Settings config={config} provider={provider} setProvider={setProvider} model={model} setModel={setModel} refresh={setConfig} close={() => setSettings(false)}/>} 
  </div>;
}

function Panel({ eyebrow, title, note, children }) { return <section className="panel"><header className="panelHead"><small>{eyebrow}</small><h2>{title}</h2><p>{note}</p></header><div className="panelBody">{children}</div></section>; }
function Action({ busy, disabled, onClick, children }) { return <button className="primary" disabled={busy || disabled} onClick={onClick}>{busy ? <><LoaderCircle className="spin"/>正在请求真实模型</> : children}</button>; }
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }

function CinematicPreview({ playing, setPlaying }) { return <section className={`cinematic ${playing ? 'playing' : ''}`}><div className="scene"><div className="windowGlow"/><div className="rain"/><div className="silhouette"><i/></div><div className="focusFrame"><i/><i/><i/><i/></div><div className="scanline"/></div><header><span><i/>LIVE PREVIS</span><code>00:00:04:18</code></header><footer><button onClick={() => setPlaying(!playing)}>{playing ? <Pause/> : <Play/>}</button><div><b>镜头 01 · 缓慢推进</b><span>50mm · f/2.8 · 24fps</span></div><em>REC</em></footer></section>; }
function FramePreview({ url }) { return <section className="mediaStage">{url ? <img src={url} alt="分镜图"/> : <div className="mediaEmpty"><Aperture/><b>等待分镜图</b><span>生成图片或输入公开 URL</span></div>}<div className="stageMeta"><span>KEYFRAME 01</span><code>9:16 · 1024×1536</code></div></section>; }
function VideoJob({ job, busy, poll }) { return <section className="mediaStage videoStage">{!job ? <div className="mediaEmpty"><Video/><b>等待 Agnes 视频任务</b><span>分镜图将作为视频首帧</span></div> : <>{job.url ? <video controls autoPlay loop muted src={job.url}/> : <div className="rendering"><div className="renderRings"><i/><i/><i/></div><b>Agnes 正在生成</b><span>状态：{job.status}</span></div>}<div className="jobControls"><code>{job.id}</code><button onClick={poll} disabled={busy === 'poll'}><RefreshCw className={busy === 'poll' ? 'spin' : ''}/>刷新</button>{job.url && <a href={job.url} target="_blank" rel="noreferrer"><Download/>下载</a>}</div></>}<div className="stageMeta"><span>AGNES VIDEO V2.0</span><code>9:16 · 24 FPS</code></div></section>; }
function Settings({ config, provider, setProvider, model, setModel, refresh, close }) {
  const item = config.providers.find(p => p.id === provider);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { const data = await api(`/api/providers/${provider}/configure`, { method: 'POST', body: JSON.stringify({ apiKey, baseUrl, model }) }); refresh(data); setApiKey(''); }
    catch (e) { window.alert(e.message); } finally { setSaving(false); }
  };
  return <div className="modalBackdrop" onMouseDown={close}><section className="modal" onMouseDown={e => e.stopPropagation()}><header className="modalHead"><div><small>MODEL CONTROL CENTER</small><h2>模型与接口</h2></div><button onClick={close}>完成</button></header><p className="securityNote">Key 仅提交到本机服务端内存，不会回传、写入浏览器或 GitHub。部署到云端时请优先使用环境变量。</p><div className="providerList">{config.providers.map(item => <button key={item.id} className={provider === item.id ? 'selected' : ''} onClick={() => { setProvider(item.id); setModel(item.model); }}><span className="providerLogo">{item.label[0]}</span><span><b>{item.label}</b><small>{item.capabilities.join(' · ')} · {item.model || '未设置模型名'}</small></span><em className={item.configured ? 'on' : ''}>{item.configured ? <><Check/>已配置</> : '未配置'}</em></button>)}</div><div className="capabilityLegend"><span>剧本大模型：{item?.capabilities.includes('text') ? '可用' : '不可用'}</span><span>图片大模型：{item?.capabilities.includes('image') ? '可用' : '不可用'}</span><span>视频大模型：{item?.capabilities.includes('video') ? 'Agnes' : '仅 Agnes'}</span></div><Field label="API Key"><input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={item?.configured ? '已配置，留空表示不修改' : '粘贴供应商 API Key'} /></Field><Field label="模型名"><input value={model} onChange={e => setModel(e.target.value)} placeholder="例如 gpt-5-mini / deepseek-chat" /></Field>{item?.id !== 'anthropic' && item?.id !== 'gemini' && <Field label="接口地址（可选）"><input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" /></Field>}<button className="primary" onClick={save} disabled={saving}>{saving ? '正在保存...' : '保存到服务端并刷新状态'}</button><p className="envHint">已支持：Agnes、OpenAI、Anthropic、Gemini、DeepSeek、Kimi、通义千问、豆包、智谱和自定义 OpenAI 兼容接口。</p></section></div>;
}

createRoot(document.getElementById('root')).render(<App/>);
