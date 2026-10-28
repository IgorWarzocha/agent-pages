# Artifact feedback

An interactive artifact can submit user choices and comments to the Agent Pages server. Agents retrieve the saved responses through `get_artifact_feedback`, without browser access, session metadata or a copy-paste handoff.

Artifacts use the supported `useArtifactFeedback` hook and keep their own controls and styling. The import and a working example are in `.agents/agent-pages/references/artifacts.md`. The live example is `src/pages/agent-pages__feedback-loop.tsx`.

## State and persistence

Responses are keyed by the exact artifact filename and stable field IDs. Updating the TSX source preserves the saved responses. Keep an ID for the same question, but choose a new ID when its meaning changes. Source reads do not include response data.

Edits are drafts until the user chooses **Submit feedback**. Submission commits one current response document to `.agent-pages/feedback.sqlite`, using SQLite WAL with full synchronisation. It creates no per-keystroke history. Submitting unchanged values performs no database write. Drafts are not saved to the server or visible to agents. Navigation warns before discarding them.

Open pages refresh saved responses every three seconds and on focus when there is no local draft. A revision conflict preserves the draft and asks the user to load saved responses explicitly. It never silently overwrites another browser's submission. Network and persistence failures remain visible. Static builds do not provide the feedback service.

## HTTP API

Both routes require an existing regular artifact file. Traversal and symlinks are rejected. The service uses the same trusted-local access restrictions as the other Agent Pages APIs.

| Method | Route | Result |
| --- | --- | --- |
| GET | `/api/artifact-feedback?file=<filename>` | `{file,revision,updatedAt,values}` |
| PATCH | Same route, with `{baseRevision,values}` | Durably saved response document |

An artifact without saved feedback returns revision `0`, `updatedAt: null` and empty `values`. PATCH replaces the complete values map. A stale revision returns status 409 with `{error,feedback}`, containing the current saved responses. A successful change advances the revision once. Ordinary reads do not change the revision or write to SQLite after initialisation.

Values are bounded JSON with at most 128 fields, 128 items per collection, eight nesting levels and 8 KiB per string. Requests are limited to 64 KiB. Use field keys containing letters, digits, underscores, dots, colons or hyphens, beginning with a letter, digit or underscore.

## Owners

- `src/features/feedback/contract.ts`: wire schemas and limits.
- `src/features/feedback/sync.ts`: draft, submission, conflict and refresh lifetime.
- `src/features/feedback/useArtifactFeedback.ts`: supported React hook for single-file artifacts.
- `server/feedback.ts`: SQLite authority and durable revision checks.
- `server/feedback-api.ts`: artifact validation and HTTP boundary.
- `server/mcp.ts`: agent read-back.
