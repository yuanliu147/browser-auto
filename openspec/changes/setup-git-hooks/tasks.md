## 1. 安装依赖

- [x] 1.1 安装 husky、lint-staged、@commitlint/cli、@commitlint/config-conventional 到根目录 devDependencies
- [x] 1.2 在根目录 `package.json` 中添加 `prepare` 脚本：`"prepare": "husky"`

## 2. 配置 husky hooks

- [x] 2.1 初始化 husky（执行 `pnpm prepare` 或 `npx husky init`），生成 `.husky/` 目录
- [x] 2.2 创建 `.husky/pre-commit`，内容调用 `lint-staged`
- [x] 2.3 创建 `.husky/commit-msg`，内容调用 `commitlint --edit $1`

## 3. 配置 lint-staged

- [x] 3.1 创建 `lint-staged.config.js`，对 `.ts`、`.js`、`.json`、`.md` 执行 `prettier --write` 和 `eslint --fix`
- [x] 3.2 在 lint-staged 中为 `packages/*/src/**/*` 添加 `tsc --noEmit`，通过 `cd` 到对应包执行
- [x] 3.3 配置排除路径：`openspec/changes/archive/**`、`dist/`、`node_modules/`、`pnpm-lock.yaml`

## 4. 配置 commitlint

- [x] 4.1 创建 `commitlint.config.js`，使用 `@commitlint/config-conventional`，限制为单行（不强制 body）

## 5. 验证

- [x] 5.1 验证 `pnpm install` 后 `.husky/` 下的 hooks 存在且可执行
- [x] 5.2 验证提交一个格式错误的文件时，pre-commit hook 能自动修复或报错阻断
- [x] 5.3 验证提交信息不规范时（如 `git commit -m "bad msg"`），commit-msg hook 报错阻断
- [x] 5.4 验证提交信息规范时（如 `git commit -m "feat(core): add helper"`），提交成功
