interface HiddenBlockItemProps {
  blockId: string;
  nodeCount: number;
}

export function HiddenBlockItem({ blockId, nodeCount }: HiddenBlockItemProps) {
  return (
    <div
      key={`hidden-${blockId}`}
      className="bg-slate-900/95 border border-white/10 rounded-lg px-3 py-2 mb-3 text-sm text-slate-400 text-center"
      data-reposition-item={`hidden-${blockId}`}
    >
      {nodeCount} hidden node{nodeCount !== 1 ? "s" : ""}
    </div>
  );
}
