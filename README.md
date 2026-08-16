# SevenMedia Studio

SevenMedia Studio 是一个以本地处理为核心的媒体工作台。目前支持视频、图片与音频压缩，后续将扩展格式转换、视频剪辑、音频处理和更多桌面端能力。

## 当前能力

- 视频、图片和音频独立压缩工作台
- 默认保持源文件格式
- 大文件分片上传与磁盘会话
- FFmpeg 与 Sharp 本地压缩
- 压缩前后预览、体积与节省比例对比
- 明暗主题与响应式界面

## 本地运行

```powershell
npm install
npm run dev
```

打开 `http://localhost:3000`。

视频与音频压缩需要系统安装 FFmpeg，并确保 `ffmpeg` 与 `ffprobe` 可在命令行中使用。

## 构建

```powershell
npm run typecheck
npm run build
npm run start
```

## 部署说明

首页可以部署到常见的 Next.js 托管平台。完整压缩服务依赖 FFmpeg、可写临时磁盘和较长任务执行时间，更适合部署到带持久磁盘的 Node.js / Docker 服务器。

## Roadmap

- 媒体格式转换
- 视频裁剪、拼接与画幅调整
- 音频裁剪与轨道处理
- 字幕与封面工具
- 桌面端离线版本

