# Agent Pages

Agent Pages is a small local app for the parts of agent work that do not belong in chat.

Ask your agent for an artifact when you want to compare options, review a plan, look at a UI direction, inspect a diagram, or tweak a small interactive thing. The agent writes one React page. You open it in Agent Pages, mark it up with React Grab, copy the notes, and send them back.

That is the loop:

1. Ask the agent to use `agent-pages`.
2. Review the page it creates.
3. Annotate it with React Grab.
4. Paste the feedback back into chat.

## What it is good for

- Comparing implementation options without reading a wall of prose.
- Turning a design direction into something you can point at.
- Reviewing architecture, data flow, or migration plans visually.
- Making small task-specific editors for prompts, config, copy, or settings.
- Capturing feedback in a format the agent can act on.

It is not a docs site or a second product. Artifacts are meant to be temporary. Keep the useful ones, delete the stale ones.

## How it works

Artifacts are plain `.tsx` files in `src/pages`:

```text
<group-slug>__<page-name>.tsx
```

The prefix groups the page with the current project/session. The app watches the folder, so new artifacts appear without a manual rebuild.

Agents should not guess where the repo lives. The app exposes a local discovery endpoint:

```bash
curl -s http://127.0.0.1:47983/api/agent-pages
```

It returns the app URL, root directory, artifact directory, and port.

## Install

You need Bun and Git.

```bash
git clone https://github.com/IgorWarzocha/agent-pages.git agent-pages
cd agent-pages
bun install
bun run dev
```

Open:

```text
http://127.0.0.1:47983
```

Agent Pages uses a fixed local port so agents have one stable place to query. If `47983` is already taken, stop the other process and restart Agent Pages.

## Install the skill

The skill lives in the repo:

```text
.agents/agent-pages/SKILL.md
```

For Pi:

```bash
mkdir -p ~/.pi/agent/skills/agent-pages
cp .agents/agent-pages/SKILL.md ~/.pi/agent/skills/agent-pages/SKILL.md
```

For other agents, add the same `SKILL.md` using their local skill or instruction mechanism.

## Use it

Ask for it directly:

```text
Use agent-pages to compare the implementation options.
```

```text
Create an agent-pages artifact for this UI direction so I can annotate it.
```

```text
Use agent-pages to turn this review into a visual checklist.
```

Then open Agent Pages, select the artifact in the sidebar, and use React Grab — the small white control in the UI — to annotate and copy feedback back to the agent.

## Refreshing sessions

`public/session-index.json` is local generated state. It is rebuilt from your local Pi, Codex, opencode, Claude, and `src/pages` data.

It refreshes automatically when you start the app:

```bash
bun run dev
```

Refresh it manually with:

```bash
bun run index
```

If sessions look stale, missing, or from the wrong machine, regenerate the index. Do not treat a copied `session-index.json` as portable data.

## Troubleshooting

Check whether the app is running:

```bash
curl -s http://127.0.0.1:47983/api/agent-pages
```

If that fails, start it:

```bash
bun run dev
```

If an artifact does not appear:

- make sure it is in the `pagesDir` returned by the discovery endpoint
- make sure the filename uses `<group-slug>__<page-name>.tsx`
- run `bun run index`

For a full local check:

```bash
bun run check
```
