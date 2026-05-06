export default {
  ignore: [
    "openspec/changes/archive/**",
    "dist/**",
    "node_modules/**",
    "pnpm-lock.yaml",
  ],
  "*.{ts,js,json,md}": "prettier --write",
  "*.{ts,js}": "eslint --fix",
  "packages/*/src/**/*": (files) => {
    const commands = [];
    const packages = new Set();
    for (const file of files) {
      const match = file.match(/^packages\/([^/]+)/);
      if (match) packages.add(match[1]);
    }
    for (const pkg of packages) {
      commands.push(`cd packages/${pkg} && tsc --noEmit`);
    }
    return commands;
  },
};
