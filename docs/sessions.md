# Session indexing for agents

Read this when changing how Agent Pages finds projects/sessions for the sidebar.

## Current design

`public/session-index.json` is generated local state. It is produced by:

```bash
bun run index
```

`bun run dev` runs the indexer before Vite starts.

## Owning files

- `scripts/index-sessions.mjs`: CLI wrapper and default local paths.
- `src/session-index/indexer.ts`: orchestrates all importers.
- `src/session-index/common.ts`: shared JSON helpers, grouping, base session shape.
- `src/session-index/jsonl.ts`: generic JSONL session reader.
- `src/session-index/claude.ts`: Claude project JSONL importer.
- `src/session-index/opencode.ts`: opencode SQLite importer.
- `src/session-index/pages.ts`: artifact file indexer.
- `src/domain/session.ts`: shared types consumed by React.
- `src/domain/path.ts`: group slug, project name, display path helpers.
- `src/features/sidebar/agents.ts`: provider labels, filter options, logo paths.
- `public/agent-logos/*`: provider logos.

## Change recipes

### Add a new agent/session source

1. Add a new importer in `src/session-index/`.
2. Return `SessionRecord[]` using the shared domain type.
3. Add the importer to `collectSessions` in `src/session-index/indexer.ts`.
4. If the source introduces a new provider kind, update provider metadata in `src/features/sidebar/agents.ts` and add a logo under `public/agent-logos/` if available.
5. Add or update tests for path/grouping/provider behaviour if needed.
6. Keep parsing out of React components.

### Change grouping

Edit path/group helpers in `src/domain/path.ts` and grouping in `src/session-index/common.ts`.

Run tests after changing grouping. Existing artifacts depend on stable group slugs unless the user explicitly wants a breaking change.

### Missing/stale sessions

Do not hand-edit `public/session-index.json`. Regenerate it:

```bash
bun run index
```
