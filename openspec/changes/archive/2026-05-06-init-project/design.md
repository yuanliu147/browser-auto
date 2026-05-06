## Context

项目 `browser-auto` 当前为空仓库，仅包含 `LICENSE` 和 `.git` 目录。需要搭建一套现代化的 TypeScript 工具库基础架构，以支持后续的功能开发。

## Goals / Non-Goals

**Goals:**

- 建立 pnpm monorepo workspace，支持未来多包扩展
- 配置 TypeScript（strict 模式），确保类型安全
- 配置 ESLint（flat config）+ Prettier，统一代码风格
- 创建首个包 `@browser-auto/core`，提供 ESM 产物和类型声明
- 确保 `pnpm install` 和 `pnpm build` 在根目录和包内均可正常工作

**Non-Goals:**

- 不配置测试框架（vitest/jest）
- 不使用 bundler（tsc 直出即可）
- 不发布到 npm（仅本地开发）
- 不配置 CI/CD、husky、lint-staged 等流程工具

## Decisions

| 决策         | 选择                             | 备选             | 理由                                   |
| ------------ | -------------------------------- | ---------------- | -------------------------------------- |
| 包管理器     | pnpm                             | npm/yarn         | 速度快、磁盘效率高、原生支持 workspace |
| 模块格式     | ESM only                         | ESM + CJS        | 新工具库无需兼容 CJS，减少复杂度       |
| ESLint 配置  | flat config (`eslint.config.js`) | `.eslintrc.json` | ESLint v9 推荐的新格式，更灵活         |
| TS 严格程度  | `strict: true`                   | `strict: false`  | 工具库需要强类型保证                   |
| 构建产物目录 | `dist/`                          | `lib/`           | 社区更通用，未来加 bundler 无需改路径  |
| 构建工具     | `tsc`                            | tsup/rollup      | 工具库源码直出即可，无需 bundler       |

## Risks / Trade-offs

- **[Risk]** `strict: true` 可能对初期开发造成类型阻力 → **Mitigation**: 这是工具库，类型安全是核心收益，初期投入值得
- **[Risk]** ESM only 可能导致某些旧版 Node 或 CJS 项目无法直接使用 → **Mitigation**: Node 12+ 已原生支持 ESM，工具库目标环境足够现代
- **[Risk]** flat config 生态插件适配可能不如 legacy 成熟 → **Mitigation**: `@eslint/js` 和 `typescript-eslint` 均已支持 flat config
