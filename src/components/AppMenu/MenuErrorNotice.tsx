interface MenuErrorNoticeProps {
  error: string | null;
  onDismiss: () => void;
}

export function MenuErrorNotice({ error, onDismiss }: MenuErrorNoticeProps) {
  if (!error) return null;
  return (
    <div className="mb-4 p-3 bg-red-950/80 border border-red-400/20 rounded-lg text-red-200 text-sm">
      {error}
      <button
        onClick={onDismiss}
        className="ml-2 text-red-300 font-medium"
      >
        Dismiss
      </button>
    </div>
  );
}
