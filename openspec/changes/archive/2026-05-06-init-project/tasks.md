## 1. 根目录基础配置

- [x] 1.1 创建根目录 `package.json`，声明 workspace 根（`private: true`）并预留 `lint`、`format` 脚本
- [x] 1.2 创建 `pnpm-workspace.yaml`，配置 `packages/*` 为 workspace
- [x] 1.3 创建 `.gitignore`，排除 `node_modules/`、`dist/`、`*.log` 等
- [x] 1.4 创建 `tsconfig.base.json`，启用 `strict: true`，配置 ESM 模块输出（`module: "NodeNext"`, `moduleResolution: "NodeNext"`）

## 2. 代码规范工具配置

- [x] 2.1 安装 ESLint 相关依赖（`eslint`、`@eslint/js`、`typescript-eslint`），创建 `eslint.config.js`（flat config）
- [x] 2.2 安装 Prettier（`prettier`），创建 `prettier.config.js`
- [x] 2.3 在根目录 `package.json` 中补充 `lint`、`format` 脚本，确保命令可正常执行

## 3. 创建 @browser-auto/core 包

- [x] 3.1 创建 `packages/core/package.json`，声明 `name: "@browser-auto/core"`、`type: "module"`、构建脚本和 `exports` 字段
- [x] 3.2 创建 `packages/core/tsconfig.json`，继承 `../../tsconfig.base.json`，配置 `outDir: "dist"`、`rootDir: "src"`
- [x] 3.3 创建 `packages/core/src/index.ts`，编写一个带类型的简单导出函数作为占位入口
- [x] 3.4 验证：`pnpm install` 成功安装依赖，`pnpm build`（在 core 包内）成功输出 `dist/index.js` 和 `dist/index.d.ts`
