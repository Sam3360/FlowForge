export type PortType = "context" | "files" | "moves" | "any";
export type FieldType = "string" | "path" | "boolean" | "number" | "integer" | "enum" | "stringList";

export interface PortDef { name: string; type: PortType; label: string; required: boolean }
export interface ConfigFieldDef {
  name: string; label: string; type: FieldType; default: unknown; required: boolean; description: string;
  options: string[]; minimum: number | null; maximum: number | null; placeholder: string; pathKind: string | null; mustExist?: boolean;
}
export interface NodeDef {
  type: string; name: string; description: string; category: string;
  inputs: PortDef[]; outputs: PortDef[]; config: ConfigFieldDef[];
  sideEffects: boolean; requiresConfirmation: boolean;
}

export type Config = Record<string, unknown>;
export interface Position { x: number; y: number }

/** On-disk format (schemaVersion 1). Runtime state is never stored here. */
export interface WorkflowFile {
  schemaVersion: 1;
  name: string;
  nodes: { id: string; type: string; config: Config; position: Position }[];
  edges: { id: string; source: string; sourcePort: string; target: string; targetPort: string }[];
  editor?: { viewport?: { x: number; y: number; zoom: number } };
}

export interface Issue {
  severity: "error" | "warning"; code: string; message: string;
  nodeId: string | null; edgeId: string | null; field: string | null; hint?: string | null;
}
