import { Component, type ErrorInfo, type ReactNode } from 'react';

export const Skeleton = ({ className = 'h-4 w-full' }: { className?: string }) => <div className={`animate-pulse rounded bg-navy-600/70 ${className}`} aria-hidden />;

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (<div className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center" data-testid="empty-state"><p className="text-sm font-medium text-slate-300">{title}</p>{hint && <p className="max-w-md text-xs text-slate-500">{hint}</p>}{action && <div className="mt-3">{action}</div>}</div>);
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (<div role="alert" className="flex flex-col items-center gap-2 px-6 py-8 text-center"><p className="text-sm font-medium text-crit">Couldn't load this data</p><p className="max-w-md text-xs text-slate-400">{message}</p>{onRetry && <button className="btn-ghost mt-1" onClick={onRetry}>Retry</button>}</div>);
}
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (<div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-xl font-semibold text-slate-100">{title}</h1>{subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}</div>{actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}</div>);
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('UI error:', error.message, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (<div role="alert" className="m-8 card p-6"><h2 className="text-lg font-semibold text-crit">Something went wrong</h2><p className="mt-1 text-sm text-slate-400">This page hit an unexpected error. Your data is safe; try reloading.</p><button className="btn-primary mt-4" onClick={() => { this.setState({ error: null }); }}>Try again</button></div>);
  }
}
