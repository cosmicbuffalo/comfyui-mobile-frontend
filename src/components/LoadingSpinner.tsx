interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: 'blue' | 'gray';
  className?: string;
}

const sizeClasses = {
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-10 h-10 border-4',
};

const colorClasses = {
  blue: 'border-cyan-400 border-t-transparent',
  gray: 'border-slate-700 border-t-slate-300',
};

export function LoadingSpinner({
  size = 'md',
  color = 'blue',
  className = '',
}: LoadingSpinnerProps) {
  return (
    <div
      className={`animate-spin rounded-full ${sizeClasses[size]} ${colorClasses[color]} ${className}`}
    />
  );
}
