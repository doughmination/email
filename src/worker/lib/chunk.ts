/**
 * D1 binds at most 100 parameters per statement (local D1 doesn't enforce
 * it, so tests won't notice), so a query with an IN list takes it in slices.
 * The default leaves room for the query's other parameters.
 */
export function chunks<T>(list: T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
