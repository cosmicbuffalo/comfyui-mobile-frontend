interface SearchEmptyStateProps {
  query: string;
  message: string;
}

export function SearchEmptyState({ query, message }: SearchEmptyStateProps) {
  if (!query.trim()) return null;
  return (
    <div className="px-4 py-8 text-center text-sm text-slate-400">
      {message}
    </div>
  );
}
