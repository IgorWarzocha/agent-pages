# Artifact system for agents

Read this when changing how Agent Pages discovers, loads, names, deletes, or displays artifacts.

Do not read this just to create a normal artifact. Use the installed `agent-pages` skill for that.

## Current design

Normal user artifacts live in:

```text
src/pages
```

Each artifact is one TSX file:

```text
<group-slug>__<artifact-name>.tsx
```

The group slug links the artifact to a project/session group. The artifact name becomes the sidebar row label.

## Owning files

- `src/artifacts/registry.ts`: Vite glob discovery and TSX lazy loader.
- `src/session-index/pages.ts`: filesystem indexer for `src/pages`.
- `vite.config.ts`: delete endpoint and `/api/agent-pages` discovery endpoint.
- `src/app/App.tsx`: selected page state and lazy rendering.
- `src/features/sidebar/Sidebar.tsx`: artifact rows and delete action.

## Change recipes

### Change filename convention

Edit both:

- `src/artifacts/registry.ts` for browser-side discovery metadata.
- `src/session-index/pages.ts` for generated sidebar index metadata.

Also decide with the user whether old filenames should keep working. This repo does not preserve backwards compatibility unless the user asks for it.

Update the skill and docs if agents need to create files differently.

### Change where artifacts are stored

Edit:

- `vite.config.ts` so `/api/agent-pages` returns the new directory.
- `src/artifacts/registry.ts` so Vite imports from the new directory.
- `src/session-index/pages.ts` or index config so the indexer scans the new directory.

Do not hardcode a user's home path.

Also update the delete endpoint guard in `vite.config.ts`. It is intentionally constrained to artifact TSX files under the artifact directory. If the directory changes, keep the same safety properties:

- resolve the requested file against the configured artifact directory
- reject path traversal
- reject non-TSX files
- never delete outside the artifact directory

### Add artifact delete behaviour

The delete endpoint is intentionally constrained to TSX files under the artifact directory. Keep that path traversal guard intact.

### Add dependency for an artifact

This is a repo customisation. Ask the user first, then follow `docs/dependencies.md`.
