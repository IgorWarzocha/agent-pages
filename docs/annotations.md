# In-place page annotations

Hold Ctrl and click a page element to attach a note, or Ctrl-drag to mark an area. The Annotate toolbar also arms element selection, rectangles, arrows and freehand drawing without a keyboard modifier. The hand icon returns to normal page interaction. Esc cancels the current gesture and disarms the tool. Toolbar icons have tooltips and accessible names.

The **T** tool places a text annotation. Click its position and type in the focused Text field. The words appear on the page as you type. Text marks use the same send and clear workflow, with their content stored in `comment` and `kind: "text"`. Empty text marks must be filled or removed before sending.

Add several marks and comments before choosing **Send**. An outlined circle identifies a draft and a check identifies a sent mark. Pending marks stay in the browser and navigation warns before discarding them. Sending commits one durable batch to server SQLite. Other viewers receive the saved batch through server-sent events. No clipboard handoff is required. This works on existing artifacts without changing their TSX.

Click a numbered pin or list entry to inspect its note. Users can remove pending marks, clear individual sent marks or clear the page's sent annotations. Clears are shared and revision-checked. They do not clear form responses or whiteboards. Static demo builds omit the annotation surface because they have no persistence service.

## Agent access

- `get_page_annotations({file})` reads sent notes, geometry, batch identity and source context. Pagination uses `offset` and the inspected `revision`.
- `clear_page_annotations({file,baseRevision,ids})` clears addressed notes. Omitting `ids` clears every sent mark at that revision.
- `wait_for_page_annotations({file,afterRevision,timeoutMs})` holds an active request on the live event feed. It reports changed revision and note count, not the complete document. Read the notes after it returns changed.

Element capture uses React Grab's supported core stack API without starting its separate floating toolbar. DOM selectors are scoped to the artifact root. Editable text and input values are excluded from captured context. Missing source metadata is reported rather than invented. Element outlines follow matching DOM targets. Region and freehand marks keep their original artifact-relative CSS coordinates, with viewport and page-size metadata. Layout changes can make those positions stale. An annotation is not a captured screenshot.

## Storage and HTTP

The server owns `.agent-pages/annotations.sqlite` with WAL and full synchronisation. Pointer movement and note typing do not write to SQLite. Explicit sends and clears do. A batch UUID makes retries idempotent. Compact content-hash receipts keep a delayed retry from resurrecting a cleared batch, without retaining the cleared note text. Each artifact is limited to 10,000 receipt IDs, after which new batches fail visibly rather than weakening retry safety.

| Method | Route | Result |
| --- | --- | --- |
| GET | `/api/annotations?file=<filename>` | `{file,revision,updatedAt,batches}` |
| POST | Same route, `{batchId,annotations}` | Commit one batch, return current document |
| DELETE | Same route, `{baseRevision,ids?}` | Clear inspected notes, return current document |
| GET | `/api/annotations/events?file=<filename>` | SSE `annotations` snapshots, initially and after durable changes |

The artifact must exist and be a regular TSX file. Access follows the app's trusted-local restrictions. The authenticated MCP bridge is the remote entry point, not these local routes. Conflicts return 409 with `{error,annotations}`. Limits are 100 notes per batch, 100 current batches, 2,000 current notes, 2,000 points per mark, 4,000 characters per comment, 512 KiB per write request and 2 MiB per current document. Slow event readers are disconnected rather than accumulating unlimited snapshots.

## Owners

- `src/features/annotations/`: gesture capture, DOM/source context, SVG marks, batch controls and live connection.
- `server/annotations.ts`: SQLite revisions, batch receipts and subscribers.
- `server/annotations-api.ts`: validated HTTP and event streams.
- `server/annotation-client.ts`: cancellable event-backed MCP waits.
- `server/mcp.ts`: agent read, clear and wait tools.

Cursor's [Design Mode](https://prod.cursor.com/docs/agent/design-mode) informed the element/area/markup workflow. It is a reference, not a dependency or a claim of feature parity. MCP notification research and the current SDK boundary are documented in [MCP setup](mcp.md#notifications-and-protocol-versions).
