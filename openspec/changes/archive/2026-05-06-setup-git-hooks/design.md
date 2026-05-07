## Context

项目已完成初始化（pnpm monorepo + TypeScript + ESLint + Prettier），但 Git hooks 尚未配置。当前提交完全依赖开发者自觉，存在代码未格式化、Lint 错误、类型错误、提交信息不规范等风险。

## Goals / Non-Goals

**Goals:**

- 在 `git commit` 前自动格式化并检查暂存文件（prettier + eslint + tsc）
- 在 `git commit` 时校验提交信息是否符合 Conventional Commits 规范
- 配置排除路径，避免对归档文件、构建产物等执行无意义的检查
- 确保 `pnpm install` 后 hooks 自动生效（通过 `prepare` 脚本）

**Non-Goals:**

- 不配置 pre-push hook（不在 push 阶段做额外检查）
- 不引入 commitizen 等交互式提交工具
- 不修改既有代码规范配置（ESLint/Prettier/TS 规则不变）

## Decisions

| 决策                 | 选择                              | 备选                | 理由                                        |
| -------------------- | --------------------------------- | ------------------- | ------------------------------------------- |
| husky 版本           | v9                                | v8/v4               | v9 配置极简，无需 `.husky/_/husky.sh`       |
| lint-staged 配置格式 | `lint-staged.config.js`           | `package.json` 字段 | 独立文件更清晰，避免 package.json 膨胀      |
| tsc 检查方式         | `tsc --noEmit`                    | `tsc --build`       | `--noEmit` 不生成产物，适合 pre-commit 场景 |
| commitlint 规范      | `@commitlint/config-conventional` | 自定义规则          | 社区标准，无需维护自定义配置                |
| 提交信息 body        | 不要求                            | 强制要求            | 用户明确单行即可，降低门槛                  |

## Risks / Trade-offs

- **[Risk]** tsc --noEmit 在 monorepo 下可能较慢 → **Mitigation**: lint-staged 默认只检查暂存文件，tsc 通过 `cd` 到对应包执行，避免全量检查
- **[Risk]** 初次配置后，历史未规范提交可能导致 `git log` 风格不一致 → **Mitigation**: 仅影响新提交，历史不追溯
- **[Risk]** 若 ESLint/Prettier 规则较严，可能频繁阻断提交 → **Mitigation**: lint-staged 中 eslint 使用 `--fix`，prettier 使用 `--write`，自动修复可修复的问题
