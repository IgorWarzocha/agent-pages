# Architecture for agents

Read this when a customisation touches app structure, domain types, Vite endpoints, build settings, or cross-feature boundaries.

For normal artifact creation, do not use this file. Use the installed `agent-pages` skill and write one TSX artifact in the discovered `pagesDir`.

## Core invariant

Agents add normal user artifacts by creating exactly one page file in `src/pages` named:

```text
<group-slug>__<artifact-name>.tsx
```

The app must make that page discoverable without manual route edits, sidebar edits, or session importer edits.

## Owning areas

- `src/app/App.tsx`: app-level state, landing page, selected artifact, theme, sidebar visibility.
- `src/artifacts/registry.ts`: artifact glob discovery, filename parsing, lazy loading.
- `src/domain/path.ts`: cwd display, project name, group slug transforms.
- `src/domain/session.ts`: shared session/project/artifact types.
- `src/features/sidebar/*`: provider filter, search, group list, sidebar rendering.
- `src/session-index/*`: session importers and index assembly.
- `scripts/index-sessions.mjs`: Node CLI wrapper around the indexer.
- `vite.config.ts`: local dev API, artifact delete endpoint, Vite build config.
- `public/session-index.json`: generated local data; do not hand-edit or commit.

## Boundary rules

- Do not parse session storage in `src/app/App.tsx` or sidebar components.
- Do not hand-register artifact routes. Artifact discovery is filename/glob based.
- Do not pass positional session data through UI code. Use named `SessionRecord` / `ProjectGroup` objects.
- Keep importer-specific parsing inside `src/session-index/`.
- Keep artifact-specific CSS inside artifact TSX files, not `src/style.css`.

## Validation

For documentation-only changes, no build is needed.

For app code changes:

```bash
bun run check
```

This runs session indexing, tests, typecheck, and Vite build.
