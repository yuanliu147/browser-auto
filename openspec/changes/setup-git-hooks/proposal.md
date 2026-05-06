## Why

项目初始化完成后，代码规范工具（ESLint、Prettier、TypeScript）已就位，但缺乏自动化 enforce 机制。开发者仍可能提交未格式化、未检查或提交信息不规范的代码，导致代码质量参差不齐、历史记录混乱。

## What Changes

- 安装并配置 **husky**：在 `.husky/` 下创建 `pre-commit` 和 `commit-msg` Git hooks
- 安装并配置 **lint-staged**：在 pre-commit 阶段对暂存文件自动执行 prettier write、eslint fix、以及 tsc --noEmit 类型检查
- 安装并配置 **commitlint**（`@commitlint/config-conventional`）：在 commit-msg 阶段校验提交信息是否符合 Conventional Commits 规范
- 排除 `openspec/changes/archive/`、`dist/`、`node_modules/` 等无需检查的路径

## Capabilities

### New Capabilities

- `git-hooks`: Git 提交前自动化检查，涵盖代码格式化、Lint、类型检查及提交信息规范校验

### Modified Capabilities

- 无（本项目无既有 spec 需要变更需求）

## Impact

- 根目录新增/修改：`package.json`（新增 devDependencies 和 `prepare` 脚本）、`.husky/pre-commit`、`.husky/commit-msg`、`lint-staged.config.js`、`commitlint.config.js`
- 无既有业务代码变更
- 零破坏性影响
