## ADDED Requirements

### Requirement: Monorepo workspace structure

系统 SHALL 使用 pnpm workspace 组织 monorepo，允许在 `packages/*` 下管理多个包。

#### Scenario: Workspace discovery

- **WHEN** 用户在根目录执行 `pnpm install`
- **THEN** pnpm SHALL 安装根依赖并链接 workspace 内的所有包

#### Scenario: Package isolation

- **WHEN** 用户在 `packages/core` 下执行 `pnpm build`
- **THEN** 该命令 SHALL 仅作用于 `@browser-auto/core` 包，不影响其他包

### Requirement: TypeScript strict mode compilation

系统 SHALL 配置 TypeScript 使用 `strict: true`，所有 workspace 包继承共享的 `tsconfig.base.json`。

#### Scenario: Type checking passes

- **WHEN** 用户在根目录或任意包内执行 `tsc --noEmit`
- **THEN** 编译 SHALL 在无类型错误的情况下通过

#### Scenario: Strict enforcement

- **WHEN** 开发者在源码中编写隐式 `any` 类型（如未标注参数的函数）
- **THEN** TypeScript SHALL 报错并阻止编译通过

### Requirement: ESLint flat config with TypeScript support

系统 SHALL 使用 ESLint flat config 配置代码检查，支持 TypeScript 文件（`.ts`）。

#### Scenario: Lint TypeScript files

- **WHEN** 用户在根目录执行 `eslint packages/core/src`
- **THEN** ESLint SHALL 检查所有 `.ts` 文件并报告代码风格及潜在问题

#### Scenario: No legacy config files

- **WHEN** 检查项目根目录
- **THEN** 不存在 `.eslintrc.json`、`.eslintrc.js` 等 legacy 配置文件

### Requirement: Prettier code formatting

系统 SHALL 配置 Prettier 用于代码格式化，并与 ESLint 不冲突。

#### Scenario: Format source files

- **WHEN** 用户在根目录执行 `prettier --write .`
- **THEN** 所有支持的源文件 SHALL 被格式化为统一风格

### Requirement: Core package build output

`@browser-auto/core` 包 SHALL 能够通过 `tsc` 编译输出 ESM JavaScript 和类型声明文件到 `dist/` 目录。

#### Scenario: Build produces correct artifacts

- **WHEN** 用户在 `packages/core` 下执行 `pnpm build`
- **THEN** `dist/index.js` 和 `dist/index.d.ts` SHALL 被生成

#### Scenario: Package exports resolve correctly

- **WHEN** 外部项目导入 `@browser-auto/core`
- **THEN** Node SHALL 根据 `exports` 字段正确解析到 `dist/index.js` 和类型声明
