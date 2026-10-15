export default {
  "**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}": "eslint --cache",
  "**/*.{ts,tsx,mts,cts}": () => "bun run type-check",
  "**/*.{json,css,md}": "prettier --write",
};
