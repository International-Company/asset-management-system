import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

/**
 * Create / update / delete mutations for a simple admin collection at
 * `basePath`. `listKey` is the query key prefix to refresh afterwards.
 */
export function useRecordActions(basePath: string, listKey: string = basePath) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [listKey] });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(basePath, { method: 'POST', json: body }),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      api(`${basePath}/${encodeURIComponent(id)}`, { method: 'PATCH', json: body }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`${basePath}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  return { create, update, remove };
}
