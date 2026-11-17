import type { Timestamp } from 'firebase/firestore';
import type { PaymentMethod, SaleStatus, StockMovementType } from '../types';

export function roundMoney(val: number): number {
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

export function formatMoney(amount: number, currency = 'ر.ي'): string {
  const num = Number.isFinite(amount) ? amount : 0;
  const hasFraction = Math.abs(num - Math.trunc(num)) > 0.001;
  return `${num.toLocaleString('en-US', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

export function formatNumber(val: number): string {
  const num = Number.isFinite(val) ? val : 0;
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function toDate(ts: Timestamp | Date | string | null | undefined): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts === 'string') {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof (ts as Timestamp).toDate === 'function') {
    return (ts as Timestamp).toDate();
  }
  return null;
}

export function formatDateTime(ts: Timestamp | Date | string | null | undefined): string {
  const d = toDate(ts);
  if (!d) return 'الآن (قيد المزامنة)';
  return d.toLocaleString('ar-EG', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateOnly(ts: Timestamp | Date | string | null | undefined): string {
  const d = toDate(ts);
  if (!d) return '—';
  return d.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function isSameDay(ts: Timestamp | Date | null | undefined, ref = new Date()): boolean {
  const d = toDate(ts);
  if (!d) return true;
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

export function isSameMonth(ts: Timestamp | Date | null | undefined, ref = new Date()): boolean {
  const d = toDate(ts);
  if (!d) return true;
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

export function isSameYear(ts: Timestamp | Date | null | undefined, ref = new Date()): boolean {
  const d = toDate(ts);
  if (!d) return true;
  return d.getFullYear() === ref.getFullYear();
}

export function paymentMethodLabel(method: PaymentMethod): string {
  switch (method) {
    case 'cash':
      return 'نقدي';
    case 'credit':
      return 'آجل';
    case 'partial':
      return 'دفع جزئي';
  }
}

export function saleStatusLabel(status: SaleStatus): string {
  switch (status) {
    case 'completed':
      return 'مكتملة';
    case 'partial_return':
      return 'مرتجع جزئي';
    case 'returned':
      return 'مرتجع كلي';
    case 'cancelled':
      return 'ملغاة';
  }
}

export function movementTypeLabel(type: StockMovementType): string {
  switch (type) {
    case 'sale':
      return 'بيع';
    case 'purchase':
      return 'شراء (وارد)';
    case 'return':
      return 'مرتجع عميل';
    case 'in':
      return 'وارد يدوي';
    case 'out':
      return 'منصرف يدوي';
    case 'stocktake':
      return 'تسوية جرد';
    case 'cancel_restore':
      return 'إلغاء فاتورة';
  }
}

export function truncateText(val: string | undefined | null, maxLen: number): string {
  const clean = (val ?? '').trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) : clean;
}

export function makeSafeCodeId(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_');
}

export function generateDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`;
}
