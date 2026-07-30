# Pavo 短剧工作台

真实 AI 生成版短剧工作流：创作需求、剧本、分镜脚本、分镜图和 Agnes 图生视频。

## 启动

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

开发页面为 `http://localhost:5173`，服务端为 `http://localhost:8787`。生产模式先运行 `npm run build`，再运行 `npm start`。

## 最少配置

使用 Agnes 完成联调，只需在 `.env` 中填写：

```env
AGNES_API_KEY=你的完整密钥
```

默认模型和接口地址已经写在 `.env.example`。密钥只由 `server.js` 读取，不会进入浏览器代码或构建产物。

## 已接入的供应商

- Agnes AI：文本、图片、图生视频
- OpenAI：文本、图片
- Anthropic Claude、Google Gemini：文本
- DeepSeek、Kimi、通义千问、豆包、智谱 GLM：文本
- 自定义 OpenAI 兼容接口：文本

生图接口已经保留。图生视频固定使用 Agnes Video v2.0，输入图片必须是 Agnes 可以访问的公开 URL。

## 独立 API 接入口

启动网页服务之外，另开一个终端运行：

```powershell
npm run api:entry
```

独立入口默认为 `http://127.0.0.1:8795`，兼容 Agnes 的 `/v1/chat/completions`、`/v1/images/generations` 和 `/v1/videos`。Key 由服务端自动注入，调用方不需要拿到 Agnes Key。健康检查：`GET /health`。

## 部署

GitHub 负责代码托管，不能直接运行本项目的 Node 后端。推荐将仓库连接到 Render，项目已提供 `render.yaml`；在 Render 中填入 `AGNES_API_KEY` 后会自动构建并启动。不要把 `.env` 或 `Agnes-apikey.txt` 上传到 GitHub。
