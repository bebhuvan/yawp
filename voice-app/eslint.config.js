import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const vitestGlobals = {
  afterEach: "readonly",
  beforeEach: "readonly",
  describe: "readonly",
  expect: "readonly",
  it: "readonly",
  test: "readonly",
  vi: "readonly",
};

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "src-tauri/target/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
  },
  {
    files: ["*.config.ts", "vite.config.ts", "playwright.config.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["src/**/*.test.{ts,tsx}", "src/test/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...vitestGlobals,
      },
    },
  },
];
