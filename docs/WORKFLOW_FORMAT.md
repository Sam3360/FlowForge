# Workflow file format (schemaVersion 1)

Files are UTF-8 JSON, conventionally `*.flowforge.json`.

```json
{
  "schemaVersion": 1,
  "name": "Organize Downloads",
  "nodes": [ { "id": "list", "type": "list_files", "config": { "directory": "C:\\Users\\me\\Downloads" }, "position": { "x": 280, "y": 140 } } ],
  "edges": [ { "id": "e1", "source": "start", "sourcePort": "out", "target": "list", "targetPort": "in" } ],
  "editor": { "viewport": { "x": 0, "y": 0, "zoom": 0.8 } }
}
```

- `schemaVersion` (required): the engine and app reject unknown versions with a clear message.
- Node `id` / edge `id`: `[A-Za-z0-9_-]{1,64}`, unique. `type`: a registered node type. `config`: only fields declared by the node; missing fields get defaults; unknown fields are errors.
- `position` and `editor` are editor metadata, ignored by the engine. No runtime state is ever stored.
- Limits: 1000 nodes, 5000 edges.
- Port types: `context`, `files`, `moves`, `any` (compatible if equal or either is `any`). Each input port accepts one edge; outputs may fan out.
- Validation rules: exactly one `start`; all required inputs connected; known ports; no dangling edges; **no cycles** (no loops in v1).
- The file grants **no permissions**: allowed folders are supplied by the app at run time.

Migration policy: a breaking change bumps `schemaVersion`; the engine lists `supportedSchemaVersions` in the handshake.
