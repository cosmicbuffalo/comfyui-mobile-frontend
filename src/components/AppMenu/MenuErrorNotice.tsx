interface MenuErrorNoticeProps {
  error: string | null;
  onDismiss: () => void;
}

export function MenuErrorNotice({ error, onDismiss }: MenuErrorNoticeProps) {
  if (!error) return null;
  return (
    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
      {error}
      <button
        onClick={onDismiss}
        className="ml-2 text-red-500 font-medium"
      >
        Dismiss
      </button>
    </div>
  );
}
