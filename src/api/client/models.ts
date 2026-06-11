export interface LoraManagerRegistryNode {
  node_id: number;
  graph_id: string;
  graph_name: string | null;
  bgcolor: string | null;
  title: string;
  type: string;
  comfy_class: string;
  widget_names?: string[];
  mode?: number;
  capabilities: {
    supports_lora: boolean;
    widget_names: string[];
  };
}

export async function registerLoraManagerNodes(nodes: LoraManagerRegistryNode[]): Promise<void> {
  if (nodes.length === 0) return;
  const response = await fetch(`/api/lm/register-nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes })
  });
  if (!response.ok) throw new Error('Failed to register Lora Manager nodes');
}

export interface TriggerWordTargetReference {
  node_id: number;
  graph_id: string;
}

export async function requestTriggerWords(
  loraNames: string[],
  nodeIds: TriggerWordTargetReference[]
): Promise<void> {
  if (!nodeIds || nodeIds.length === 0) return;
  const response = await fetch(`/api/lm/loras/get_trigger_words`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lora_names: loraNames ?? [],
      node_ids: nodeIds
    })
  });
  if (!response.ok) throw new Error('Failed to fetch trigger words');
}

// User workflows API
