# UI customisation for agents

Read this when changing the Agent Pages shell: sidebar, landing page, theme, layout, filters, or app chrome.

Do not use this for artifact styling. Artifact CSS stays inside the artifact TSX file.

## Owning files

- `src/app/App.tsx`: app state, selected group/page, landing page, theme state, sidebar hidden state.
- `src/style.css`: shell CSS only. Tokens, layout, sidebar, landing page, generic shell affordances.
- `src/features/sidebar/Sidebar.tsx`: sidebar rendering and interactions.
- `src/features/sidebar/agents.ts`: provider metadata and logo paths.
- `src/features/sidebar/filter.ts`: filter/search/orphan logic.
- `public/agent-logos/*`: provider logo assets.

## Change recipes

### Change the landing page

Edit the `Landing` component in `src/app/App.tsx` and related landing classes in `src/style.css`.

### Change sidebar layout or controls

Edit `src/features/sidebar/Sidebar.tsx` and sidebar classes in `src/style.css`.

Keep app-level state in `App.tsx`; keep sidebar rendering/filter interaction in `src/features/sidebar/`.

### Change provider icons

Edit `src/features/sidebar/agents.ts` and assets in `public/agent-logos/`.

Use `import.meta.env.BASE_URL` for public asset paths so the app still works when served from a subpath.

### Change theme

Edit CSS variables in `src/style.css`.

Artifacts should use variables for ordinary pages:

- `--paper`
- `--panel`
- `--panel-deep`
- `--ink`
- `--muted`
- `--dim`
- `--line`
- `--line-soft`
- `--accent`
- `--link`
- `--success`
- `--warning`
- `--error`

### Add artifact-specific styles

Do not edit `src/style.css`. Put those styles inside the artifact TSX file.
