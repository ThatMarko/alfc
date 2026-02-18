export default {
  "**/*.{js,jsx,ts,tsx}": "eslint --cache",
  "**/*.{ts,tsx}": () => "bun run type-check",
  "**/*.{json,css,md}": "prettier --write",
};
