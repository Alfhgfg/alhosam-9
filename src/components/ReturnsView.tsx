import React, { useMemo, useState } from 'react';
import { Ban, RotateCcw, Search } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useStoreData } from '../contexts/StoreDataContext';
import {
  cancelSaleInvoice,
  executeSalesReturn,
} from '../services/accountingService';
import type { SaleInvoice } from '../types';
import {
  formatDateTime,
  formatMoney,
  saleStatusLabel,
} from '../utils/format';

export const ReturnsView: React.FC = () => {
  const { actorInfo, isAdmin, hasPermission } = useAuth();
  const { sales, returns, settings } = useStoreData();

  const canReturn = isAdmin || hasPermission('canReturn');
  const canCancel = isAdmin || hasPermission('canCancelInvoice');

  const [search, setSearch] = useState('');
  const [selectedSale, setSelectedSale] = useState<SaleInvoice | null>(null);
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({});
  const [restockValid, setRestockValid] = useState(true);
  const [refundCash, setRefundCash] = useState(true);
  const [reason, setReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  const returnableSales = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales.filter((s) => {
      if (s.status === 'cancelled' || s.status === 'returned') return false;
      if (!q) return true;
      return (
        s.invoiceNumber.toLowerCase().includes(q) ||
        s.customerName.toLowerCase().includes(q) ||
        s.employeeName.toLowerCase().includes(q)
      );
    });
  }, [sales, search]);

  const getReturnedQty = (saleId: string, productId: string): number => {
    let total = 0;
    for (const r of returns) {
      if (r.saleId === saleId) {
        for (const it of r.items) {
          if (it.productId === productId) total += it.qty;
        }
      }
    }
    return total;
  };

  const openSaleForReturn = (sale: SaleInvoice) => {
    setSelectedSale(sale);
    const init: Record<string, number> = {};
    for (const it of sale.items) {
      init[it.productId] = 0;
    }
    setReturnQtys(init);
    setRestockValid(true);
    setRefundCash(sale.paymentMethod === 'cash');
    setReason('');
    setFeedback(null);
  };

  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorInfo || !selectedSale) return;
    setProcessing(true);
    setFeedback(null);
    try {
      const itemsToReturn = Object.entries(returnQtys)
        .filter(([, qty]) => qty > 0)
        .map(([productId, qty]) => ({ productId, qty }));

      const result = await executeSalesReturn(actorInfo, {
        sale: selectedSale,
        existingReturns: returns,
        itemsToReturn,
        restockValid,
        refundCash,
        reason: reason.trim() || 'مرتجع عميل',
      });

      setFeedback({
        type: 'ok',
        text: result.queued
          ? `تم حفظ المرتجع للفاتورة ${selectedSale.invoiceNumber} محلياً وسيُزامن فور عودة الاتصال.`
          : `تم تسجيل المرتجع للفاتورة ${selectedSale.invoiceNumber} وتحديث المخزون والحسابات.`,
      });
      setSelectedSale(null);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر تسجيل المرتجع.',
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelInvoice = async (sale: SaleInvoice) => {
    if (!actorInfo || !canCancel) return;
    if (!reason.trim()) {
      setFeedback({ type: 'err', text: 'يرجى كتابة سبب الإلغاء قبل إلغاء الفاتورة.' });
      return;
    }
    setProcessing(true);
    setFeedback(null);
    try {
      await cancelSaleInvoice(actorInfo, sale, reason.trim());
      setFeedback({
        type: 'ok',
        text: `تم إلغاء الفاتورة ${sale.invoiceNumber} وإرجاع الكميات للمخزون وعكس المبالغ.`,
      });
      setSelectedSale(null);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر إلغاء الفاتورة.',
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">المرتجعات وإلغاء الفواتير</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          استرجاع أصناف محددة · إعادة الصالح للمخزون · رد المبالغ · سجل الإلغاء والتعديلات
        </p>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl text-xs border ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Select Invoice */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-bold text-slate-900">اختر فاتورة لإجراء مرتجع أو إلغاء</h2>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث برقم الفاتورة أو اسم العميل..."
              className="w-full pr-9 pl-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>

          <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
            {returnableSales.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-500">
                لا توجد فواتير قابلة للإرجاع حالياً.
              </p>
            ) : (
              returnableSales.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => openSaleForReturn(s)}
                  className={`w-full text-right py-3 px-3 flex items-center justify-between hover:bg-slate-50 rounded-lg cursor-pointer ${
                    selectedSale?.id === s.id ? 'bg-emerald-50/60' : ''
                  }`}
                >
                  <div>
                    <div className="font-mono-num font-bold text-sm text-slate-900">
                      {s.invoiceNumber} · {s.customerName}
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatDateTime(s.createdAt)} · {saleStatusLabel(s.status)}
                    </div>
                  </div>
                  <div className="font-mono-num font-bold text-emerald-700 text-sm">
                    {formatMoney(s.total, settings.currency)}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Return Form */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5">
          {!selectedSale ? (
            <div className="py-16 text-center text-sm text-slate-500">
              اختر فاتورة من القائمة لبدء عملية الإرجاع أو الإلغاء.
            </div>
          ) : (
            <form onSubmit={handleReturnSubmit} className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    معالجة الفاتورة {selectedSale.invoiceNumber}
                  </h3>
                  <p className="text-xs text-slate-500">
                    العميل: {selectedSale.customerName} · الإجمالي:{' '}
                    {formatMoney(selectedSale.total, settings.currency)}
                  </p>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="text-right py-2 px-3">الصنف</th>
                      <th className="text-center py-2 px-3">المباع</th>
                      <th className="text-center py-2 px-3">المتاح للإرجاع</th>
                      <th className="text-center py-2 px-3">كمية الإرجاع</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedSale.items.map((it) => {
                      const prevRet = getReturnedQty(selectedSale.id, it.productId);
                      const maxRet = Math.max(0, it.qty - prevRet);
                      return (
                        <tr key={it.productId}>
                          <td className="py-2 px-3">
                            <div className="font-semibold text-slate-900">{it.name}</div>
                            <div className="font-mono-num text-slate-500">{it.code}</div>
                          </td>
                          <td className="py-2 px-3 text-center font-mono-num">{it.qty}</td>
                          <td className="py-2 px-3 text-center font-mono-num">{maxRet}</td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="number"
                              min="0"
                              max={maxRet}
                              step="any"
                              disabled={!canReturn || maxRet === 0}
                              value={returnQtys[it.productId] ?? 0}
                              onChange={(e) =>
                                setReturnQtys((prev) => ({
                                  ...prev,
                                  [it.productId]: Math.min(
                                    maxRet,
                                    Math.max(0, Number(e.target.value) || 0)
                                  ),
                                }))
                              }
                              className="w-20 px-2 py-1 text-center font-mono-num border border-slate-200 rounded-md"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="space-y-2 text-xs text-slate-700">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restockValid}
                    onChange={(e) => setRestockValid(e.target.checked)}
                  />
                  <span>الأصناف المرتجعة صالحة وتُعاد تلقائياً إلى رصيد المخزون</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={refundCash}
                    onChange={(e) => setRefundCash(e.target.checked)}
                  />
                  <span>رد قيمة المرتجع نقداً من الصندوق (بدلاً من خصمه من دين العميل)</span>
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  سبب الإرجاع أو الإلغاء *
                </label>
                <input
                  required
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="مثال: رغبة العميل في التبديل / منتج تالف / خطأ في الإدخال"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2">
                {canReturn && (
                  <button
                    type="submit"
                    disabled={processing}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>اعتماد المرتجع</span>
                  </button>
                )}
                {canCancel && (
                  <button
                    type="button"
                    disabled={processing}
                    onClick={() => handleCancelInvoice(selectedSale)}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl cursor-pointer"
                  >
                    <Ban className="w-4 h-4" />
                    <span>إلغاء الفاتورة بالكامل</span>
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Returns Log */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-900">
            سجل المرتجعات ({returns.length})
          </h2>
        </div>
        {returns.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            لا توجد مرتجعات مسجلة.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <tr>
                  <th className="text-right py-2.5 px-4">رقم المرتجع</th>
                  <th className="text-right py-2.5 px-4">الفاتورة</th>
                  <th className="text-right py-2.5 px-4">العميل</th>
                  <th className="text-right py-2.5 px-4">الأصناف</th>
                  <th className="text-left py-2.5 px-4">المبلغ المسترد</th>
                  <th className="text-right py-2.5 px-4">السبب والموظف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {returns.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2.5 px-4 font-mono-num font-semibold">
                      {r.returnNumber}
                    </td>
                    <td className="py-2.5 px-4 font-mono-num text-slate-700">
                      {r.invoiceNumber}
                    </td>
                    <td className="py-2.5 px-4">{r.customerName}</td>
                    <td className="py-2.5 px-4 text-xs text-slate-600">
                      {r.items.map((i) => `${i.name} (${i.qty})`).join(' · ')}
                    </td>
                    <td className="py-2.5 px-4 text-left font-mono-num font-bold text-red-700">
                      {formatMoney(r.refundAmount, settings.currency)}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600">
                      <div>{r.reason}</div>
                      <div className="text-slate-400">
                        {r.employeeName}
                        {r.deviceName ? ` · ${r.deviceName}` : ''} · {formatDateTime(r.createdAt)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
