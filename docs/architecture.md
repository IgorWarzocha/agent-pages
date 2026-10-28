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
- `vite.config.ts`: Vite composition and build config.
- `server/api.ts`: local HTTP API composition and shared store lifetime.
- `server/whiteboards.ts`: live board authority, bounded persistence scheduling and subscriptions.
- `server/whiteboard-database.ts`: SQLite transactions, deduplicated attachment blobs, checkpoints and legacy migration.
- `server/whiteboard-changes.ts`: checkpoint-to-current scene comparisons.
- `src/features/whiteboard/*`: scene validation, editor, browser sync and rendered previews.
- `server/mcp.ts`, `server/http-client.ts`, `scripts/mcp.ts`: MCP tools and their connection to the same HTTP authority.
- `server/mcp-http.ts`, `scripts/mcp-http.ts`, `agent-pages-mcp.service`: authenticated remote MCP bridge, independent of the app process and stdio transport.
- `server/change-feed.ts`, `server/mcp-events.ts`, `server/mcp-resources.ts`: local API invalidations, their transport to MCP serving entries and subscribable saved-content resources.
- `src/features/annotations/*`, `server/annotations.ts`, `server/annotations-api.ts`: in-place markup, durable batches and live viewers. See `docs/annotations.md`.
- `server/excalidraw-assets.ts`: local Excalidraw fonts in development and builds.
- `.agent-pages/boards`: private persisted whiteboard data, excluded from Git.
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
