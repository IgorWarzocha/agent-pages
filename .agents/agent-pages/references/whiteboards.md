Use the existing board ID or list boards before creating another. Open its direct link: the discovered `url` with `#view=whiteboards&board=<id>`. Keep a browser on the board while collaborating so current canvas previews can be generated.

## Read, edit and inspect

1. Read the scene with `get_whiteboard`. It automatically saves a durable `checkpointId`. Follow `nextOffset` until null, passing that ID on every subsequent page to read the same snapshot. Omit it when starting a fresh read.
2. Inspect `read_whiteboard_preview` for the full canvas. Use `read_whiteboard_image` for an original screenshot by file ID. Scene data remains readable without a preview, but it cannot verify visual layout. Open the board in a browser to generate a missing preview.
3. Edit the complete elements array. Keep untouched IDs, fields and existing deletion tombstones. Increment `version` and choose a different nonnegative integer `versionNonce` for each edited element. Delete by marking `isDeleted: true` with an updated version.
4. Call `update_whiteboard` using the revision you read as `baseRevision`. It durably commits one batch and returns `checkpointId`. Retain that ID in task notes. Omit `files` to preserve attachments. Returned file metadata is not full file data and must not be sent back as a replacement files map.
5. On a revision conflict, read the current scene and reapply only your intended changes. Do not just substitute the new revision into an old array, which would erase the other person's edits.
6. Inspect the resulting preview at the revision you are discussing. If another edit arrives, refresh the scene. When waiting for the user's next edit, use `wait_for_whiteboard_change` instead of repeatedly polling the scene.

Retain the latest read or write checkpoint ID in task notes. On the next turn, pass it as `checkpointId` to `get_whiteboard_changes`. This returns element and attachment changes, `orderChanged`, and a durable `nextCheckpointId` for what you just read. For more pages, pass that ID as `toCheckpointId` with `nextOffset` as `offset`. Retain `nextCheckpointId` as your next baseline. A diff is not a complete replacement scene. Read the current scene before editing.

Scene reads, diff reads and final wait results checkpoint automatically. An unchanged revision reuses its checkpoint. Internal polling, pagination and image inspection do not create extra checkpoints. No manual checkpoint call is needed for ordinary collaboration.

## Creating elements

The API supplies common visual defaults for a new shape. A rectangle can be supplied as:

```json
{"id":"box","type":"rectangle","x":0,"y":0,"width":160,"height":80}
```

Use unique element IDs within the board. Positions and dimensions are scene coordinates, not browser pixels.

Text also needs `text`, `originalText`, positive `fontSize`, `fontFamily` and `lineHeight`, `textAlign`, `verticalAlign`, `containerId` and `autoResize`. For unbound text, use `containerId: null` and `autoResize: true`.

Lines and arrows need `points`, `startBinding`, `endBinding`, `startArrowhead` and `endArrowhead`. Unbound endpoints and absent arrowheads use null. Freehand strokes need `points`, `pressures` and `simulatePressure`. Images need a `fileId` referencing full file data, a `status` and a two-number `scale`. These use Excalidraw's scene format, not custom SVG or canvas commands.

For HTTP access without MCP, read `docs/whiteboards.md` under the discovered `rootDir`. HTTP PATCH replaces both the complete elements array and files map, unlike MCP's preserve-files default. Use that API rather than writing `.agent-pages/boards` directly.
