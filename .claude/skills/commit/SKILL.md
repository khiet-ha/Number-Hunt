---
name: commit
description: Review changes, split into semantic commits with meaningful messages. Never pushes unless asked.
user_invocable: true
---

# Commit Changes

Create well-structured git commits for `Number-Hunt` (Tìm Số — P2P WebRTC PWA, layered architecture: game → multiplayer → app → ui, plus webrtc/qr).

**THREE ABSOLUTE RULES**

1. **One commit = exactly one `type` + one `scope`.** Never mix semantically different changes.
2. **Never commit directly to `master` or `develop`.**
3. ⚠️ **Never `git push`, create a PR, or touch remote — unless the user explicitly allows it** (in this turn, or for the whole session). "Commit this" **does not** mean push.

---

## Step 0 — Safety Check (do this first)

```bash
git status --porcelain
git branch --show-current
git diff --stat
git diff --cached --stat
```

Stop and **ask the user** if you find any of these:

| Finding                                                                                                | Why Stop                                   |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| File appears to contain secrets (`.env`, `*.pem`, `*.key`, token/API key-like strings in diff)         | Commits are permanent, even after deletion |
| Build/temp files (`dist/`, `coverage/`, `node_modules/`, `test-results/`, `*.log`, `.release-version`) | Should go to `.gitignore`, not commits     |
| File > 1 MB or unexplained binary files                                                                | Bloats repo permanently                    |
| Changes outside the scope of current work                                                              | May be accidental edits                    |
| Currently on `master` / `develop`                                                                      | See Step 1                                 |

Run `pnpm typecheck` before committing (and `pnpm test` when `src/` changed). **Don't commit if it fails** — fix first, unless the user says otherwise. No need to run them for pure `docs` / `chore(config)` commits.

If `src/multiplayer/` changed, also run `STRESS_SEEDS=100 pnpm exec vitest run tests/stress.test.ts` — the SafetyMonitor must report no divergence.

## Step 1 — Branch: Choose or Create

If on `master` or `develop`, or the current branch name doesn't match the work ⇒ **create a new branch**.

| Work Type         | Branch Prefix                                                     | Base          |
| ----------------- | ----------------------------------------------------------------- | ------------- |
| Production hotfix | `hotfix/`                                                         | **`master`**  |
| Everything else   | `feat/` `fix/` `refactor/` `perf/` `docs/` `test/` `chore/` `ci/` | **`develop`** |

⚠️ Prefix **must** be in the list above — `pr-auto.yml` only runs on these prefixes. Wrong prefix = no auto PR, no CI.

Name: `<prefix>/<scope>-<short-kebab-description>` — lowercase, kebab-case, ≤ 50 characters.
Examples: `feat/game-time-attack-mode` · `fix/multiplayer-stale-vote` · `chore/config-eslint-rules` · `hotfix/qr-offer-too-large`

Always branch from an updated base:

```bash
git fetch origin
git switch -c feat/game-time-attack-mode origin/develop
```

Uncommitted changes on the wrong branch: `git stash` → create branch → `git stash pop`.
**State the branch name, base and reasoning to the user** before creating it.

## Step 2 — Analyze and Group Changes

Read the **full** `git diff`, not just filenames.

- **type** (`commitlint.config.js`): `feat` `fix` `perf` `refactor` `docs` `style` `test` `build` `ci` `chore` `revert` `hotfix` `release`
- **scope**: `game` `multiplayer` `webrtc` `qr` `app` `ui` `config` `deps` `ci` `docs` `security`

Scope follows the directory: `src/game` → `game`, `src/multiplayer` → `multiplayer`, `src/webrtc` → `webrtc`, `src/qr` → `qr`, `src/app` → `app`, `src/ui` + `src/main.tsx` + `index.html` + `public/` → `ui`, tooling/config files → `config`, `.github/` + `scripts/` → `ci`, `docs/` + `README.md` + `CLAUDE.md` → `docs`. Tests take the scope of the code they test (`test(multiplayer)`), e2e → `test(ui)`.

Never put into the same commit: two `type`s, two `scope`s, or two purposes within one layer.

### Commit order — follow dependencies

`chore(config)` / `chore(deps)` → `refactor` → `feat`/`fix` from lower layers up (`game` → `multiplayer` → `webrtc`/`qr` → `app` → `ui`) → `style` → `test` → `docs`.

Each commit **must leave the repo in a working state** (typecheck passes). A refactor that a feature needs is committed **first**, separately.

A feature spanning layers is several commits with the same type, one per layer, e.g.:

```
feat(game): add time-attack mode — reducer + config
feat(multiplayer): add time-attack mode — round timer entry
feat(ui): add time-attack mode — settings + hud
test(game): cover time-attack scoring
```

## Step 3 — Write Messages

```
<type>(<scope>): <description>

<body — optional, explain WHY>

Refs: docs/design/<file>.md §<section>
```

- Lowercase subject, no period, ≤ 72 characters (hard cap 100); body lines ≤ 100.
- Explain **why**, not what.
- `BREAKING CHANGE:` in the body when compatibility breaks (e.g. wire protocol) — semantic-release bumps major.
- `Refs:` pointing to the design doc when implementing from it.
- End with the co-author trailer of the model actually doing the work, e.g. `Co-Authored-By: Claude <noreply@anthropic.com>`.

husky `commit-msg` runs commitlint — malformed messages are rejected.

## Step 4 — Execute

```bash
# ❌ NEVER
git add -A
git add .

# ✅ stage explicitly per semantic group
git add src/game/reducer.ts tests/game.test.ts   # only if same type+scope
git commit -F - <<'EOF'
feat(game): ...
EOF
```

husky `pre-commit` runs lint-staged (eslint --fix, prettier). If it modifies files, check `git status` and re-stage.

## Step 5 — Verify and Report

```bash
git log --oneline -n <number of commits just made>
git status
```

Confirm each commit has one type + one scope, the working tree is clean, no stray files. Report the **branch** (and base) and the **list of commits**. If pushing is not allowed, end with:

> Not yet pushed. Tell me if you want me to push.

## When pushing is allowed

```bash
git push -u origin <branch>
```

`pr-auto.yml` opens the PR to the right base (`master` for `hotfix/*`, `develop` otherwise) and keeps its description in sync. **Don't create PRs yourself** — it would duplicate. Release PRs (`develop → master`) are opened via the `Release PR` workflow.
