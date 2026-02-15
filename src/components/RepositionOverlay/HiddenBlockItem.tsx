interface HiddenBlockItemProps {
  blockId: string;
  nodeCount: number;
}

export function HiddenBlockItem({ blockId, nodeCount }: HiddenBlockItemProps) {
  return (
    <div
      key={`hidden-${blockId}`}
      className="bg-gray-200 rounded-lg px-3 py-2 mb-3 text-sm text-gray-500 text-center"
      data-reposition-item={`hidden-${blockId}`}
    >
      {nodeCount} hidden node{nodeCount !== 1 ? "s" : ""}
    </div>
  );
}
