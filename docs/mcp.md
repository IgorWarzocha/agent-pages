# Agent Pages MCP

The MCP server lets agents create pages, read submitted feedback and collaborate on shared whiteboards. It connects to the running app over local HTTP, not a second database. Clients can use stdio or authenticated Streamable HTTP. No Pi installation or agent session is required.

Start Agent Pages first with `bun run dev`. Configure your MCP client with an absolute checkout path:

```json
{
  "mcpServers": {
    "agent-pages": {
      "command": "bun",
      "args": ["/absolute/path/to/agent-pages/scripts/mcp.ts"]
    }
  }
}
```

The HTTP origin defaults to `http://127.0.0.1:47983`. To use a different local port, set `AGENT_PAGES_URL` in the MCP entry's `env`. Only loopback HTTP origins are accepted. The MCP process needs access to the same machine's running Agent Pages service.

Use an absolute path to `bun` as well if the MCP client's environment does not include it in `PATH`. Restart or reconnect the MCP client after adding the configuration or updating the tool set. SQLite storage is initialised automatically. There is no separate database service to install.

## Remote and cloud clients

Use Streamable HTTP for clients that accept a remote MCP URL and an `Authorization: Bearer` header. Point the client at your own deployment, for example:

```text
https://your-server.example/agent-pages-mcp
```

Create the server token during setup below, then store it in the client's protected credential field. Do not put it in chat or tracked configuration. This is a shared bearer secret, not OAuth. A client that requires OAuth and cannot supply a bearer header is not compatible with this setup.

Only give the token to trusted agents. Artifact writes create executable TSX that runs in the browser, and the tools can read and change shared app content. Do not expose Vite or the local API publicly as a substitute for this authenticated endpoint.

The MCP bridge listens on `127.0.0.1:8794/mcp` by default. Put an HTTPS reverse proxy in front of it for remote access. The app remains a separate service. Give the MCP bridge its own token rather than reusing another service's credential. Unauthenticated requests receive HTTP 401. Requests carrying an unapproved `Origin` receive HTTP 403.

### Set up a server

1. Start the app. Create a 32-byte random token as 64 lowercase hexadecimal characters in a private file owned by the service user. On POSIX, use mode `0600` and keep its containing directory private.
2. Set `AGENT_PAGES_MCP_TOKEN_FILE` to its absolute path. Optional settings are `AGENT_PAGES_MCP_PORT` with default `8794`, `AGENT_PAGES_URL` with default `http://127.0.0.1:47983`, and `AGENT_PAGES_MCP_ORIGINS`, a comma-separated list of permitted browser origins. An empty list rejects every request with an `Origin` header. Non-browser clients may omit that header.
3. Run `bun run mcp:http`. It binds only to loopback. Use an authenticated HTTPS reverse proxy for remote access, forwarding its chosen path to `http://127.0.0.1:8794/mcp`. Preserve SSE streaming and disable proxy response buffering. Do not remove bearer authentication to accommodate a client.
4. For Linux installations using mise and `~/Work/agent-pages`, the supplied `agent-pages-mcp.service` can be linked into `~/.config/systemd/user/`. Put the settings above in `~/.config/agent-pages-mcp/service.env` with private permissions. The unit uses the installed mise `bun@latest`, does not auto-install runtimes, and starts the existing `agent-pages.service`. Adjust paths and service names for a different installation. Run `systemctl --user daemon-reload` and `systemctl --user enable --now agent-pages-mcp.service`.
5. Verify `systemctl --user is-active agent-pages-mcp.service`, then make an unauthenticated POST to the MCP endpoint. Expect 401. Connect the actual MCP client with its bearer header and follow the checks below. Inspect `journalctl --user -u agent-pages-mcp.service` for failures.

Choose public or private HTTPS routing deliberately. Inspect existing routes before exposing a new endpoint or changing a shared port's public/private status. Preserve unrelated proxy routes.

### SSH alternative

A trusted client with an existing SSH connection can run the stdio process on the Agent Pages server:

```json
{
  "mcpServers": {
    "agent-pages": {
      "command": "ssh",
      "args": ["-T", "agent-pages-server", "/absolute/path/to/bun", "/absolute/path/to/agent-pages/scripts/mcp.ts"]
    }
  }
}
```

Replace the host with your configured SSH alias and both paths with their server locations. Set up key authentication and verify the host key interactively first. The client must support launching stdio commands. The Agent Pages app stays on the server, and the remote MCP process reaches it through server-local HTTP. Give access only to trusted agents: artifact writes create executable TSX, and ordinary SSH access grants capabilities beyond MCP.

## Verify the connection

1. Call `get_skill`, then load `reference: "artifacts"` or `"whiteboards"` for the task.
2. Call `get_app_info` and `list_artifacts` to verify access to the running app.
3. For a page with feedback controls, submit a choice and comment in the browser, then call `get_artifact_feedback` with its filename. Confirm the saved values match.

`get_skill` works without the app running. The other checks require the app. The artifact, whiteboard and feedback tools have been exercised through actual MCP stdio and authenticated HTTPS connections. Verify off-server reachability and your client's connector configuration for your own deployment.

## Notifications and protocol versions

The server uses the official `@modelcontextprotocol/server` 2.4.0 and `@modelcontextprotocol/node` 2.1.2 packages. HTTP and stdio support protocol `2026-07-28`, including `subscriptions/listen`. The SDK also serves existing tools to clients using `2025-11-25`. Live subscriptions require a modern connection. There is no GET notification endpoint or protocol session store.

Discover resource URIs through `resources/list` or the resource templates:

| URI | Saved content |
| --- | --- |
| `agent-pages://annotations/{file}` | Sent annotation batches and their revision |
| `agent-pages://feedback/{file}` | Submitted choices and comments |
| `agent-pages://whiteboards/{id}` | Current scene without binary attachment data |

Use the exact discovered URI in `subscriptions/listen` under `notifications.resourceSubscriptions`. Successful changes through the app API emit `notifications/resources/updated` for that URI. Read the resource or its corresponding tool after notification. Resource reads are capped at 100,000 characters. Use paginated tools for larger scenes or annotation documents. Resource reads do not create whiteboard checkpoints. Continue using the whiteboard tools when you need a durable collaboration baseline.

With the official TypeScript client 2.4.0, enable modern negotiation explicitly. Its default remains legacy:

```ts
const client = new Client(
  { name: 'my-agent', version: '1.0.0' },
  { versionNegotiation: { mode: { pin: '2026-07-28' } } },
);
// Connect using StreamableHTTPClientTransport or StdioClientTransport first.
client.setNotificationHandler('notifications/resources/updated', notification => {
  console.log(notification.params.uri);
});
const subscription = await client.listen({
  resourceSubscriptions: ['agent-pages://annotations/my-page.tsx'],
});
// Later: await subscription.close();
```

Resource-list notifications are available through `notifications.resourcesListChanged`. HTTP allows 16 open subscription streams, separately from its 16 ordinary request slots. Streams have 15-second keepalives. A client must keep its connection open and handle notifications. An idle agent will only react if its host supports that behaviour.

Subscriptions are transient. If the MCP process loses its connection to the app's change feed, it terminates affected HTTP listeners or the connected modern stdio process rather than silently missing updates. Reconnect, reread current state and subscribe again. There is no event replay. The existing wait tools remain available for clients without modern subscriptions.

This installation does not send outbound webhooks or queue background agent wake-ups. Those require a receiving endpoint and a separate delivery policy.

## Skill without installation

Call `get_skill` with no arguments to load the bundled Agent Pages skill. Load a branch with `reference: "artifacts"` or `reference: "whiteboards"` when needed. The tool returns Markdown from `.agents/agent-pages`, the same package used for installed skills. It works even when the HTTP app is stopped. Creating or changing content still requires the running app.

## Tools

| Tool | Purpose |
| --- | --- |
| `get_skill` | Read the bundled skill or a named reference without installing it |
| `list_whiteboards` | List board metadata |
| `create_whiteboard` | Create an empty board with a title |
| `get_whiteboard` | Read elements and file metadata with an automatic durable checkpoint |
| `update_whiteboard` | Commit a durable batch and return its `checkpointId`, preserving files unless supplied |
| `checkpoint_whiteboard` | Save a baseline at the inspected `baseRevision` without editing |
| `get_whiteboard_changes` | Read changes since a checkpoint and checkpoint the state being compared |
| `wait_for_whiteboard_change` | Wait for a revision different from `afterRevision` |
| `read_whiteboard_image` | View an attached image by board ID and file ID |
| `read_whiteboard_preview` | View the full canvas at its current revision |
| `get_app_info` | Discover the app URL, repository root and pages directory |
| `list_artifacts` | List TSX artifact filenames |
| `read_artifact` | Read one artifact's source |
| `get_artifact_feedback` | Read saved user choices and comments for an artifact |
| `get_page_annotations` | Read sent visual notes, markup and source context |
| `clear_page_annotations` | Clear inspected annotation IDs at a specific revision |
| `wait_for_page_annotations` | Wait on live events for annotation changes |
| `write_artifact` | Create or replace one artifact's source |

To edit a board, get its scene, preserve untouched elements and deletion tombstones, then update with the revision you read. Increment `version` and change `versionNonce` on edited elements. Omit `files` to preserve existing attachments. Supplying `files` explicitly replaces the complete files map and requires full file data, not the metadata returned by `get_whiteboard`. Follow the [scene and conflict contract](whiteboards.md).

Scene reads automatically save a durable reference to what the agent saw. `get_whiteboard` returns `checkpointId`, and `get_whiteboard_changes` returns `nextCheckpointId` for its comparison target. A wait checkpoints its final returned scene, not each internal poll. An unchanged revision reuses its existing checkpoint without another SQLite write. Lists, image inspection and ordinary browser reads do not create checkpoints.

Each successful `update_whiteboard` also commits the scene and a checkpoint in one SQLite transaction. Retain the latest read or write checkpoint ID in your task notes. On your next turn, pass it as `checkpointId` to `get_whiteboard_changes` to see the user's additions, edits, deletions, attachment changes and whether element order changed. Other agents' reads do not move your baseline. No separate checkpoint call is needed for ordinary collaboration. `checkpoint_whiteboard` remains available to explicitly checkpoint an inspected `baseRevision`.

Changes are returned as `changes` entries with `kind: "added"` or `"updated"` and an `element`, or `kind: "deleted"` and an `id`. Attachment changes are ID lists under `files`, never binary payloads. For additional pages, pass the first page's `nextCheckpointId` as `toCheckpointId` alongside `nextOffset` as `offset`. This pins every page to the same snapshot even if the user keeps editing. Retain `nextCheckpointId` as your next baseline after reading the diff. Read the complete current scene before submitting a replacement, since a diff is not a replacement elements array.

`get_whiteboard` returns every file's metadata, including its ID, but omits `dataURL`. Text results are capped at 100,000 characters. Large element arrays are paginated automatically. Pass the first page's `checkpointId` with each returned `nextOffset` as `offset` until it is null. These pages read the saved snapshot without further writes. Omit `checkpointId` to start a fresh read of the latest scene. An optional `limit` reduces the page size. An individual oversized element or metadata record requires the HTTP API.

A revision conflict is an MCP tool error with status 409 and the current scene without attachment data. Oversized conflict scenes are omitted explicitly. Read the current scene and reconcile before retrying. Omitting `files` never changes the caller's `baseRevision` or bypasses conflict detection.

`wait_for_whiteboard_change` returns `{changed,scene}`, with file metadata rather than attachment data and a `scene.checkpointId`. The default wait is 25 seconds and the maximum polling interval is 30 seconds. A zero timeout skips polling. The final scene is checkpointed before returning. `changed` compares that snapshot with `afterRevision`. Cancellation stops polling. Failed HTTP or checkpoint operations remain errors rather than being reported as a timeout or an unchanged scene.

`read_whiteboard_preview` returns MCP image content for a browser-generated PNG of the complete canvas, plus its revision. The browser exports with a light background and a maximum dimension of 1600 pixels while the board is open. A missing or outdated preview returns an error instructing you to open the board. Old revisions are never returned as current previews.

`read_whiteboard_image` returns MCP image content, not a text dump of base64. It supports PNG, JPEG, GIF and WebP data stored in the board's files map. Use it for the original attached screenshot rather than the canvas preview. It does not read arbitrary files from disk. SVG attachments must be converted to a supported image format before viewing with this tool.

Artifact writes are restricted to a single `.tsx` filename in `src/pages`. Paths, traversal and symlink targets are rejected. Writes replace the existing file, so read before editing. Keep artifacts self-contained and follow the repository's filename convention. These HTTP operations also exist at `GET /api/artifacts`, `GET /api/artifacts?file=…` and `PUT /api/artifacts` with `{file,content}`.

Artifacts do not require a matching agent session. A sessionless bot can use `list_artifacts`, `read_artifact` and `write_artifact`, then `get_artifact_feedback` to read the user's submitted responses. This returns `{file,revision,updatedAt,values}`, independently of TSX source. Revision zero with empty values means nothing has been submitted. Drafts are not included. Read the responses before revising a decision page, and preserve field IDs for unchanged questions. See [shared artifact feedback](feedback.md).

Visual annotations work on existing pages without adding controls to their TSX. Users select elements or draw markup, write notes and send a batch. `get_page_annotations` returns the saved notes with their batch IDs, capture geometry and available DOM/source context. Follow `nextOffset` with the same `revision`, restarting if it changes. `clear_page_annotations` requires `baseRevision` so a stale clear cannot erase newer feedback. Prefer selected `ids` over clearing the whole page. `wait_for_page_annotations` has a default 25-second wait and a 30-second maximum, returns a compact revision/count result, and reads no pointer drafts. See [in-place annotations](annotations.md).

`read_artifact` returns source in character pages. Follow `nextOffset` until it is null to read a large file. The default page holds up to 50,000 characters and shrinks when JSON escaping would exceed the text response limit. Do not write a partial page back as a complete artifact.

The MCP adapter uses the official TypeScript SDK. Its stdout is reserved for protocol messages. If requests fail, check that `bun run dev` is still running and inspect that terminal for storage errors.
