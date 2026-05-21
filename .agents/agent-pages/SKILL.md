---
name: agent-pages
description: Create or update rich task/session artifacts in the local Agent Pages app. Use when the user asks for a visual proposal, options, prototype, diagram, report, review surface, or anything easier to judge/annotate than chat.
---

# Agent Pages

## Purpose
Agent Pages is a local hot-reloaded canvas for richer agent output. The user asks an agent to use this skill, the agent creates one TSX artifact, then the user reviews it in the app and uses React Grab to annotate/copy feedback back to the agent.

## Discovery first
Do not assume the repository path. First query the running app:

```bash
curl -s http://127.0.0.1:47983/api/agent-pages
```

Use the returned JSON:
- `pagesDir`: write artifacts here.
- `rootDir`: app root for `bun run index` if needed.
- `url`: local browser URL.
- `port`: fixed app port, `47983`.

If the server is not running, tell the user to start it from the cloned repo:

```bash
bun run dev
```

## Hard rules
- Only create or edit artifact files under the discovered `pagesDir` unless the user explicitly asks to change Agent Pages itself.
- Name files as `<group-slug>__<page-name>.tsx` so the sidebar groups them with the matching session/project.
- Prefer one self-contained TSX file. Put artifact-specific CSS inside that TSX file, either inline or in a local `<style>` tag. Do not edit `src/style.css` or other Agent Pages app files for artifact styling. The app CSS is only for the shell/sidebar/landing page.
- Respect the viewport. Use `minmax(0, 1fr)`, wrapping grids, `max-width: 100%`, and avoid horizontal page scrolling unless necessary. If wide content is necessary, put `overflow-x: auto` on that element only.
- When interactive, include a copy/export action: prompt, markdown, JSON, diff, or selected settings.
- React Grab is already loaded in dev. Design artifacts so the user can mark them up and paste feedback back into chat.
- After creating or updating an artifact, open Agent Pages in the user's browser at the returned `url` so they can review it immediately. If your environment cannot open a browser, say so and give the `url`.
- Installed artifact-friendly dependencies are available. Use them when they materially improve the artifact; do not add new dependencies unless the user asks:
  - `lucide-react`: icons and small visual affordances.
  - `react-markdown` + `remark-gfm`: render markdown briefs, reports, tables, and task lists.
  - `recharts`: charts, dashboards, comparisons, and simple data views.
  - `three`: self-contained 3D/WebGL sketches or spatial scenes.
  - `clsx`: conditional class names without noisy string concatenation.
  - `zod`: validate structured JSON/config before rendering it.
- Use Bun for package/script commands. The session indexer itself runs on normal Node.

## Group slug
Use this transformation for the current working directory:
1. Replace the home directory with `~`.
2. Replace non-alphanumeric path separators/symbols with `-`.
3. Trim leading/trailing dashes.

```bash
node -e "const os=require('os');const cwd=process.cwd();console.log(cwd.replace(os.homedir(),'~').replace(/[^a-zA-Z0-9._~-]+/g,'-').replace(/^-|-$/g,''))"
```

## Theme guidance
The shell has a light/dark toggle. For ordinary artifacts, use the app theme variables instead of hardcoded global palettes:

- `var(--paper)`: page background
- `var(--panel)`, `var(--panel-deep)`: cards and raised panels
- `var(--ink)`: primary text
- `var(--muted)`, `var(--dim)`: secondary text
- `var(--line)`, `var(--line-soft)`: borders
- `var(--accent)`, `var(--link)`: highlights and links
- `var(--success)`, `var(--warning)`, `var(--error)`: status colors

If the artifact is about UI, visual design, branding, or theming, override the app theme freely to show the proposed UI accurately.

## Workflow
1. Query `/api/agent-pages` and read `pagesDir`.
2. Decide whether a visual page helps. If plain chat is clearer, do not make one.
3. Pick a short page slug: `proposal`, `options`, `review`, `plan`.
4. Create `<pagesDir>/<group-slug>__<page-slug>.tsx`.
5. Export a default React component.
6. Make it immediately useful: concise headings, options, diagrams, annotated snippets, timelines, tables, or small interactions.
7. If grouping looks stale, run `bun run index` from `rootDir`.
8. Open `url` in the user's browser so they can review the artifact immediately. If browser opening is unavailable, give the `url` and tell the user to select the artifact, annotate with React Grab, and paste feedback back.

## Example only

An artifact is just a React file. Do not reuse this structure by default. It is only here to show the minimum shape: export one React component from one TSX file.

Pick the layout, styling, components, and interactions that fit the user's task. A comparison page, chart dashboard, 3D sketch, markdown report, review checklist, tiny editor, and UI mockup should not all look like the example below.

```tsx
export default function Proposal() {
  return (
    <main className="sheet">
      <p style={{ textTransform: 'uppercase', letterSpacing: '.14em', color: '#8abeb7' }}>current session</p>
      <h1 style={{ fontSize: 64, lineHeight: .95, letterSpacing: '-.07em', margin: '0 0 24px' }}>Clear proposal title</h1>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <article style={{ background: '#1e1e24', border: '1px solid #505050', borderRadius: 24, padding: 24 }}>
          <h2>Option A</h2>
          <p>Specific enough to decide.</p>
        </article>
      </section>
    </main>
  );
}
```

## Troubleshooting

If the dashboard is not visible or the discovery endpoint fails:

```bash
curl -s http://127.0.0.1:47983/api/agent-pages
```

- If curl fails, the app is not running. Tell the user to start Agent Pages using their chosen install method. This may be `bun run dev`, a shortcut, or a system service configured during installation.
- If curl succeeds, use the returned `url` and `pagesDir`; do not guess paths.

If the artifact was created but does not appear in the sidebar:

1. Confirm the file is under the returned `pagesDir`.
2. Confirm the filename is `<group-slug>__<page-name>.tsx`.
3. Refresh the index from the returned `rootDir`:

```bash
bun run index
```

If sessions/projects are missing, stale, or from the wrong machine, remember that `public/session-index.json` is generated local state. It is regenerated by `bun run dev` and can be refreshed manually with `bun run index`. It should not be treated as portable data.

## Validation
- For artifact-only changes, confirm the file exists in `pagesDir` and the app hot reloads.
- Do not run full app checks unless you changed Agent Pages code itself.
