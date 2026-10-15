# 贡献指南

感谢你愿意改进 OFD Reader。这个项目很小，改动请尽量保持集中。

## 开发环境

```bash
npm install
npm run dev        # 开发模式，前端改动热重载
```

Rust 侧 1.88+，Node 侧 22.22.2+。Windows 上如果 `cargo` 找不到 `link.exe`，
用 `pwsh -File scripts/build.ps1` 自动进入 MSVC 编译环境。

### Cargo 镜像（可选）

仓库默认使用官方 crates.io。如果到 crates.io 的速度不理想，把
[`.cargo/config.toml.example`](./.cargo/config.toml.example) 复制成 `.cargo/config.toml`
并取消开头两行的注释即可启用 rsproxy.cn 镜像——该文件已被 `.gitignore` 忽略，
属于个人环境配置，不会被提交。

## 提交前必须通过

```bash
npm test                                            # 渲染测试
cd src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
```

CI 会在 Windows / macOS / Linux 三个平台跑一遍编译，所以请确保改动不依赖单一平台。

## 代码风格

- **Rust**：`rustfmt` 默认配置，`clippy` 不允许 warning
- **前端**：不引入构建步骤，`ui/` 下的三个文件直接由 WebView 加载；保持无依赖原生的写法
- 只在需要解释"为什么"的地方写注释，不要解释"做了什么"
- 面向用户的提示文案统一用中文

## 修改渲染逻辑时

`ui/app.js` 的渲染路径全部由 `test/render-test.mjs` 覆盖。渲染行为一旦变化：

1. 更新 `test/fixtures/generate-synthetic-ofd.mjs`，让 fixture 包含需要的新结构
2. 在 `test/render-test.mjs` 中增加或修正对应断言
3. 如果属于"已知限制"的解除，请同步更新 README 的对应条目

## 关于样例文档（重要）

**不要提交真实的 OFD 文档。** OFD 常用来承载电子发票和行程单，这类文件包含
旅客姓名、证件号、票号、纳税人识别号、印章图案和数字签名——提交进公开仓库就是
泄露个人信息。

- 测试样例请通过 `test/fixtures/generate-synthetic-ofd.mjs` 生成
- `*.ofd` 和 `test/fixtures/ofd/` 已在 `.gitignore` 中，请勿用 `git add -f` 强行加入
- 自己调试用的真实文档放在本地即可，不要放进仓库

## 分支与提交

- 从 `main` 切分支，命名建议 `fix/xxx`、`feat/xxx`、`docs/xxx`
- 提交信息用英文的祈使句，例如 `fix: keep CTM scale for image objects`
- 一个 PR 只做一件事；大改动请先开 Issue 讨论

## 许可证

你的贡献将以 [MIT](./LICENSE) 许可证发布。
