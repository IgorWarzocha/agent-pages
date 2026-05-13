# Agent Dashboard Architecture

## Core invariant
Agents add rich task artifacts by creating exactly one page file in `src/pages` named:

```text
<group-slug>__<artifact-name>.tsx
```

The rest of the app should make that page discoverable without requiring agents to edit routing, sidebar logic, or session import code.

## Ownership map

- `src/pages/*.tsx` — agent-authored artifacts only.
- `src/artifacts/registry.ts` — page discovery and filename metadata.
- `src/domain/path.ts` — cwd, project-name, path-display, and group-slug transforms.
- `src/domain/session.ts` — shared session/project/artifact types.
- `src/features/sidebar/*` — agent filter, search, group list, and sidebar rendering.
- `src/session-index/*` — pi/codex/opencode session importers and index assembly.
- `scripts/index-sessions.mjs` — tiny Node CLI wrapper around `src/session-index/indexer.ts`.
- `public/session-index.json` — generated data; do not hand-edit.

## Hard boundaries

- Do not add session storage parsing to `src/app/App.tsx` or sidebar components.
- Do not add artifact route registration by hand. Filename convention is the extension point.
- Do not pass positional session data through UI code. Use named `SessionRecord` / `ProjectGroup` objects.
- Validate new external agent stores inside `src/session-index`, not in the React app.

## Checks

```bash
bun run check
```

Runs session indexing, deterministic tests, typecheck, and Vite build.
