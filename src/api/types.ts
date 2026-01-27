// Workflow JSON types (matching ComfyUI format)

export interface WorkflowInput {
  name: string;
  type: string;
  link: number | null;
  localized_name?: string;
  widget?: {
    name: string;
  };
}

export interface WorkflowOutput {
  name: string;
  type: string;
  links: number[] | null;
  slot_index?: number;
  localized_name?: string;
}

export interface WorkflowNode {
  id: number;
  type: string;
  pos: [number, number];
  size: [number, number];
  flags: Record<string, unknown>;
  order: number;
  mode: number;
  inputs: WorkflowInput[];
  outputs: WorkflowOutput[];
  properties: Record<string, unknown>;
  widgets_values: unknown[] | Record<string, unknown>;
  color?: string;
  bgcolor?: string;
}

// Link format: [link_id, source_node, source_slot, target_node, target_slot, type]
export type WorkflowLink = [number, number, number, number, number, string];

export interface WorkflowGroup {
  id: number;
  title: string;
  bounding: [number, number, number, number]; // [x, y, width, height]
  color: string;
  font_size?: number;
  flags?: Record<string, unknown>;
}

export interface WorkflowSubgraphLink {
  id: number;
  origin_id: number;
  origin_slot: number;
  target_id: number;
  target_slot: number;
  type: string;
}

export interface WorkflowSubgraphDefinition {
  id: string;
  name?: string;
  version?: number;
  state?: Record<string, unknown>;
  revision?: number;
  config?: Record<string, unknown>;
  inputNode?: Record<string, unknown>;
  outputNode?: Record<string, unknown>;
  inputs?: Array<{
    id?: string;
    name?: string;
    type?: string;
    linkIds?: number[];
    label?: string;
    pos?: [number, number];
  }>;
  outputs?: Array<{
    id?: string;
    name?: string;
    type?: string;
    linkIds?: number[];
    label?: string;
    pos?: [number, number];
  }>;
  widgets?: unknown[];
  nodes: WorkflowNode[];
  groups?: WorkflowGroup[];
  links: WorkflowSubgraphLink[];
  extra?: Record<string, unknown>;
}

export interface Workflow {
  id?: string;
  revision?: number;
  last_node_id: number;
  last_link_id: number;
  nodes: WorkflowNode[];
  links: WorkflowLink[];
  groups: WorkflowGroup[];
  config: Record<string, unknown>;
  definitions?: {
    subgraphs?: WorkflowSubgraphDefinition[];
  };
  widget_idx_map?: Record<string, Record<string, number>>;
  extra?: Record<string, unknown>;
  version: number;
}

// Node type definitions from /object_info
export interface NodeInputDefinition {
  required?: Record<string, [string, Record<string, unknown>?]>;
  optional?: Record<string, [string, Record<string, unknown>?]>;
  hidden?: Record<string, string>;
}

export interface NodeTypeDefinition {
  input: NodeInputDefinition;
  input_order?: {
    required?: string[];
    optional?: string[];
  };
  output: string[];
  output_is_list?: boolean[];
  output_name?: string[];
  output_tooltips?: string[];
  name: string;
  display_name: string;
  description: string;
  python_module: string;
  category: string;
  output_node?: boolean;
}

export type NodeTypes = Record<string, NodeTypeDefinition>;

// Queue types
export interface QueueItem {
  prompt_id: string;
  number: number;
  prompt: Record<string, unknown>;
}

export interface QueueStatus {
  exec_info: {
    queue_remaining: number;
  };
}

export interface QueueInfo {
  queue_running: Array<[number, string, unknown, Record<string, unknown>, string[]]>;
  queue_pending: Array<[number, string, unknown, Record<string, unknown>, string[]]>;
}

// History types
export interface HistoryOutputImage {
  filename: string;
  subfolder: string;
  type: string;
}

export interface HistoryOutput {
  images?: HistoryOutputImage[];
  gifs?: HistoryOutputImage[];
  videos?: HistoryOutputImage[];
  [key: string]: unknown;
}

export interface HistoryItem {
  prompt: [number, string, Record<string, unknown>, Record<string, string>, string[]];
  outputs: Record<string, HistoryOutput>;
  status?: {
    status_str: string;
    completed: boolean;
    messages: Array<[string, Record<string, unknown>]>;
  };
}

export type History = Record<string, HistoryItem>;

// WebSocket message types
export interface WSMessage {
  type: string;
  data: Record<string, unknown>;
}

export interface WSStatusMessage extends WSMessage {
  type: 'status';
  data: {
    status: QueueStatus;
    sid?: string;
  };
}

export interface WSProgressMessage extends WSMessage {
  type: 'progress';
  data: {
    value: number;
    max: number;
    prompt_id?: string;
    node?: string;
  };
}

export interface WSExecutingMessage extends WSMessage {
  type: 'executing';
  data: {
    node: string | null;
    display_node?: string;
    prompt_id?: string;
  };
}

export interface WSExecutedMessage extends WSMessage {
  type: 'executed';
  data: {
    node: string;
    display_node?: string;
    output: HistoryOutput;
    prompt_id: string;
  };
}
