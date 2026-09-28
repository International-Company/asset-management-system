import { useCallback } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { PAGE_SIZES, type PageSize } from '@osooli/shared';
import { api } from './api';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListState {
  page: number;
  pageSize: PageSize;
  sort?: string;
  order: 'asc' | 'desc';
  q: string;
  filters: Record<string, string>;
}

/**
 * Server-side list state kept in the URL (so it survives reloads and can be
 * shared), plus the query that fetches it (spec §41, §70).
 */
export function useServerList<T>(
  path: string,
  filterKeys: string[] = [],
  defaults: Partial<ListState> = {},
) {
  // Filter defaults apply when the URL has no value for that filter.
  const defaultFilters = defaults.filters ?? {};
  const [params, setParams] = useSearchParams();

  const size = Number(params.get('pageSize'));
  const state: ListState = {
    page: Math.max(1, Number(params.get('page')) || 1),
    pageSize: (PAGE_SIZES as readonly number[]).includes(size)
      ? (size as PageSize)
      : (defaults.pageSize ?? 25),
    sort: params.get('sort') ?? defaults.sort,
    order:
      params.get('order') === 'desc'
        ? 'desc'
        : params.get('order') === 'asc'
          ? 'asc'
          : (defaults.order ?? 'asc'),
    q: params.get('q') ?? '',
    filters: Object.fromEntries(
      filterKeys.map((k) => [k, params.get(k) ?? defaultFilters[k] ?? '']),
    ),
  };

  const update = useCallback(
    (patch: Partial<Omit<ListState, 'filters'>> & { filters?: Record<string, string> }) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const set = (k: string, v: string | number | undefined) => {
            if (v === undefined || v === '') next.delete(k);
            else next.set(k, String(v));
          };
          if ('q' in patch) set('q', patch.q);
          if ('sort' in patch) set('sort', patch.sort);
          if ('order' in patch) set('order', patch.order);
          if ('pageSize' in patch) set('pageSize', patch.pageSize);
          for (const [k, v] of Object.entries(patch.filters ?? {})) set(k, v);
          // Changing anything but the page returns to page 1.
          set('page', 'page' in patch ? patch.page : undefined);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const qs = new URLSearchParams();
  qs.set('page', String(state.page));
  qs.set('pageSize', String(state.pageSize));
  if (state.sort) qs.set('sort', state.sort);
  qs.set('order', state.order);
  if (state.q) qs.set('q', state.q);
  for (const [k, v] of Object.entries(state.filters)) if (v) qs.set(k, v);
  const url = `${path}?${qs.toString()}`;

  const query = useQuery({
    queryKey: [path, url],
    queryFn: () => api<Page<T>>(url),
    placeholderData: keepPreviousData,
  });

  return { state, update, query };
}
