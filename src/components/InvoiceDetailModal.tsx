import React, { useState } from 'react';
import { Check, Copy, Printer, X } from 'lucide-react';
import { useStoreData } from '../contexts/StoreDataContext';
import type { SaleInvoice } from '../types';
import {
  formatDateTime,
  formatMoney,
  paymentMethodLabel,
  saleStatusLabel,
} from '../utils/format';

interface InvoiceDetailModalProps {
  sale: SaleInvoice | null;
  onClose: () => void;
  showProfit?: boolean;
}

export const InvoiceDetailModal: React.FC<InvoiceDetailModalProps> = ({
  sale,
  onClose,
  showProfit = false,
}) => {
  const { settings } = useStoreData();
  const [copied, setCopied] = useState(false);

  if (!sale) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleCopyShare = async () => {
    const lines = [
      `${settings.storeName} - فاتورة رقم ${sale.invoiceNumber}`,
      `التاريخ: ${formatDateTime(sale.createdAt)}`,
      `العميل: ${sale.customerName}${sale.customerCode ? ` (${sale.customerCode})` : ''}`,
      `البائع: ${sale.employeeName}`,
      ...(sale.deviceName ? [`الجهاز: ${sale.deviceName}`] : []),
      `----------------`,
      ...sale.items.map(
        (it) =>
          `• ${it.name} [${it.code}] × ${it.qty} ${it.unit} = ${formatMoney(it.lineTotal, settings.currency)}`
      ),
      `----------------`,
      `الإجمالي: ${formatMoney(sale.total, settings.currency)}`,
      `المدفوع: ${formatMoney(sale.paidAmount, settings.currency)}`,
      `المتبقي: ${formatMoney(sale.remainingAmount, settings.currency)}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked fallback ignored
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl overflow-hidden print-container">
        {/* Header (no-print actions) */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 no-print">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              تفاصيل الفاتورة {sale.invoiceNumber}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {formatDateTime(sale.createdAt)} · البائع: {sale.employeeName}
              {sale.deviceName ? ` · الجهاز: ${sale.deviceName}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyShare}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer whitespace-nowrap"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'تم النسخ' : 'نسخ للمشاركة'}</span>
            </button>
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>طباعة / PDF</span>
            </button>
            <button
              onClick={onClose}
              aria-label="إغلاق"
              className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200/60 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Invoice Body */}
        <div className="p-6 space-y-6">
          {sale.isOfflinePending && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium no-print">
              فاتورة محفوظة محلياً — بانتظار المزامنة مع السحابة فور عودة الاتصال بالإنترنت.
            </div>
          )}
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">{settings.storeName}</h2>
              {(settings.address || settings.phone) && (
                <p className="text-xs text-slate-500 mt-1">
                  {[settings.address, settings.phone].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
            <div className="text-left space-y-1 text-xs text-slate-600">
              <div>
                رقم الفاتورة:{' '}
                <span className="font-mono-num font-bold text-slate-900">
                  {sale.invoiceNumber}
                </span>
              </div>
              <div>التاريخ: {formatDateTime(sale.createdAt)}</div>
              <div>
                الحالة:{' '}
                <span
                  className={
                    sale.status === 'cancelled'
                      ? 'text-red-700 font-semibold'
                      : sale.status === 'completed'
                      ? 'text-emerald-700 font-semibold'
                      : 'text-amber-700 font-semibold'
                  }
                >
                  {saleStatusLabel(sale.status)}
                </span>
              </div>
            </div>
          </div>

          {/* Parties */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-sm bg-slate-50 p-4 rounded-xl border border-slate-100">
            <div>
              <div className="text-xs text-slate-500">العميل</div>
              <div className="font-semibold text-slate-900 mt-0.5">{sale.customerName}</div>
              {sale.customerCode && (
                <div className="text-xs font-mono-num text-slate-500">
                  كود: {sale.customerCode}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-slate-500">الموظف / البائع</div>
              <div className="font-semibold text-slate-900 mt-0.5">{sale.employeeName}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">اسم الجهاز</div>
              <div className="font-semibold text-slate-900 mt-0.5">
                {sale.deviceName || 'غير محدد'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">طريقة الدفع</div>
              <div className="font-semibold text-slate-900 mt-0.5">
                {paymentMethodLabel(sale.paymentMethod)}
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <tr>
                  <th className="text-right py-2.5 px-3 font-semibold">الكود</th>
                  <th className="text-right py-2.5 px-3 font-semibold">الصنف</th>
                  <th className="text-center py-2.5 px-3 font-semibold">الكمية</th>
                  <th className="text-left py-2.5 px-3 font-semibold">سعر الوحدة</th>
                  <th className="text-left py-2.5 px-3 font-semibold">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sale.items.map((item, idx) => (
                  <tr key={`${item.productId}_${idx}`}>
                    <td className="py-2.5 px-3 font-mono-num text-xs text-slate-600">
                      {item.code}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-slate-900">
                      {item.name}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono-num">
                      {item.qty} {item.unit}
                    </td>
                    <td className="py-2.5 px-3 text-left font-mono-num">
                      {formatMoney(item.unitPrice, settings.currency)}
                    </td>
                    <td className="py-2.5 px-3 text-left font-mono-num font-semibold text-slate-900">
                      {formatMoney(item.lineTotal, settings.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary totals */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
            <div className="text-xs text-slate-500 space-y-1">
              {sale.notes && <div>ملاحظات: {sale.notes}</div>}
              {settings.receiptFooter && <div>{settings.receiptFooter}</div>}
            </div>
            <div className="border border-slate-200 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>المجموع قبل الخصم</span>
                <span className="font-mono-num">{formatMoney(sale.subtotal, settings.currency)}</span>
              </div>
              {sale.discount > 0 && (
                <div className="flex justify-between text-amber-700">
                  <span>الخصم</span>
                  <span className="font-mono-num">- {formatMoney(sale.discount, settings.currency)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-slate-900 text-base border-t border-slate-200 pt-2">
                <span>الصافي المطلوب</span>
                <span className="font-mono-num">{formatMoney(sale.total, settings.currency)}</span>
              </div>
              <div className="flex justify-between text-emerald-700">
                <span>المدفوع</span>
                <span className="font-mono-num font-semibold">{formatMoney(sale.paidAmount, settings.currency)}</span>
              </div>
              <div className="flex justify-between text-red-700">
                <span>المتبقي (آجل)</span>
                <span className="font-mono-num font-semibold">{formatMoney(sale.remainingAmount, settings.currency)}</span>
              </div>
              {showProfit && (
                <div className="flex justify-between text-slate-700 border-t border-slate-100 pt-2 text-xs">
                  <span>صافي ربح الفاتورة (للمسؤول)</span>
                  <span className="font-mono-num font-semibold">
                    {formatMoney(sale.netProfit, settings.currency)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
