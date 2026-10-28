# Shared whiteboards

Whiteboards live on the Agent Pages server. The editor, HTTP clients and MCP clients all use the same revisioned scene. Browser storage is not the authority.

Start Agent Pages with `bun run dev`. Boards are saved in `.agent-pages/boards/boards.sqlite` in the repository root. This directory is local data and is excluded from Git. Keep it when updating the checkout. Removing it removes your saved boards and agent checkpoints.

One running server owns this directory. Do not run another writer against the same storage. Existing JSON boards and previews are imported together on first use. The import is transactional, keeps the original files and is not repeated after success. SQLite is authoritative after migration. Editing an old JSON file will not change a board.

For a filesystem backup, stop the server cleanly and copy the directory. Do not copy only the main SQLite file from a running server. Committed data can still be in its WAL file. Static builds and Vite preview do not provide the whiteboard API.

## Live state and durable saves

All browsers and agents connect to the same server authority. Browser edits are accepted into server memory and broadcast immediately. Newly connected clients receive that current scene, including edits awaiting persistence. A browser is never the only holder of an acknowledged edit.

SQLite holds the durable recovery state. Browser autosaves are coalesced per board after two seconds idle, with at least five seconds between background commits and a maximum ten-second wait during continuous editing. Preview writes share the same batching window rather than writing on every export. Ordinary HTTP GETs and internal polling do not write to storage after initialisation. Agent scene reads through MCP automatically checkpoint the state returned to the bot. An unchanged revision reuses its checkpoint without another write.

The toolbar distinguishes **Syncing** for local edits awaiting server acknowledgement, **Synced · awaiting disk save** for shared edits still in server memory, and **Saved · live** for scenes committed to SQLite. **Save** flushes pending state immediately. Closing a browser does not discard acknowledged edits. A clean server shutdown flushes pending state. A crash or power loss can discard edits since the last durable save, normally at most ten seconds of acknowledged edits. A storage failure can extend that interval and is reported to connected editors and the server terminal.

Agent updates through MCP commit the complete batch and a checkpoint in one durable transaction before returning success. Agent scene reads, diff reads and final wait results also establish durable checkpoints. Internal wait polls and pagination do not create extra checkpoints. Checkpoint creation, explicit saves and new boards bypass the background cadence. The five-second limit describes application background transactions, not a count of physical drive writes. SQLite uses WAL with full synchronisation and may perform several filesystem writes per transaction.

Attachment data is stored once per content hash. Scenes and checkpoints retain references, so ordinary autosaves do not repeat image payloads. Checkpoints are retained until the local data is removed. Browser autosaves do not create checkpoint history.

## HTTP API

The default origin is `http://127.0.0.1:47983`. Requests and responses use JSON, except the event stream.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/boards` | Array of `{id,title,revision,updatedAt}` |
| POST | `/api/boards` | Create with `{title}`, return the initial scene with status 201 |
| GET | `/api/boards/:id` | Current scene, or a saved snapshot with `?checkpoint=<id>` |
| PATCH | `/api/boards/:id` | Replace content with `{baseRevision,elements,files,checkpoint?}`, return the current scene |
| POST | `/api/boards/:id/save` | Flush current pending state to SQLite, return the saved scene |
| POST | `/api/boards/:id/checkpoints` | Save or reuse a baseline with `{baseRevision?}`, return `{id,boardId,revision,createdAt}` |
| GET | `/api/boards/:id/changes?checkpoint=<id>` | Compare the current scene with an explicit checkpoint, without writes |
| GET | `/api/boards/:id/events` | Server-sent scene snapshots |
| PUT | `/api/boards/:id/preview` | Store a browser-generated PNG with `{revision,dataURL}` |
| GET | `/api/boards/:id/preview` | Current preview as `{revision,dataURL}`, or status 404 if unavailable |

A scene contains:

```json
{
  "id": "f1212bde-dd01-4dd7-8427-f7c8e5ff0de7",
  "title": "Release plan",
  "revision": 0,
  "durableRevision": 0,
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "elements": [],
  "files": {}
}
```

IDs are UUIDs assigned by the server. Titles contain 1 to 160 characters after trimming. New scenes start at revision 0. Each successful PATCH increments the live revision once, even if content is unchanged. `durableRevision` identifies the latest scene committed to SQLite. A background persistence failure adds `persistenceError` until a successful save. Titles are fixed at creation.

HTTP PATCH defaults to a buffered browser-style update. Set `checkpoint: true` for a durable agent batch. The returned scene includes `checkpointId`. A failed durable batch does not advance the live revision or publish the proposed scene. A failed background save keeps the already accepted live scene available for retry.

Checkpoint creation does not advance the revision. Supply `baseRevision` to require the exact scene you inspected, or omit it to atomically capture the latest scene. An existing checkpoint for that revision is reused. Retain the returned ID to compare later. Reading `GET /api/boards/:id?checkpoint=<id>` returns that immutable saved scene with its `checkpointId`, even after new edits arrive. MCP uses this capture-then-read path so its checkpoint always matches the returned content.

Changes contain `fromRevision`, `toRevision`, full `added` and `updated` live elements, `deletedIds`, `orderChanged`, and attachment `addedIds`, `updatedIds` and `removedIds` under `files`. Deletion includes a new tombstone or a missing element. Attachment bytes are never included in a diff. Comparisons always use the requested baseline, not another agent's most recent checkpoint. Add `toCheckpoint=<id>` to pin the target to another saved snapshot. That response includes `nextCheckpointId` identifying the target. MCP captures this target automatically and reuses it for paginated diffs.

PATCH replaces the complete elements array and binary files map. Include untouched elements, deleted-element tombstones and retained files. Element-specific fields use Excalidraw's JSON format. Common visual fields receive defaults when omitted, so a new rectangle can be supplied as `{ "id": "box", "type": "rectangle", "x": 0, "y": 0, "width": 160, "height": 80 }`. Text, images, freehand strokes and linear elements require their type-specific fields. Unknown JSON fields are preserved.

When changing an existing element, increment its `version` and change its `versionNonce` so open editors can reconcile the change. Do not reset untouched element versions.

The server accepts at most 10,000 elements, 100 binary files and 20 MiB per request or persisted scene. File map keys must match each file's `id`. Each file includes `id`, `mimeType`, `dataURL` and `created`. Element IDs must be unique. Invalid requests return status 400. Oversized requests return 413.

## Canvas previews

An open browser exports the full canvas as a PNG after its scene has synced. Exports use a light background and a maximum dimension of 1600 pixels. The preview request contains the exact scene `revision` and a `data:image/png;base64,...` URL. The decoded PNG is capped at 4 MiB, with additional request space for base64 encoding.

The server accepts a preview only for the current revision. A stale PUT returns 409. A GET returns only an exact-current preview. Missing or outdated previews return 404 with instructions to open the board in a browser. A browser must remain open to generate previews of new revisions.

Previews are derived images for inspection, including through the MCP `read_whiteboard_preview` tool. They are immediately available from server memory and persisted in SQLite with the next batched or explicit save. A preview does not change the scene revision or timestamps. The editable scene remains authoritative.

## Conflicts and notifications

Writes are serialised. A PATCH succeeds only when `baseRevision` matches the current revision. Otherwise the server returns status 409 with `{error,scene}`, including the current snapshot. Reconcile your proposed changes with that scene before retrying. Blindly replacing the new revision can erase another person's work.

Buffered updates return success after entering shared server memory. Durable batches and explicit saves return success only after SQLite commits. Storage errors appear in the server terminal and failed explicit operations return status 500.

An event stream sends `event: scene` with the complete scene as JSON in `data`. It sends an initial snapshot, each accepted revision, and durability or persistence-error updates at the same revision. The event ID is the live revision. Reconnecting receives the current snapshot rather than a replay. Idle streams receive heartbeat comments. Closing the connection removes its subscription. Slow readers are disconnected rather than accumulating unlimited snapshots.

The API is a trusted local service, not an authenticated network service. It accepts loopback hostnames only. Writes require `Content-Type: application/json` and reject cross-origin browser requests. Command-line clients may omit `Origin`. Do not expose the Vite server to an untrusted network.

For agent access, see [MCP setup](mcp.md).
