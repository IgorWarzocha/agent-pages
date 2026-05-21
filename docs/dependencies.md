# Dependency changes for agents

Read this when the user asks to add a dependency or when an artifact cannot be built well with the dependencies already included.

Adding a dependency changes Agent Pages itself. Ask the user before doing it.

## Already available to artifacts

- `lucide-react`: icons.
- `react-markdown` + `remark-gfm`: markdown reports, tables, and task lists.
- `recharts`: charts and dashboards.
- `three`: 3D/WebGL sketches.
- `clsx`: conditional class names.
- `zod`: validate structured JSON/config.
- `react-grab`: annotation feedback in the app shell.

## Change recipe

1. Ask the user to approve the dependency.
2. Add it with Bun: `bun add <package>` or `bun add -d <package>` for dev-only packages.
3. Confirm `package.json` and `bun.lock` changed.
4. If agents should know about it, update `.agents/agent-pages/SKILL.md` and any installed local copy the user cares about.
5. If users should know they can ask for it, update `README.md`.
6. For app code changes, run `bun run check`.

## Keep the base reasonable

Prefer dependencies that unlock broad artifact categories. Avoid adding one-off libraries for a single throwaway artifact unless the user explicitly wants that.
