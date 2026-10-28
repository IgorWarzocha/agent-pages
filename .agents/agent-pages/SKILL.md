---
name: agent-pages
description: "Use when creating or updating visual artifacts, or collaborating on shared whiteboards, in Agent Pages."
---

1. Choose the surface the user needs:
   - **Artifact:** a composed report, comparison, UI prototype or interactive page. Consider whether choices or comments would help the user's next decision, and plan how the agent will read those responses back.
   - **Whiteboard:** an editable sketch, shared diagram or screenshot markup. Use the shared board instead of building another drawing widget in TSX.
   - Keep plain explanations in chat when a rendered surface would not help.

2. Discover the running app with `get_app_info` through MCP, or:

   ```bash
   curl -fsS http://127.0.0.1:47983/api/agent-pages
   ```

   Use the returned `pagesDir`, `rootDir` and `url`. These paths belong to the server, not necessarily the agent's machine. Use MCP artifact tools when the filesystem is not accessible. If discovery fails, use the installation's configured launcher or `bun run dev` from its known clone. Do not guess paths or start a competing instance.

3. Load only the reference for the chosen surface:
   - Artifacts: `references/artifacts.md`, or MCP `get_skill` with `reference: "artifacts"`.
   - Whiteboards: `references/whiteboards.md`, or MCP `get_skill` with `reference: "whiteboards"`.

   For visual design work, discover and load an applicable interface design skill too.

4. Change artifact files or board content, not the Agent Pages app, unless app customisation was requested. New dependencies change the app and require approval. Never edit persisted board JSON directly.

5. Open the specific artifact or board for review, not just the homepage. Inspect the rendered result after edits. If browser access is unavailable, provide its direct link and state what remains unverified. Run full app checks only for changes to Agent Pages itself.
