# OFD Reader

一个轻量的 OFD（GB/T 33190，版式文档）桌面阅读器，使用 **Tauri 2 + Rust** 构建，后端解包 OFD 包，前端把每页渲染成 SVG。

[![CI](https://github.com/liuzhh/OFDReader/actions/workflows/ci.yml/badge.svg)](https://github.com/liuzhh/OFDReader/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-informational)

<!-- TODO: 放一张阅读器截图，例如 ![screenshot](docs/screenshot.png) -->

## 特性

- 打开标准 OFD 包：`OFD.xml` → `Document.xml` → 页面 / 模板 / 资源
- 按 GB/T 33190 的版式模型渲染：`TextObject`、`PathObject`、`ImageObject`、`CompositeObject`
- 解析 `PublicRes` / `DocumentRes`：字体映射、`DrawParam`（含 `Relative` 继承链）、`MultiMedia` 图片资源
- 资源按 `BaseLoc` 解析相对路径，支持大小写不敏感查找
- 逐字形定位（`TextCode` 的 `X` / `Y` / `DeltaX`），保留原始字距
- 多页文档连续渲染，支持缩放（20%–400%）与打印（含 `Ctrl+P`）
- 三种打开方式：文件对话框、拖拽到窗口、`Ctrl+O`
- 单文件可执行程序，体积经过 release profile 优化（`lto`、`opt-level = "z"`、`strip`）

## 下载安装

从 [Releases](https://github.com/liuzhh/OFDReader/releases) 下载对应平台的安装包：

| 平台 | 产物 |
| --- | --- |
| Windows | `.msi`（WiX）/ `.exe`（NSIS） |
| macOS | `.dmg` |
| Linux | `.AppImage` / `.deb` / `.rpm` |

> 未做代码签名，首次运行系统可能提示"未知发布者"，选择"仍要运行"即可。

## 从源码构建

### 前置条件

- [Rust](https://rustup.rs/) **1.88+**（`zip` 9 要求）
- [Node.js](https://nodejs.org/) **22.22.2+**（`jsdom` 的要求，仅测试与 Tauri CLI 需要）
- 平台构建依赖，参见 [Tauri prerequisites](https://tauri.app/start/prerequisites/)：
  - **Windows**：MSVC 工具链 + WebView2（Windows 10/11 已内置）
  - **macOS**：Xcode Command Line Tools
  - **Linux**：`libwebkit2gtk-4.1-dev`、`librsvg2-dev`、`patchelf` 等

### 步骤

```bash
npm install          # 安装 Tauri CLI 与测试依赖
npm run dev          # 开发模式（热重载）
npm run build        # 构建并打包当前平台的安装包
npm run build:exe    # 只编译可执行文件，不打包
```

Rust 依赖默认从官方 crates.io 拉取。如果网络不理想，可复制
[`.cargo/config.toml.example`](./.cargo/config.toml.example) 为 `.cargo/config.toml`
并取消其中两行注释，切换到 rsproxy.cn 镜像（该文件已被 git 忽略）。

Windows 上如果 `cargo` 报找不到 `link.exe`，说明当前终端没有 MSVC 环境变量。
用仓库里的脚本自动定位 Visual Studio 并进入编译环境（通过 `vswhere` 探测，支持 Community / Professional / Enterprise 及任意版本与安装路径）：

```powershell
pwsh -File scripts/build.ps1
```

## 测试

```bash
npm test                                  # 前端：渲染测试（28 项检查）
cd src-tauri && cargo test                # 后端：OFD 解包单元测试（4 项）
```

前端 `test/render-test.mjs` 用 `jsdom` 加载 `ui/index.html` + `ui/app.js`，喂入一个脚本生成的合成 OFD 包，然后断言输出的 SVG：页面尺寸、模板线条、`DrawParam` 样式继承、逐字形定位、字体映射、图片 data URI 等。

后端 `src-tauri/src/ofd.rs` 的单元测试在内存里构造 ZIP 包，覆盖 deflate 解压、部件提取、资源转 data URI，以及缺少入口文件和非法文件的报错路径。

测试用的 fixture 由 [`test/fixtures/generate-synthetic-ofd.mjs`](./test/fixtures/generate-synthetic-ofd.mjs) **纯代码生成**：脚本自己拼装 XML、用内置的 PNG 编码器画印章和二维码占位图，再压缩成 ZIP。测试启动时会自动重新生成，因此磁盘上永远不存在过期的 fixture。

```bash
npm run fixture      # 只生成 fixture，并额外产出一个可拖进应用里试用的 demo-synthetic.ofd
```

### 为什么不提交真实文档

OFD 常用来承载电子发票、行程单等票据，这类文件里包含**旅客姓名、证件号、票号、纳税人识别号、印章图案和数字签名**。把真实文档提交进公开仓库等于泄露个人信息，因此：

- `*.ofd` 与 `test/fixtures/ofd/` 都在 [`.gitignore`](./.gitignore) 中
- 仓库里所有样例数据都是脚本生成的占位值
- 想用真实文档做测试，请放在本地（已被忽略），不要提交

## 项目结构

```
├── ui/                     # 前端（无构建步骤的静态页面）
│   ├── index.html
│   ├── app.js              # OFD 解析 + SVG 渲染
│   └── styles.css          # 布局、缩放与打印样式
├── src-tauri/
│   ├── src/main.rs         # Tauri 命令注册
│   ├── src/ofd.rs          # ZIP 解包、资源提取、base64 转 data URI
│   ├── capabilities/       # 窗口权限（core + dialog）
│   ├── icons/              # 各平台图标
│   └── tauri.conf.json     # 窗口、CSP、打包配置
├── test/
│   ├── render-test.mjs     # jsdom 端到端渲染测试
│   └── fixtures/           # 合成 fixture 生成器
├── .cargo/
│   └── config.toml.example # 可选的 crates.io 镜像模板（复制为 config.toml 启用）
└── scripts/
    ├── build.ps1           # Windows MSVC 环境自动配置
    └── bump-version.mjs    # 发版：同步版本号 + 提交 + 打 tag
```

## 已知限制

- **不验证数字签名**：`Signatures/` 只被解包，不做 SM2/SM3 校验，也无法判断文档是否被篡改
- **不渲染注释外观**：`Annotations/` 中的图章、批注不绘制
- **不使用内嵌字体**：包内 `.ttf/.otf` 会被提取但不会注册为 `@font-face`，中文依赖系统字体，字形可能与出票系统略有差异
- **不支持加密 / 压缩方式特殊的文档**：需要口令的 OFD 无法打开
- **无文本层交互**：不支持文本选择、复制、搜索、大纲跳转
- **大文件占用内存较高**：整个文件会以 base64 通过 IPC 传给前端，超大文档请留意内存
- `tiff` / `webp` 图片依赖 WebView 支持，个别环境下可能无法显示

## 常见问题

- **重命名 / 移动项目文件夹后，`tauri build` 突然报 `failed to read plugin permissions`
  或找不到 `target\release\build\...\out\permissions\...`**
  Cargo 的增量编译缓存里记录了绝对路径，旧路径失效后构建脚本就读不到了。清掉 release
  缓存重新构建即可：

  ```bash
  cd src-tauri && cargo clean --release
  ```

- **Windows 上提示找不到 `link.exe`**
  当前终端没有 MSVC 环境变量，用 `pwsh -File scripts/build.ps1`。

## 发布新版本

发版只需要一条命令：

```bash
npm run bump -- 0.2.0
```

[`scripts/bump-version.mjs`](./scripts/bump-version.mjs) 会把版本号同步进 `src-tauri/tauri.conf.json`（权威来源）、`package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock`，然后提交并打上 `v0.2.0` tag。推送后 Release workflow 会自动构建并公开发布：

```bash
git push origin main v0.2.0
```

> ⚠️ 为什么是"先提交再打 tag"：`tauri-action` 用 `tagName: v__VERSION__` 从 `tauri.conf.json` 读版本号。如果标签打在版本号改动之前，它会解析出**旧**版本，找到上一个 release，然后把新构建的产物覆盖上去。

脚本会在这些情况下拒绝执行：版本号格式非法 / 没有递增、同名 tag 已存在、tracked 文件有未提交的改动。

## 贡献

欢迎提交 Issue 和 PR，详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证

[MIT](./LICENSE)

---

## English

**OFD Reader** is a small desktop reader for OFD (GB/T 33190) fixed-layout
documents, built with Tauri 2 and Rust. The Rust backend unzips the package and
extracts XML parts plus image resources; the webview renders each page to SVG.

- Open via dialog, `Ctrl+O`, or drag & drop
- Object support: text (per-glyph positioning), paths, images, composites
- Resolves `PublicRes` / `DocumentRes`: font mapping, `DrawParam` inheritance,
  `MultiMedia` assets, `BaseLoc`-relative paths
- Multi-page rendering, zoom 20%–400%, printing

```bash
npm install && npm run dev     # develop
npm run build                  # bundle installers for the host platform
npm test                       # jsdom render tests (28 assertions)
```

Test fixtures are **generated entirely in code** by
[`test/fixtures/generate-synthetic-ofd.mjs`](./test/fixtures/generate-synthetic-ofd.mjs)
- no real invoice is ever committed, because OFD files commonly embed passenger
names, ID numbers, seals and signatures.

Licensed under the [MIT License](./LICENSE).

Releases: `npm run bump -- 0.2.0` syncs the version across the manifests, commits
it and creates the tag; pushing the tag publishes the GitHub release
automatically.
