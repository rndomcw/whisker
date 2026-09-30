/** Binary search over items sorted by id: index of the first item whose id is ≥ `id`. */
export function firstIndexAtLeast(arr: readonly { id: number }[], id: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].id < id) lo = mid + 1; else hi = mid;
  }
  return lo;
}
