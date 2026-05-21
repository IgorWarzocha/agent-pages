# Change map for agents

Use this file only when the user asks to customise or extend Agent Pages itself.

Do not use these docs for normal artifact creation. Normal artifacts are one TSX file in the discovered `pagesDir` and should not require app changes.

## Before changing code

1. Identify the kind of change below.
2. Read the linked doc before editing.
3. Keep the change in the owning folder.
4. If an artifact needs a missing dependency, ask the user before changing the repo.
5. Use the verify column for the smallest relevant check.
6. For app code changes, run `bun run check` before reporting done.

## What can be customised, and where

| User asks for | Read | Edit | Verify |
| --- | --- | --- | --- |
| Change artifact filename/grouping/discovery | `docs/artifacts.md` | `src/artifacts/registry.ts`, `src/session-index/pages.ts`, maybe `vite.config.ts` | `bun run index`, then `bun run check` |
| Change where artifacts are stored | `docs/artifacts.md` | `vite.config.ts`, `src/artifacts/registry.ts`, `src/session-index/pages.ts` | `curl -s http://127.0.0.1:47983/api/agent-pages`, `bun run index`, `bun run check` |
| Add a new session/source importer | `docs/sessions.md` | `src/session-index/*`, `src/session-index/indexer.ts`, `scripts/index-sessions.mjs`; maybe `src/features/sidebar/agents.ts` and `public/agent-logos/*` | `bun run index`, then `bun run check` |
| Change sidebar filters/search/project rows | `docs/ui.md` | `src/features/sidebar/*`, maybe `src/style.css` | `bun run check`; visually check sidebar states |
| Change landing page or app-level state | `docs/ui.md` | `src/app/App.tsx`, `src/style.css` | `bun run check`; visually check landing page |
| Change shell theme/tokens/layout | `docs/ui.md` | `src/style.css` | `bun run check`; visually check dark and light mode |
| Add a library for future artifacts | `docs/dependencies.md` | `package.json`, `bun.lock`, `.agents/agent-pages/SKILL.md`, `README.md` if user-facing | `bun run check` |
| Change local dev API endpoints | `docs/architecture.md` | `vite.config.ts` | endpoint-specific `curl`, then `bun run check` |
| Change domain/path/session types | `docs/architecture.md` | `src/domain/*`, tests | targeted tests if added/changed, then `bun run check` |

## Boundaries

- Do not put artifact CSS in `src/style.css`.
- Do not add route registration for artifacts; discovery is filename/glob based.
- Do not parse agent session stores inside React components.
- Do not commit `public/session-index.json`.
