# Agent Pages

Agent Pages is a local place for the visual parts of agent work.

Instead of asking an agent to explain everything in chat, ask it to make a page: a plan you can scan, a UI direction you can react to, a chart, a checklist, a small interactive prototype. Then mark it up and send the feedback back to the agent.

The loop is simple:

1. Ask your agent to use the `agent-pages` skill.
2. Open the page it creates.
3. Annotate it with React Grab, the small white control in the app.
4. Paste the copied feedback back into chat.

That is it. The page is not meant to become a product. It is a better scratchpad for work that needs shape, layout, comparison, or interaction.

## Install

Send your agent this file and ask it to install Agent Pages:

```text
https://github.com/IgorWarzocha/agent-pages/blob/main/INSTALL.md
```

## Customise it

After Agent Pages is installed, you can change how it works. Open a coding agent inside the Agent Pages repo and tell it what you want to customise.

Point the agent at `docs/change-map.md` first. The docs are written for coding agents: they say what can be customised, which files own it, and which boundaries not to cross.

## Why use it

Agent chats are bad at some things:

- comparing options side by side
- reviewing UI ideas
- reading architecture or migration plans
- checking charts, timelines, or tradeoffs
- giving precise feedback on something visual

Agent Pages gives the agent one place to put that work. You get something you can point at, annotate, keep, or delete.

## Use it

Ask directly:

```text
Use agent-pages to compare these implementation options.
```

```text
Create an agent-pages artifact for this UI direction so I can annotate it.
```

```text
Use agent-pages to turn this review into a checklist and handoff page.
```

The agent should query the running app first, then write the page into the artifact folder Agent Pages returns. You do not need to tell it where the repo lives.

## What agents can build

Artifacts are React pages. They can be static, interactive, visual, or data-driven.

Included libraries cover the common cases:

- icons with `lucide-react`
- markdown with `react-markdown` and `remark-gfm`
- charts with `recharts`
- 3D/WebGL with `three`
- annotation feedback with `react-grab`
- small helpers with `clsx` and `zod`

So you can ask for reports, dashboards, diagrams, prototypes, mini tools, or 3D sketches without editing dependencies first.

## Refresh sessions

Agent Pages builds its sidebar from your local agent sessions and artifact files. The index refreshes when you start the app:

```bash
bun run dev
```

You can refresh it manually:

```bash
bun run index
```

If a session or artifact is missing, restart the app or run the index command.

## Troubleshooting

Check whether Agent Pages is running:

```bash
curl -s http://127.0.0.1:47983/api/agent-pages
```

If that fails, start it again:

```bash
bun run dev
```

If an artifact does not appear:

- make sure the app is running
- ask the agent to query `/api/agent-pages` instead of guessing paths
- run `bun run index`
- check that the file is in the returned artifact directory

