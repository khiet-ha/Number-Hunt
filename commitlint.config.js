// semantic-release derives versions from commit messages, so the format is
// enforced locally (husky commit-msg) and in CI (ci.yml › commits).
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "perf",
        "refactor",
        "docs",
        "style",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
        "hotfix",
        "release",
      ],
    ],
    "scope-enum": [
      2,
      "always",
      [
        "game",
        "multiplayer",
        "webrtc",
        "qr",
        "app",
        "ui",
        "config",
        "deps",
        "ci",
        "docs",
        "security",
      ],
    ],
  },
}
