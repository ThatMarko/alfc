import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import eslintReact from "@eslint-react/eslint-plugin";
import hooksPlugin from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import { includeIgnoreFile } from "@eslint/compat";
import path from "node:path";

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");
const gitignorePathFrontend = path.resolve(
  import.meta.dirname,
  "frontend",
  ".gitignore",
);
const gitignorePathServer = path.resolve(
  import.meta.dirname,
  "server",
  ".gitignore",
);

// Keep React's official Hooks diagnostics when the React plugin offers the same rule.
const duplicateHookRules = Object.fromEntries(
  Object.keys(
    eslintReact.configs["disable-conflict-eslint-plugin-react-hooks"].rules,
  ).map((rule) => [rule.replace("react-hooks/", "@eslint-react/"), "off"]),
);

export default defineConfig(
  includeIgnoreFile(gitignorePath),
  includeIgnoreFile(gitignorePathFrontend),
  includeIgnoreFile(gitignorePathServer),
  // QML JavaScript includes .pragma library and is checked by Qt, not ESLint.
  { ignores: ["plasmoid/package/contents/ui/*.js"] },

  // Base config for all files
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.mjs", "*.js"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  eslint.configs.recommended,
  tseslint.configs.recommended,

  // React plugins scoped to frontend only
  {
    files: ["frontend/**/*.{ts,tsx,js,jsx}"],
    extends: [
      eslintReact.configs["recommended-typescript"],
      hooksPlugin.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      ...duplicateHookRules,
      "@eslint-react/no-missing-component-display-name": "error",
      "@eslint-react/jsx-no-children-prop": "error",
      "@eslint-react/jsx-no-comment-textnodes": "error",
      "@eslint-react/dom-no-unknown-property": "error",
      "@eslint-react/dom-no-unsafe-target-blank": "error",
    },
  },

  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      "no-unreachable": "error",
      "require-await": "error",
    },
  },

  // Always last
  eslintPluginPrettierRecommended,
);
