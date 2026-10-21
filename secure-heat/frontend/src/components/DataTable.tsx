import type { ReactNode } from 'react';
import { EmptyState, ErrorState, Skeleton } from './States';

export interface Column<T> { key: string; header: string; render: (row: T) => ReactNode; sortKey?: string; className?: string }
export interface Sort { key: string; order: 'asc' | 'desc' }

export function DataTable<T>({ columns, rows, rowKey, onRowClick, sort, onSort, loading, error, onRetry, emptyTitle = 'Nothing to show', emptyHint }:
  { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; sort?: Sort; onSort?: (key: string) => void; loading?: boolean; error?: string | null; onRetry?: () => void; emptyTitle?: string; emptyHint?: string }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-edge bg-navy-700/60 text-xs uppercase tracking-wide text-slate-400">
            <tr>{columns.map((c) => {
              const active = sort && c.sortKey === sort.key;
              return (<th key={c.key} scope="col" className={`whitespace-nowrap px-3 py-2 font-medium ${c.className ?? ''}`} aria-sort={active ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined}>
                {c.sortKey && onSort ? <button className="inline-flex items-center gap-1 hover:text-slate-200" onClick={() => onSort(c.sortKey!)}>{c.header}<span aria-hidden className={active ? 'text-cyan-soft' : 'opacity-30'}>{active ? (sort.order === 'asc' ? '▲' : '▼') : '↕'}</span></button> : c.header}
              </th>);
            })}</tr>
          </thead>
          <tbody className="divide-y divide-edge/70">
            {loading && rows.length === 0 ? Array.from({ length: 6 }, (_, i) => (<tr key={i}>{columns.map((c) => <td key={c.key} className="px-3 py-3"><Skeleton className="h-3 w-full" /></td>)}</tr>))
              : rows.map((r) => (
                <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r); } : undefined}
                  tabIndex={onRowClick ? 0 : undefined} className={onRowClick ? 'cursor-pointer hover:bg-navy-700/60 focus:bg-navy-700/60 focus:outline-none' : ''}>
                  {columns.map((c) => <td key={c.key} className={`whitespace-nowrap px-3 py-2 ${c.className ?? ''}`}>{c.render(r)}</td>)}
                </tr>))}
          </tbody>
        </table>
      </div>
      {error ? <ErrorState message={error} onRetry={onRetry} /> : !loading && rows.length === 0 ? <EmptyState title={emptyTitle} hint={emptyHint} /> : null}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize)); const from = total === 0 ? 0 : (page - 1) * pageSize + 1; const to = Math.min(total, page * pageSize);
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
      <span>{from}–{to} of {total.toLocaleString()}</span>
      <div className="flex items-center gap-2">
        <button className="btn-ghost px-2 py-1" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span>Page {page} / {pages}</span>
        <button className="btn-ghost px-2 py-1" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
