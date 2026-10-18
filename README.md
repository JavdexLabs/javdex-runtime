# Javdex Runtime

Javdex 的原生运行库与辅助工具发行仓库。统一维护构建配方、固定来源、发布清单和下载附件，让 Javdex 按需安装所需运行库，不必把所有可选能力放进主安装包。

首期目标是 Windows x64 的 Whisper Vulkan 语音运行库。后续可纳入其他引擎、平台、计算后端和原生辅助工具；每种运行库独立发布，不与 Javdex 应用版本绑定。

首期构建实现已加入，公开运行库以本仓库 Releases 的实际状态为准。发布前执行原生 Windows CLI 与固定 Kotoba/VAD 的 CPU 兼容烟测；普通托管 runner 不提供真实 Vulkan GPU 推理证明。

- [设计方案](docs/design.md)：职责、目录、版本、包格式、CI 和 Javdex 接入步骤。
- [领域术语](CONTEXT.md)：运行库、运行库变体、运行库发行和消费锁定。
- [协作约定](AGENTS.md)：实现和发布时必须保留的约束。

## 使用原则

- 只使用明确版本的发行附件，不让客户端跟随 `latest` 或分支上的动态清单自动更新。
- 每个附件记录实际大小、SHA-256、源码提交、构建配方和许可来源。
- 只在用户准备相应能力时安装；不改模型权重、翻译设置或显卡选择策略。
- 不覆盖已经发布的文件、标签或版本；修复构建时发布新的运行库修订。
- 不托管用户资料、模型权重、显卡驱动或任意可执行安装脚本。

本仓库的运行库供应与 Javdex 的应用发布相互独立。已经发布的 Javdex 0.9.0 不会因本仓库发布而自动改变；客户端接入与应用重新发布在 Javdex 仓库中单独控制。

## 构建与发布

使用 Node.js 22.15 或更新版本。构建脚本没有第三方 npm 依赖，仓库自有代码沿用 GPL-3.0-or-later，第三方材料保留各自许可。

- 任意支持平台：`npm test`。
- Windows x64 与 Visual Studio C++ 工具：`npm run build:whisper`。
- 原生兼容检查：`node scripts/smoke.mjs`，会取得固定测试模型，但不将模型打包。
- CI 打包：`npm run package:whisper`，要求实际 CI 源码与 run 身份。
- 手动触发 `Build and publish Whisper Vulkan`；`publish=false` 只构建，`publish=true` 在检查通过后准备 Draft。同名已有 Release 或标签一律拒绝。
- 全部 CI 成功后，由维护者用已有 `gh` 登录执行 `node scripts/finalize.mjs <完整源码 SHA> <实际 run ID>`；脚本确认不可变设置、CI、Draft 来源与附件身份后才公开。CI 不持有管理权限 PAT，也不绕过不可变门禁。
