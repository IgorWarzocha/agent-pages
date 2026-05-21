# Agent Pages repository rules

- `src/style.css` is only for the Agent Pages app shell: global tokens, layout, sidebar, landing page, and generic reusable shell classes.
- Artifact-specific CSS must live inside the artifact TSX file itself, normally with a local `<style>{`...`}</style>` tag or inline styles.
- Do not modify app code while adding artifacts unless the user explicitly asks to change Agent Pages itself.
- Artifacts must remain single self-contained TSX files under `src/pages` or, for the public demo build, `src/demo-pages`.
- Avoid horizontal page scrolling in artifacts unless absolutely necessary; if wide content is required, scope `overflow-x: auto` to that element.
