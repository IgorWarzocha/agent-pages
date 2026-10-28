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
- `react-grab`: source-stack context for the app shell's in-place annotations, using its core API without a second floating toolbar.

## Change recipe

1. Ask the user to approve the dependency.
2. Add it with Bun: `bun add <package>` or `bun add -d <package>` for dev-only packages.
3. Confirm `package.json` and `bun.lock` changed.
4. If agents should know about it, update `.agents/agent-pages/SKILL.md` and any installed local copy the user cares about.
5. If users should know they can ask for it, update `README.md`.
6. For app code changes, run `bun run check`.

## Keep the base reasonable

Prefer dependencies that unlock broad artifact categories. Avoid adding one-off libraries for a single throwaway artifact unless the user explicitly wants that.

## Security overrides

The lockfile uses Bun 1.4.4's version-scoped overrides. Nano ID 3 stays on its patched 3.x line. The Mermaid converter's pinned Nano ID 4 moves to patched 5.x. Its runtime imports only the compatible named `nanoid()` export. Other overrides update vulnerable transitive Lodash ES, TOML and source-map packages. Recheck these pins when their owning dependencies update.

Mermaid's KaTeX 0.16 dependency is overridden to 0.19.1 to fix its trust-restriction advisory. Formula rendering has been checked through Mermaid in the running app. The dependency audit is clean.

TypeScript 7 uses a platform-specific native compiler supplied through optional dependencies. Keep optional dependencies enabled when installing or deploying. The app uses the compiler CLI, not the removed TypeScript 6 compiler API.
