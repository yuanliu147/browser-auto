## ADDED Requirements

### Requirement: Pre-commit hook runs lint-staged

系统 SHALL 在 `git commit` 前通过 husky 的 `pre-commit` hook 触发 lint-staged，对暂存文件执行格式化与检查。

#### Scenario: Staged files are formatted and linted

- **WHEN** 开发者执行 `git commit` 且暂存区包含 `.ts` 文件
- **THEN** lint-staged SHALL 依次执行 prettier write、eslint fix、以及 `tsc --noEmit`

#### Scenario: Unstaged files are ignored

- **WHEN** 开发者暂存了部分文件，工作区仍有未暂存的修改
- **THEN** lint-staged SHALL 仅检查暂存文件，不影响未暂存文件

### Requirement: Commit message follows Conventional Commits

系统 SHALL 在 `git commit` 时通过 husky 的 `commit-msg` hook 校验提交信息是否符合 Conventional Commits 规范。

#### Scenario: Valid commit message passes

- **WHEN** 开发者执行 `git commit -m "feat(core): add new helper"`
- **THEN** commitlint SHALL 校验通过，提交继续执行

#### Scenario: Invalid commit message is rejected

- **WHEN** 开发者执行 `git commit -m "add new helper"`（缺少 type 前缀）
- **THEN** commitlint SHALL 报错并中断提交

### Requirement: Hooks auto-enable on install

系统 SHALL 确保新克隆仓库或运行 `pnpm install` 后，husky hooks 自动安装并生效。

#### Scenario: Fresh clone works out of the box

- **WHEN** 新开发者克隆仓库并运行 `pnpm install`
- **THEN** `.husky/pre-commit` 和 `.husky/commit-msg` SHALL 已存在并可执行

### Requirement: Excluded paths are skipped

lint-staged 和 commitlint SHALL 不对归档文件、构建产物等路径执行检查。

#### Scenario: Archive files are ignored

- **WHEN** 开发者修改了 `openspec/changes/archive/` 下的文件并尝试提交
- **THEN** lint-staged SHALL 跳过这些文件，不执行 prettier/eslint/tsc
