## Why

项目 `browser-auto` 需要一个现代化的 TypeScript 工具库基础架构。当前仓库为空，缺乏构建、代码规范、类型检查等基础设施，无法开始功能开发。

## What Changes

- 初始化 pnpm monorepo workspace 结构
- 配置根级共享工具链：TypeScript（strict 模式）、ESLint（flat config）、Prettier
- 创建首个包 `@browser-auto/core`（`packages/core`），ESM only，输出到 `dist/`
- 配置包的 `exports` 字段和构建脚本
- 添加 `.gitignore`、LICENSE 等基础文件

## Capabilities

### New Capabilities

- `project-setup`: 项目初始化与基础工具链配置，涵盖 pnpm workspace、TypeScript、ESLint、Prettier 的搭建

### Modified Capabilities

- 无（本项目无既有 spec）

## Impact

- 根目录新增：`.gitignore`、`package.json`、`pnpm-workspace.yaml`、`eslint.config.js`、`prettier.config.js`、`tsconfig.base.json`
- 新增目录：`packages/core/` 及其 `package.json`、`tsconfig.json`、`src/index.ts`
- 无既有代码变更，零破坏性影响
