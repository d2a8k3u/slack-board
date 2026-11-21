# Contributing

## Set up

You need Node.js 24 or newer.

```bash
git clone git@github.com:d2a8k3u/slack-board.git
cd slack-board
npm ci
```

The plugin runs without `npm ci`; the dev dependencies are only for the checks.

## Make a change

1. Create a branch from `main`.
2. Run `npm run fix` to format the code and apply safe lint fixes.
3. Run `npm run check` until it passes. It runs the type check, Biome and the tests, the same as CI.
4. Commit with [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description`.
5. Open a pull request.

## Update typoseek

The board serves its own copy of typoseek from `web/vendor/typoseek/`, so users need no install. After a typoseek release, run:

```bash
npm install --save-dev --save-exact typoseek@<version>
npm run vendor
```

Commit `package.json`, `package-lock.json` and `web/vendor/typoseek/` together. `npm run check` fails while the copy differs from the installed package.

## Code style

- TypeScript strict mode, run by Node directly with no build step. Only erasable syntax: no enums, namespaces or parameter properties.
- `web/` is plain JavaScript modules, served as they are.
- Biome enforces formatting: 2-space indent, 100-column lines, double quotes, semicolons, LF, organized imports. Lint warnings fail the check.
- Tests use `node:test` and `node:assert/strict` and sit next to the code as `*.test.ts` or `*.test.js`.
- No comments. Names and structure carry the meaning; rationale belongs in the commit message.
- No `any`. Use `unknown` and narrow it.
- No lint suppressions. Fix the cause.
- Never weaken a test to make a change pass; the tests define the contract.

## Report an issue

Open an issue with:

- what you expected and what happened
- steps to reproduce, without real Slack messages, Jira data or tokens
- Node.js version, Claude Code version and OS
