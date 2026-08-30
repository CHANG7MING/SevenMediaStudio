# macOS 发布签名

GitHub Actions 需要以下 Repository Secrets，DMG 才能通过 macOS Gatekeeper：

- `APPLE_CERTIFICATE`: Developer ID Application 证书的 base64 内容
- `APPLE_CERTIFICATE_PASSWORD`: 导出 `.p12` 时设置的密码
- `APPLE_SIGNING_IDENTITY`: 例如 `Developer ID Application: Your Name (TEAMID)`
- `APPLE_ID`: Apple Developer 账号邮箱
- `APPLE_PASSWORD`: App 专用密码
- `APPLE_TEAM_ID`: Apple Developer Team ID

导出证书内容：

```bash
base64 -i developer-id-application.p12 | pbcopy
```

`APPLE_PASSWORD` 必须是 Apple 账号生成的 app-specific password，不是登录密码。
配置完成后，推送 `v*` tag，工作流会签名、notarize 并上传可直接打开的 DMG。
