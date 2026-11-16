# tcli

## 安装与更新

从 [Releases](https://github.com/XHTimmo/tcli/releases) 下载 `tcli_*_x64-setup.exe` 安装（按用户安装，无需管理员权限，默认 `%LOCALAPPDATA%\tcli`）。

程序启动时以及之后每 30 分钟检查一次 `releases/latest/download/latest.json`。发现新版本后，界面右下角显示“更新并重启”；确认后会下载、校验签名、结束所有终端并安装，随后自动启动新版本。工程列表保留，运行任务和终端标签不会恢复。更新包使用 minisign 签名，公钥写在 `src-tauri/tauri.conf.json`，签名不匹配的包会被拒绝。

## 发布新版本

1. 同步修改 `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 与 `package.json` 中的版本号。
2. 提交后打 tag 并推送：`git tag v0.2.0 && git push origin v0.2.0`。
3. GitHub Actions（`.github/workflows/release.yml`）构建 NSIS 安装包，用私钥签名，并把安装包、`.sig` 与 `latest.json` 发布到该 tag 的 Release。

仓库需要配置 Secrets：`TAURI_SIGNING_PRIVATE_KEY`（私钥文件 `~/.tauri/tcli.key` 的内容）；若私钥设有密码，再加 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。私钥丢失后已安装的版本将无法再收到更新，请妥善备份，切勿提交到仓库。

本地试打包（需要设置 `TAURI_SIGNING_PRIVATE_KEY` 环境变量）：`npm run build`，产物在 `src-tauri/target/release/bundle/nsis/`。

## 开发

```sh
npm run dev
```

开发模式运行 `target/debug/tcli.exe`，修改 Rust 或 Cargo 配置会触发自动重启，适合调试，且不检查更新。日常任务请使用安装版。

## Magpie 路由

右下角读取本机 `http://127.0.0.1:3425/v1/magpie/trace`，每 2 秒更新。按会话展示最近的 12 条路由，包含客户端、供应商、模型、状态、传输量、耗时和目录；展示范围为本机 Magpie 的会话。窗口隐藏时暂停轮询，连接失败后自动重试。
