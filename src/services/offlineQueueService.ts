import type { PendingOperation } from '../types';

const STORAGE_KEY = 'alhussam_pending_ops_v1';
export const PENDING_OPS_EVENT = 'alhussam:pending-ops-changed';

export function loadPendingOperations(): PendingOperation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as PendingOperation[];
  } catch {
    return [];
  }
}

export function savePendingOperations(ops: PendingOperation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ops));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(PENDING_OPS_EVENT));
    }
  } catch {
    // Ignore quota/storage access errors in restricted environments
  }
}

export function enqueuePendingOperation(op: PendingOperation): PendingOperation[] {
  const current = loadPendingOperations();
  if (current.some((item) => item.operationId === op.operationId)) {
    return current;
  }
  const next = [...current, op];
  savePendingOperations(next);
  return next;
}

export function updatePendingOperation(
  operationId: string,
  patch: Partial<PendingOperation>
): PendingOperation[] {
  const current = loadPendingOperations();
  const next = current.map((item) =>
    item.operationId === operationId ? { ...item, ...patch } : item
  );
  savePendingOperations(next);
  return next;
}

export function removePendingOperation(operationId: string): PendingOperation[] {
  const current = loadPendingOperations();
  const next = current.filter((item) => item.operationId !== operationId);
  savePendingOperations(next);
  return next;
}

export function computeReservedStockMap(ops: PendingOperation[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const op of ops) {
    if (op.status === 'conflict') continue;
    if (op.type === 'sale') {
      const items = (op.payload.items as Array<{ productId?: string; qty?: number }>) || [];
      for (const it of items) {
        if (it.productId && typeof it.qty === 'number' && it.qty > 0) {
          map.set(it.productId, (map.get(it.productId) || 0) + it.qty);
        }
      }
    } else if (op.type === 'stock_adjust') {
      const productId = op.payload.productId as string | undefined;
      const mode = op.payload.mode as string | undefined;
      const qty = op.payload.quantityOrActual as number | undefined;
      if (productId && mode === 'out' && typeof qty === 'number' && qty > 0) {
        map.set(productId, (map.get(productId) || 0) + qty);
      }
    }
  }
  return map;
}

export function isNetworkOrOfflineError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '').toLowerCase()
      : '';
  const msg = (
    err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  ).toLowerCase();

  if (
    code === 'permission-denied' ||
    code === 'invalid-argument' ||
    code === 'unauthenticated'
  ) {
    return false;
  }

  if (code === 'unavailable' || code === 'deadline-exceeded') {
    return true;
  }

  return (
    msg.includes('offline') ||
    msg.includes('client is offline') ||
    msg.includes('unavailable') ||
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('load failed') ||
    msg.includes('timeout') ||
    msg.includes('transport errored') ||
    msg.includes('could not reach cloud firestore')
  );
}
