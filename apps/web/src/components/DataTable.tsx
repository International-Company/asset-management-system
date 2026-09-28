import { type ReactNode, useEffect, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { PAGE_SIZES, type PageSize } from '@osooli/shared';
import type { ListState, Page } from '../lib/list';
import { Empty, ErrorState, Loading } from './States';

export interface Column<T> {
  key: string;
  label: string;
  /** Server sort key; omit for unsortable columns. */
  sort?: string;
  render: (row: T) => ReactNode;
}

interface Props<T> {
  columns: Column<T>[];
  query: UseQueryResult<Page<T>>;
  state: ListState;
  onChange: (patch: Partial<ListState>) => void;
  rowKey: (row: T) => string;
  empty: ReactNode;
  caption?: string;
}

/** Server-driven table with loading / empty / error states, sort and pagination (spec §41, §70). */
export function DataTable<T>({ columns, query, state, onChange, rowKey, empty, caption }: Props<T>) {
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const { items, total } = query.data;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));

  const toggleSort = (key: string) =>
    onChange({ sort: key, order: state.sort === key && state.order === 'asc' ? 'desc' : 'asc' });

  return (
    <div className="table-wrap" aria-busy={query.isFetching}>
      <table className="table">
        {caption && <caption className="visually-hidden">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={c.sort && state.sort === c.sort ? (state.order === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                {c.sort ? (
                  <button type="button" className="th-sort" onClick={() => toggleSort(c.sort!)}>
                    {c.label}
                    {state.sort === c.sort ? (state.order === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <Empty>{empty}</Empty>
              </td>
            </tr>
          ) : (
            items.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((c) => (
                  <td key={c.key}>{c.render(row)}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="pagination">
        <span>
          {total === 0
            ? 'لا توجد نتائج'
            : `عرض ${(state.page - 1) * state.pageSize + 1}–${Math.min(state.page * state.pageSize, total)} من ${total}`}
        </span>
        <div className="controls">
          <label>
            <span className="visually-hidden">عدد الصفوف في الصفحة</span>
            <select
              className="input"
              value={state.pageSize}
              onChange={(e) => onChange({ pageSize: Number(e.target.value) as PageSize })}
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} صف
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-sm" disabled={state.page <= 1} onClick={() => onChange({ page: state.page - 1 })}>
            السابق
          </button>
          <span>
            صفحة {state.page} من {pages}
          </span>
          <button type="button" className="btn btn-sm" disabled={state.page >= pages} onClick={() => onChange({ page: state.page + 1 })}>
            التالي
          </button>
        </div>
      </div>
    </div>
  );
}

/** Search box that updates the list after the user pauses typing. */
export function SearchBox({ value, onSearch, label = 'بحث' }: { value: string; onSearch: (q: string) => void; label?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onSearch(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text, value, onSearch]);
  return (
    <div className="field grow">
      <label htmlFor="list-search">{label}</label>
      <input id="list-search" className="input" type="search" value={text} onChange={(e) => setText(e.target.value)} />
    </div>
  );
}

export function Tabs<K extends string>({ tabs, active, onChange }: { tabs: Array<[K, string]>; active: K; onChange: (k: K) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([key, label]) => (
        <button key={key} type="button" role="tab" aria-selected={active === key} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}
