interface DragPlaceholderProps {
  containerKey: string;
  indexLabel: string;
  targetKey: string;
  height: number;
}

export function DragPlaceholder({
  containerKey,
  indexLabel,
  targetKey,
  height,
}: DragPlaceholderProps) {
  return (
    <div
      key={`placeholder-${containerKey}-${indexLabel}-${targetKey}`}
      data-reposition-placeholder="true"
      className="mb-3"
      style={{ height: `${height}px` }}
    />
  );
}
