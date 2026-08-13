import { useT } from "@/i18n";

interface HiddenBlockItemProps {
  blockId: string;
  nodeCount: number;
}

export function HiddenBlockItem({ blockId, nodeCount }: HiddenBlockItemProps) {
  const t = useT();
  return (
    <div
      key={`hidden-${blockId}`}
      className="bg-slate-900/95 border border-white/10 rounded-lg px-3 py-2 mb-3 text-sm text-slate-400 text-center"
      data-reposition-item={`hidden-${blockId}`}
    >
      {nodeCount === 1
        ? t("{count} hidden node", { count: nodeCount })
        : t("{count} hidden nodes", { count: nodeCount })}
    </div>
  );
}
