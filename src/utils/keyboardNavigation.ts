/** Move an active option, wrapping around at either end. */
export function getNextWrappedIndex(currentIndex: number, direction: -1 | 1, length: number): number {
  if (!Number.isSafeInteger(length) || length <= 0) return -1;
  if (!Number.isSafeInteger(currentIndex) || currentIndex < 0 || currentIndex >= length) return direction > 0 ? 0 : length - 1;
  return (currentIndex + direction + length) % length;
}

/** Move between sequential controls without wrapping beyond the first/last item. */
export function getAdjacentIndex(currentIndex: number, direction: -1 | 1, length: number): number {
  if (!Number.isSafeInteger(currentIndex) || !Number.isSafeInteger(length) || length <= 0) return -1;
  const next = currentIndex + direction;
  return next >= 0 && next < length ? next : -1;
}
