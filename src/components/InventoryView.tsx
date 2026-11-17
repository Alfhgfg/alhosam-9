import React, { useMemo, useState } from 'react';
import { ClipboardCheck, Search } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useStoreData } from '../contexts/StoreDataContext';
import { recordStockAdjustment } from '../services/accountingService';
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  movementTypeLabel,
} from '../utils/format';

export const InventoryView: React.FC = () => {
  const { actorInfo, isAdmin, hasPermission } = useAuth();
  const { products, stockMovements, settings, reservedStockByProductId } = useStoreData();

  const canStocktake =
    isAdmin || hasPermission('canStocktake') || hasPermission('canManageProducts');

  const [tab, setTab] = useState<'levels' | 'stocktake' | 'movements'>('levels');
  const [searchCode, setSearchCode] = useState('');

  // Stocktake / adjustment form
  const [selectedProdId, setSelectedProdId] = useState('');
  const [adjustMode, setAdjustMode] = useState<'stocktake' | 'in' | 'out'>('stocktake');
  const [qtyValue, setQtyValue] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProdId) || null,
    [products, selectedProdId]
  );

  const filteredProducts = useMemo(() => {
    const q = searchCode.trim().toLowerCase();
    return products.filter(
      (p) =>
        !q ||
        p.code.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q)
    );
  }, [products, searchCode]);

  const filteredMovements = useMemo(() => {
    const q = searchCode.trim().toLowerCase();
    return stockMovements.filter(
      (m) =>
        !q ||
        m.productCode.toLowerCase().includes(q) ||
        m.productName.toLowerCase().includes(q) ||
        (m.referenceNumber && m.referenceNumber.toLowerCase().includes(q))
    );
  }, [stockMovements, searchCode]);

  const totalCostVal = useMemo(
    () => products.reduce((a, p) => a + p.stock * p.costPrice, 0),
    [products]
  );
  const totalRetailVal = useMemo(
    () => products.reduce((a, p) => a + p.stock * p.sellPrice, 0),
    [products]
  );

  const handleStockAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorInfo || !selectedProduct) return;
    setFeedback(null);
    setSaving(true);
    try {
      const result = await recordStockAdjustment(actorInfo, {
        productId: selectedProduct.id,
        mode: adjustMode,
        quantityOrActual: Number(qtyValue) || 0,
        reason: reason.trim() || 'جرد دوري للمخزون',
      });
      setFeedback({
        type: 'ok',
        text: result.queued
          ? `تم حفظ تعديل مخزون "${selectedProduct.name}" محلياً وسيُزامن فور عودة الاتصال.`
          : `تم تحديث مخزون "${selectedProduct.name}" وتوثيق الحركة في السجل.`,
      });
      setQtyValue('');
      setReason('');
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر تعديل المخزون.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">إدارة المخزون والجرد</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            متابعة الكميات · جرد المخزون ومقارنة الفروقات · سجل حركة كل صنف بالكود
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl max-w-full overflow-x-auto">
          <button
            onClick={() => setTab('levels')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap shrink-0 ${
              tab === 'levels' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            أرصدة المخزون
          </button>
          {canStocktake && (
            <button
              onClick={() => setTab('stocktake')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap shrink-0 ${
                tab === 'stocktake'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              الجرد والوارد/المنصرف
            </button>
          )}
          <button
            onClick={() => setTab('movements')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap shrink-0 ${
              tab === 'movements'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600'
            }`}
          >
            تقرير حركة الأصناف ({stockMovements.length})
          </button>
        </div>
      </div>

      {/* Valuation Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">إجمالي قيمة المخزون (بسعر الشراء)</div>
          <div className="text-xl font-bold font-mono-num text-slate-900 mt-1">
            {formatMoney(totalCostVal, settings.currency)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">القيمة المتوقعة (بسعر البيع)</div>
          <div className="text-xl font-bold font-mono-num text-emerald-700 mt-1">
            {formatMoney(totalRetailVal, settings.currency)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">أصناف تحت الحد الأدنى / نافدة</div>
          <div className="text-xl font-bold font-mono-num text-amber-700 mt-1">
            {products.filter((p) => p.stock <= p.minStock).length} صنف
          </div>
        </div>
      </div>

      {tab === 'stocktake' && canStocktake && (
        <form
          onSubmit={handleStockAdjust}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 max-w-2xl"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <ClipboardCheck className="w-5 h-5 text-emerald-700" />
            <h2 className="text-base font-bold text-slate-900">
              تسجيل جرد فعلي أو حركة وارد / منصرف
            </h2>
          </div>

          {feedback && (
            <div
              className={`p-3 rounded-lg text-xs border ${
                feedback.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {feedback.text}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                اختر الصنف (بالكود أو الاسم) *
              </label>
              <select
                required
                value={selectedProdId}
                onChange={(e) => {
                  setSelectedProdId(e.target.value);
                  const found = products.find((p) => p.id === e.target.value);
                  if (found && adjustMode === 'stocktake') {
                    setQtyValue(String(found.stock));
                  }
                }}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="">-- اختر صنفاً --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.code}] {p.name} (الكمية المسجلة: {p.stock} {p.unit})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                نوع العملية
              </label>
              <select
                value={adjustMode}
                onChange={(e) =>
                  setAdjustMode(e.target.value as 'stocktake' | 'in' | 'out')
                }
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="stocktake">جرد فعلي (تحديد الرصيد الفعلي)</option>
                <option value="in">إضافة وارد للمخزون (+)</option>
                <option value="out">صرف / إتلاف من المخزون (-)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {adjustMode === 'stocktake' ? 'الكمية الفعلية المعدودة *' : 'الكمية *'}
              </label>
              <input
                required
                type="number"
                min="0"
                step="any"
                value={qtyValue}
                onChange={(e) => setQtyValue(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num"
              />
            </div>

            {selectedProduct && adjustMode === 'stocktake' && qtyValue !== '' && (
              <div className="sm:col-span-2 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs flex items-center justify-between">
                <span>
                  الرصيد المسجل: <strong className="font-mono-num">{selectedProduct.stock}</strong>
                </span>
                <span>
                  الفرق (العجز / الزيادة):{' '}
                  <strong
                    className={`font-mono-num ${
                      Number(qtyValue) - selectedProduct.stock < 0
                        ? 'text-red-700'
                        : Number(qtyValue) - selectedProduct.stock > 0
                        ? 'text-emerald-700'
                        : 'text-slate-900'
                    }`}
                  >
                    {Number(qtyValue) - selectedProduct.stock > 0 ? '+' : ''}
                    {formatNumber(Number(qtyValue) - selectedProduct.stock)}
                  </strong>
                </span>
              </div>
            )}

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                السبب / الملاحظة *
              </label>
              <input
                required
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="مثال: جرد شهري / بضاعة تالفة / تسوية عجز"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl cursor-pointer"
          >
            {saving ? 'جاري التحديث...' : 'اعتماد وحفظ حركة المخزون'}
          </button>
        </form>
      )}

      {tab !== 'stocktake' && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchCode}
              onChange={(e) => setSearchCode(e.target.value)}
              placeholder="فلترة بكود الصنف أو اسمه..."
              className="w-full pr-9 pl-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>

          {tab === 'levels' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <tr>
                    <th className="text-right py-2.5 px-4 font-semibold">الكود</th>
                    <th className="text-right py-2.5 px-4 font-semibold">الصنف</th>
                    <th className="text-center py-2.5 px-4 font-semibold">المتوفر</th>
                    <th className="text-center py-2.5 px-4 font-semibold">الحد الأدنى</th>
                    <th className="text-left py-2.5 px-4 font-semibold">قيمة المخزون (تكلفة)</th>
                    <th className="text-right py-2.5 px-4 font-semibold">التنبيه</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProducts.map((p) => {
                    const reserved = reservedStockByProductId.get(p.id) || 0;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-mono-num text-slate-700">{p.code}</td>
                        <td className="py-2.5 px-4 font-medium text-slate-900">{p.name}</td>
                        <td className="py-2.5 px-4 text-center font-mono-num font-bold">
                          {formatNumber(p.stock)} {p.unit}
                          {reserved > 0 && (
                            <div className="text-[11px] font-normal text-amber-700">
                              محجوز محلياً: {formatNumber(reserved)}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-center font-mono-num text-slate-500">
                          {formatNumber(p.minStock)}
                        </td>
                      <td className="py-2.5 px-4 text-left font-mono-num">
                        {formatMoney(p.stock * p.costPrice, settings.currency)}
                      </td>
                      <td className="py-2.5 px-4 text-xs">
                        {p.stock === 0 ? (
                          <span className="text-red-700 font-semibold">نفد</span>
                        ) : p.stock <= p.minStock ? (
                          <span className="text-amber-700 font-semibold">منخفض</span>
                        ) : (
                          <span className="text-emerald-700">جيد</span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <tr>
                    <th className="text-right py-2.5 px-3 font-semibold">التاريخ</th>
                    <th className="text-right py-2.5 px-3 font-semibold">الكود / الصنف</th>
                    <th className="text-right py-2.5 px-3 font-semibold">نوع الحركة</th>
                    <th className="text-center py-2.5 px-3 font-semibold">التغير</th>
                    <th className="text-center py-2.5 px-3 font-semibold">قبل ← بعد</th>
                    <th className="text-right py-2.5 px-3 font-semibold">السبب / المرجع</th>
                    <th className="text-right py-2.5 px-3 font-semibold">الموظف</th>
                    <th className="text-right py-2.5 px-3 font-semibold">الجهاز</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMovements.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 text-xs text-slate-500">
                        {formatDateTime(m.createdAt)}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-900">{m.productName}</div>
                        <div className="text-xs font-mono-num text-slate-500">
                          {m.productCode}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-xs font-medium text-slate-700">
                        {movementTypeLabel(m.type)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-center font-mono-num font-bold ${
                          m.qtyChange > 0
                            ? 'text-emerald-700'
                            : m.qtyChange < 0
                            ? 'text-red-700'
                            : 'text-slate-600'
                        }`}
                      >
                        {m.qtyChange > 0 ? `+${m.qtyChange}` : m.qtyChange}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono-num text-xs text-slate-600">
                        {m.previousStock} ← {m.newStock}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-slate-600">{m.reason}</td>
                      <td className="py-2.5 px-3 text-xs text-slate-700">
                        {m.employeeName}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-slate-500">
                        {m.deviceName || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
