# tcli

## 安装与更新

从 [Releases](https://github.com/XHTimmo/tcli/releases) 下载 `tcli_*_x64-setup.exe` 安装（按用户安装，无需管理员权限，默认 `%LOCALAPPDATA%\tcli`）。

程序启动时以及之后每 30 分钟检查一次 `releases/latest/download/latest.json`。发现新版本后，界面右下角显示“更新并重启”；确认后会下载、校验签名、结束所有终端并安装，随后自动启动新版本。工程列表保留，运行任务和终端标签不会恢复。更新包使用 minisign 签名，公钥写在 `src-tauri/tauri.conf.json`，签名不匹配的包会被拒绝。

## WSL 工程

在 Windows 版 tcli 顶部点击“+ WSL 工程”，从默认发行版的 Linux 主目录选择工程。要打开其他发行版，可在文件夹选择框的地址栏输入 `\\wsl.localhost\发行版名\home`。“打开工程”也能识别 `\\wsl$\发行版名\…` 和 `\\wsl.localhost\发行版名\…`。

文件树和编辑器直接访问选中的目录。Shell 标签在对应发行版的当前目录启动。pi 标签通过该发行版的交互式 Bash 启动 `pi`，请先确认在其中能运行 `pi --version`。恢复 pi 会话时，选择同一发行版中的 `.jsonl` 文件。

## pi 安装与路径

tcli 使用本机安装的 pi。新建 pi 标签前会检测 PATH、官方默认安装目录及 Windows 的 npm 用户目录；未找到时会打开配置窗口，可手动输入或选择 pi 启动文件（如 `pi.cmd`、`pi.exe`），也可点击“一键安装”。已保存的自定义路径优先使用，留空并保存可恢复自动检测。“设置 → pi 路径与安装…”可随时修改配置。

Windows 一键安装会打开独立 PowerShell 窗口，从 `https://pi.dev/install.ps1` 下载并运行官方安装脚本。请按窗口提示完成 Node.js 等依赖安装；结束后 tcli 会自动检测并继续打开 pi 标签。需要网络连接，不随 tcli 安装包离线捆绑 pi。其他系统请手动安装 pi 并选择路径。取消配置后仍可使用文件编辑和 Shell 标签。

pi 的账号登录由 pi 自身处理；官方安装版本可通过 `pi update` 更新，tcli 更新不会替你升级 pi。

工程会保存打开的标签和当前目录。pi 标签使用原会话 ID 恢复，需要 pi 支持 `--session-id`。

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

终端输入回归检查：`npm run test:terminal`（Node.js 22.13+）。覆盖复制、粘贴、组合键、输入法确认、异步粘贴与标签释放、OSC 52。

Windows PTY 回归检查：`cargo test --manifest-path src-tauri/Cargo.toml --test conpty_mouse`。通过真实 PowerShell、Node.js 和 ConPTY 验证全屏鼠标模式、上下滚轮、拖选及模式恢复；不需要 pi 账号或模型请求。

Windows 构建会自动下载固定版本的官方 `Microsoft.Windows.Console.ConPTY`，校验包和运行库的 SHA-256，并把 `conpty.dll`、`OpenConsole.exe` 及许可证放在程序目录、纳入安装包。首次构建需访问 NuGet，之后使用 `src-tauri/conpty/` 下已校验的缓存；可先运行 `node scripts/prepare-conpty.mjs` 准备依赖。版本与校验值在该脚本中维护。

## 文件浏览与编辑

左侧文件列表支持进入目录、返回上一级、刷新和按名称筛选当前目录。点击文件在中间区域打开独立标签；也可以通过“打开文件”选择工程外的文件。文件标签与 Pi、Shell 标签共存，切换工程时保留编辑内容。向终端插入文件路径改为先选中终端，再按住 Alt 点击文件。

在“设置 → 文件浏览模式”中可选择列表或树状浏览，保存后立即生效，重启后保留偏好。列表模式逐级进入目录；树状模式以工程为根，点击文件夹展开或折叠，按需加载子目录，并在本次运行中保留每个工程的展开状态。树状模式支持上下方向键移动、左右方向键展开/折叠，筛选范围为已加载的文件，刷新时会重新读取展开的目录。两种模式均支持点击文件打开、Alt+点击插入路径以及右键菜单。

文本编辑支持语法高亮、行号、缩进、撤销/重做、查找替换（Ctrl+F）和保存（Ctrl+S 或“保存”按钮）。标签上的圆点表示未保存；关闭文件、关闭工程、退出窗口或安装更新前，可选择保存、不保存或取消。文件标签及未保存内容不会在重启后恢复。

支持不超过 2 MiB 的 UTF-8 文本（含 BOM），保存时保留 BOM 和 CRLF 换行格式。保存前检查文件内容是否被外部程序修改，发生冲突时保留编辑内容并提示错误；可先复制修改，再用“重新读取”加载磁盘版本。写入使用同目录临时文件替换，避免写入失败时截断原文件。

PNG、JPEG、GIF、WebP、BMP、ICO、SVG 支持只读图片预览（不超过 10 MiB）。二进制文件、不支持的文本编码和超限文件会显示错误提示。

左侧右键菜单中的“在资源管理器中打开”可打开当前目录，右键文件可在资源管理器中定位；文件编辑和图片预览工具栏中的同名按钮可打开所在目录并选中文件。

## 终端复制、粘贴与 pi 交互

tcli 按 pi 自身的设置启动界面（新版 pi 默认全屏），可在 pi 的 `/settings` 中切换全屏与普通滚屏模式。全屏模式下，滚轮按鼠标协议交给 pi，由 pi 控制对话或菜单滚动；鼠标选区也由 pi 处理，是否松开鼠标自动复制取决于 pi 的设置。按住 Shift 拖选可使用终端原生选区。Windows 使用随 tcli 分发的 ConPTY，避免系统旧版吞掉鼠标模式后将滚轮变成输入历史的上下键。

- 终端原生选区：Ctrl+C、Ctrl+Shift+C 或 Ctrl+Insert 复制；无原生选区时 Ctrl+C 仍交给 pi／shell。
- 右键、Ctrl+Shift+V 或 Shift+Insert：粘贴系统剪贴板文本，多行内容按终端的括号粘贴模式传入。
- pi 中的 Ctrl+V：交给 pi 处理图片或文本粘贴；shell 中的 Ctrl+V 粘贴文本。
- pi 中的 Shift+Enter：换行；Enter 提交。带修饰键的 Enter、Ctrl+Shift+字母及 Ctrl+- 会保留各自的键码，具体动作由 pi 的快捷键配置决定。Ctrl+X 或 `/copy` 复制回复，支持 pi 发出的 OSC 52 剪贴板写入。

剪贴板读取期间切换标签不会抢回焦点，关闭标签会取消尚未送入终端的粘贴。终端当前支持真彩色，但未接入内联图片显示；Ctrl+V 将图片交给 pi 的功能与终端内显示图片是两项独立能力。

修改启动模式后需新建 pi 标签才能应用。tcli 自定义快捷键会优先于 pi，遇到冲突可在 tcli 设置中清空或改绑，并在 pi 中运行 `/hotkeys` 查看当前按键。

## 快捷键设置

点击右下角“设置”或按 Ctrl+, 打开快捷键设置。支持自定义打开工程、新建 pi／shell 终端、关闭标签、切换标签、保存文件、打开资源管理器、打开设置和结束进程的快捷键。

点击输入框后按下所需组合键，Backspace／Delete 可清空绑定；保存前会检查重复绑定，也可恢复默认。除结束进程外，组合键需要包含 Ctrl、Alt 或 Meta。保存后立即生效，设置保存在本机，重启后保留。

## Magpie 路由

右下角读取本机 `http://127.0.0.1:3425/v1/magpie/trace`，每 2 秒更新。按会话展示最近的 12 条路由，包含客户端、供应商、模型、状态、传输量、耗时和目录；展示范围为本机 Magpie 的会话。窗口隐藏时暂停轮询，连接失败后自动重试。
