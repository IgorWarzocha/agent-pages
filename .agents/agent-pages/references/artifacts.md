Create or update one self-contained TSX file under the discovered `pagesDir`, exporting a default React component.

## Filename and access

Name it `<group-slug>__<page-name>.tsx`. Derive the group from the task's working directory, not the Agent Pages checkout:

1. Collapse the home directory to `~` only when the path is that directory or a descendant.
2. Replace runs of characters outside `a-zA-Z0-9._~-` with `-`.
3. Trim leading and trailing dashes. Use `unknown` if empty.

With MCP, use `read_artifact` and `write_artifact`. Follow `nextOffset` until null before editing existing source. A read page is not a complete replacement file.

No agent session is required. If there is no meaningful project working directory, choose a stable project or topic slug, such as `cloud-planning__launch-options.tsx`. Do not invent session metadata to make a page appear.

## Choices and feedback

Before composing the page, consider whether the user needs to choose, approve, rank, reject or comment on anything. If those responses would inform the next agent turn, include suitable controls beside the material being reviewed. Use explicit option labels and item IDs so selections and comments retain their meaning when read back. Do not add a form to a page that only needs to explain something.

Use the supported `useArtifactFeedback` hook for responses the agent should read. Import it from `../features/feedback/useArtifactFeedback` inside the single artifact TSX file. Pass that artifact's exact filename and defaults. Keep your own controls and styling, using stable field IDs across revisions. For example:

```tsx
import { useArtifactFeedback } from '../features/feedback/useArtifactFeedback';

export default function Page() {
  const feedback = useArtifactFeedback('cloud-planning__launch-options.tsx', { direction: '', comment: '' });
  return <form onSubmit={event => { event.preventDefault(); void feedback.save(); }}>
    <fieldset disabled={!feedback.ready || feedback.status === 'saving'}>
      <label>Direction <select value={String(feedback.values.direction)} onChange={event => feedback.setValue('direction', event.target.value)}>
        <option value="">Choose</option><option value="small">Small launch</option><option value="full">Full launch</option>
      </select></label>
      <label>Comment <textarea value={String(feedback.values.comment)} maxLength={4000} onChange={event => feedback.setValue('comment', event.target.value)} /></label>
    </fieldset>
    <button disabled={!feedback.dirty || feedback.status === 'saving'}>Submit feedback</button>
    <p role="status">{feedback.status === 'saved' && feedback.updatedAt ? 'Saved to the server' : feedback.status === 'unsaved' ? 'Unsubmitted changes' : feedback.status}</p>
    {feedback.error && <p role="alert">{feedback.error}</p>}
  </form>;
}
```

Submission durably stores the responses in SQLite. Agents read them with `get_artifact_feedback({file})`, separately from `read_artifact` source. Other open browsers receive saved responses automatically when they have no local edits. Drafts stay in the page until submitted, with navigation protection. On conflicts, keep the draft visible. `discardAndReload()` explicitly discards it and loads saved responses, so confirm before calling it when `dirty` is true. `refresh()` retries a read without discarding a draft.

Do not replace shared feedback with local storage or require a copy-paste handoff. Preserve the filename and field IDs when updating a page so saved answers remain associated with their questions. A field may hold a JSON scalar, array or object, within 128 fields, 8 KiB per string and 64 KiB per request. Static builds cannot save feedback. Check the complete choose, comment, submit, reload and MCP read-back flow, not just whether the controls react.

## Layout and styling

Choose composition and density from the task. Put the material the user must inspect or manipulate near the start, rather than making a working document begin with a promotional hero. Align comparable values so they can be scanned together.

- Keep artifact CSS inside the TSX file using inline styles or a local `<style>` tag. Scope selectors under a unique root class. Artifacts share the shell's DOM, so unscoped selectors such as `.sidebar`, `button` or `body` can break other UI.
- Prevent page-level horizontal overflow. Use shrinking grid tracks, wrapping and bounded widths. Scope horizontal scrolling to genuinely wide elements.
- The shell is a frame, not the artifact's art direction. Choose typography, palette and visual structure to suit the content. Shell tokens are optional integration points: `--paper`, `--panel`, `--panel-deep`, `--ink`, `--muted`, `--dim`, `--line`, `--line-soft`, `--accent`, `--link`, `--success`, `--warning` and `--error`. Keep a custom palette scoped to the artifact.
- Available libraries include `lucide-react`, `react-markdown`, `remark-gfm`, `recharts`, `three`, `clsx` and `zod`. Use only what improves the artifact.
- Add copy or export behaviour when the artifact produces reusable text, settings or data. The shell already provides in-place visual annotations with React Grab source context. Do not add another annotation widget to the artifact.

## Visual review loop

Users can Ctrl-click an element, Ctrl-drag an area, or use the Annotate toolbar to add notes, rectangles, arrows, freehand marks and on-page text. Text marks have `kind: "text"` with their words in `comment`. Pending marks stay local until **Send**. Read sent batches with `get_page_annotations({file})` before applying review changes. Element notes include DOM anchors and React source context when available. Missing source context is reported explicitly. Captured coordinates and viewport sizes describe the page at capture time, not a guaranteed screenshot of its current layout.

For large results, pass the returned `revision` with `nextOffset` as `offset`. Restart the read if the revision changes. Use `wait_for_page_annotations({file,afterRevision})` when actively waiting for a new batch. It listens to live server events, but does not wake an idle agent that has not made a request. After addressing a note, call `clear_page_annotations({file,baseRevision,ids})` with its inspected revision and IDs. Do not clear unrelated feedback. Saved form answers remain separate through `get_artifact_feedback`.

## Review

Build the direct link from the discovered `url` and a hash generated with `new URLSearchParams({ group: groupSlug, page: filename })`. Check interactions, light and dark themes where relevant, and narrow-screen overflow.

If the artifact is missing, verify the directory and filename first. When grouping or session metadata is stale, run `bun run index` from the discovered `rootDir`. Do not copy or hand-edit the generated session index. Artifact-only changes need a rendered check, not a full app build.
