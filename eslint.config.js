import js from "@eslint/js"
import reactHooks from "eslint-plugin-react-hooks"
import globals from "globals"
import tseslint from "typescript-eslint"

// Layer boundaries (docs/design/01-architecture.md §1, docs/design/10-agent-rules.md):
// game ← multiplayer ← app ← ui, while webrtc and qr only see shared types.
// `typeOnly` targets may still be imported with `import type`.
const layer = (name, forbidden, typeOnly = []) => ({
  files: [`src/${name}/**/*.{ts,tsx}`],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["../*"],
            message: "Import across layers with the @/ alias.",
          },
          ...[...forbidden, ...typeOnly].map((target) => ({
            group: [`@/${target}`, `@/${target}/*`],
            message: `src/${name} must not depend on src/${target}.`,
            allowTypeImports: typeOnly.includes(target),
          })),
        ],
      },
    ],
  },
})

export default tseslint.config(
  {
    ignores: [
      "dist",
      "coverage",
      "test-results",
      "playwright-report",
      "public/sw.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/ui/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  layer("game", ["multiplayer", "webrtc", "qr", "app", "ui"]),
  layer("multiplayer", ["webrtc", "qr", "app", "ui"]),
  layer("webrtc", ["qr", "app", "ui"], ["game", "multiplayer"]),
  layer("qr", ["multiplayer", "webrtc", "app", "ui"]),
  layer("app", ["ui"]),
  {
    files: ["tests/**/*.ts", "e2e/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  }
)
