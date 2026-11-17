import React, { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Plus, Wallet } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useStoreData } from '../contexts/StoreDataContext';
import {
  adjustCashBoxManual,
  recordExpense,
  recordVoucher,
} from '../services/accountingService';
import {
  formatDateTime,
  formatMoney,
  isSameDay,
  isSameMonth,
  isSameYear,
} from '../utils/format';

export const FinanceView: React.FC = () => {
  const { actorInfo, isAdmin, hasPermission } = useAuth();
  const {
    counters,
    cashTransactions,
    expenses,
    vouchers,
    customers,
    suppliers,
    sales,
    returns,
    settings,
  } = useStoreData();

  const canManageExp = isAdmin || hasPermission('canManageExpenses');
  const canViewReports = isAdmin || hasPermission('canViewReports');

  const [tab, setTab] = useState<'cashbox' | 'expenses' | 'vouchers' | 'pnl'>('cashbox');
  const [pnlPeriod, setPnlPeriod] = useState<'today' | 'month' | 'year' | 'all'>('month');

  // Cash adjustment (Admin)
  const [cashAdjType, setCashAdjType] = useState<'in' | 'out'>('in');
  const [cashAdjAmt, setCashAdjAmt] = useState('');
  const [cashAdjDesc, setCashAdjDesc] = useState('');

  // Expense form
  const [expTitle, setExpTitle] = useState('');
  const [expCategory, setExpCategory] = useState('إيجار ومرافق');
  const [expAmount, setExpAmount] = useState('');
  const [expNotes, setExpNotes] = useState('');

  // Voucher form
  const [vchType, setVchType] = useState<'receipt' | 'payment'>('receipt');
  const [vchPartyId, setVchPartyId] = useState('');
  const [vchAmount, setVchAmount] = useState('');
  const [vchNotes, setVchNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  const pnl = useMemo(() => {
    const inPeriod = (ts: typeof sales[number]['createdAt']) => {
      if (pnlPeriod === 'all') return true;
      if (pnlPeriod === 'today') return isSameDay(ts);
      if (pnlPeriod === 'month') return isSameMonth(ts);
      return isSameYear(ts);
    };

    const pSales = sales.filter((s) => s.status !== 'cancelled' && inPeriod(s.createdAt));
    const pReturns = returns.filter((r) => inPeriod(r.createdAt));
    const pExpenses = expenses.filter((e) => inPeriod(e.createdAt));

    const grossSales = pSales.reduce((a, s) => a + s.subtotal, 0);
    const totalDiscounts = pSales.reduce((a, s) => a + s.discount, 0);
    const totalReturns = pReturns.reduce((a, r) => a + r.refundAmount, 0);
    const netRevenue = grossSales - totalDiscounts - totalReturns;

    const cogsSold = pSales.reduce((a, s) => a + s.totalCost, 0);
    const cogsReturned = pReturns.reduce((a, r) => a + r.returnedCost, 0);
    const netCogs = Math.max(0, cogsSold - cogsReturned);

    const grossProfit = netRevenue - netCogs;
    const operatingExpenses = pExpenses.reduce((a, e) => a + e.amount, 0);
    const netProfit = grossProfit - operatingExpenses;

    return {
      grossSales,
      totalDiscounts,
      totalReturns,
      netRevenue,
      netCogs,
      grossProfit,
      operatingExpenses,
      netProfit,
      invoiceCount: pSales.length,
    };
  }, [sales, returns, expenses, pnlPeriod]);

  const handleCashAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorInfo || !isAdmin) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await adjustCashBoxManual(
        actorInfo,
        Number(cashAdjAmt) || 0,
        cashAdjType,
        cashAdjDesc.trim() || 'حركة صندوق يدوية'
      );
      setCashAdjAmt('');
      setCashAdjDesc('');
      setFeedback({ type: 'ok', text: 'تم تحديث رصيد الصندوق النقدي بنجاح.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر تحديث الصندوق.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorInfo) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const result = await recordExpense(actorInfo, {
        title: expTitle,
        category: expCategory,
        amount: Number(expAmount) || 0,
        notes: expNotes,
      });
      setExpTitle('');
      setExpAmount('');
      setExpNotes('');
      setFeedback({
        type: 'ok',
        text: result.queued
          ? 'تم حفظ المصروف محلياً وسيُزامن ويُخصم من الصندوق فور عودة الاتصال.'
          : 'تم تسجيل المصروف وخصمه من الصندوق بنجاح.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر تسجيل المصروف.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorInfo || !vchPartyId) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const partyName =
        (vchType === 'receipt' ? customers : suppliers).find((p) => p.id === vchPartyId)
          ?.name || undefined;
      const result = await recordVoucher(actorInfo, {
        type: vchType,
        partyType: vchType === 'receipt' ? 'customer' : 'supplier',
        partyId: vchPartyId,
        partyName,
        amount: Number(vchAmount) || 0,
        notes: vchNotes,
      });
      setVchAmount('');
      setVchNotes('');
      setFeedback({
        type: 'ok',
        text: result.queued
          ? `تم حفظ السند (${result.voucherNumber}) محلياً وسيُزامن فور عودة الاتصال.`
          : `تم اعتماد السند ${result.voucherNumber} وتحديث الحسابات.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر تسجيل السند.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">الحسابات المالية والصندوق</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            الصندوق النقدي · المصروفات · سندات القبض والصرف · الأرباح والخسائر
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl max-w-full overflow-x-auto">
          <button
            onClick={() => setTab('cashbox')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap ${
              tab === 'cashbox' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            الصندوق النقدي
          </button>
          <button
            onClick={() => setTab('expenses')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap ${
              tab === 'expenses' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            المصروفات ({expenses.length})
          </button>
          <button
            onClick={() => setTab('vouchers')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap ${
              tab === 'vouchers' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            سندات القبض والصرف ({vouchers.length})
          </button>
          {canViewReports && (
            <button
              onClick={() => setTab('pnl')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap ${
                tab === 'pnl' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              الأرباح والخسائر
            </button>
          )}
        </div>
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

      {tab === 'cashbox' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>الرصيد الفعلي في الصندوق</span>
                <Wallet className="w-4 h-4 text-emerald-700" />
              </div>
              <div className="text-3xl font-bold font-mono-num text-emerald-700">
                {formatMoney(counters.cashBalance, settings.currency)}
              </div>
              <p className="text-xs text-slate-500">
                يتحدث تلقائياً مع كل فاتورة بيع أو شراء أو سند قبض/صرف أو مصروف
              </p>
            </div>

            {isAdmin && (
              <form
                onSubmit={handleCashAdjust}
                className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 space-y-3"
              >
                <h2 className="text-sm font-bold text-slate-900">
                  تغذية أو سحب نقدي يدوي (للمسؤول)
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <select
                    value={cashAdjType}
                    onChange={(e) => setCashAdjType(e.target.value as 'in' | 'out')}
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="in">إيداع / رأس مال (+)</option>
                    <option value="out">سحب نقدي (-)</option>
                  </select>
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={cashAdjAmt}
                    onChange={(e) => setCashAdjAmt(e.target.value)}
                    placeholder="المبلغ"
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num"
                  />
                  <input
                    required
                    type="text"
                    value={cashAdjDesc}
                    onChange={(e) => setCashAdjDesc(e.target.value)}
                    placeholder="البيان / السبب"
                    className="sm:col-span-2 px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  تنفيذ حركة الصندوق
                </button>
              </form>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-900">
                دفتر حركات الصندوق النقدي ({cashTransactions.length})
              </h2>
            </div>
            {cashTransactions.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                لا توجد حركات نقدية مسجلة.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                    <tr>
                      <th className="text-right py-2.5 px-4">التاريخ</th>
                      <th className="text-right py-2.5 px-4">النوع والتصنيف</th>
                      <th className="text-right py-2.5 px-4">البيان</th>
                      <th className="text-left py-2.5 px-4">المبلغ</th>
                      <th className="text-left py-2.5 px-4">الرصيد بعد</th>
                      <th className="text-right py-2.5 px-4">الموظف والجهاز</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cashTransactions.slice(0, 100).map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 text-xs text-slate-500">
                          {formatDateTime(tx.createdAt)}
                        </td>
                        <td className="py-2.5 px-4 text-xs font-semibold">
                          <span
                            className={`inline-flex items-center gap-1 ${
                              tx.type === 'in' ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {tx.type === 'in' ? (
                              <ArrowDownLeft className="w-3.5 h-3.5" />
                            ) : (
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            )}
                            <span>{tx.category}</span>
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-xs text-slate-700">
                          {tx.description}
                        </td>
                        <td
                          className={`py-2.5 px-4 text-left font-mono-num font-bold ${
                            tx.type === 'in' ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {tx.type === 'in' ? '+' : '-'}
                          {formatMoney(tx.amount, settings.currency)}
                        </td>
                        <td className="py-2.5 px-4 text-left font-mono-num text-slate-900">
                          {formatMoney(tx.balanceAfter, settings.currency)}
                        </td>
                        <td className="py-2.5 px-4 text-xs text-slate-600">
                          <div>{tx.employeeName}</div>
                          {tx.deviceName && (
                            <div className="text-[11px] text-slate-400">{tx.deviceName}</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'expenses' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {canManageExp && (
            <form
              onSubmit={handleAddExpense}
              className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3"
            >
              <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
                تسجيل مصروف جديد
              </h2>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  بند المصروف *
                </label>
                <input
                  required
                  type="text"
                  value={expTitle}
                  onChange={(e) => setExpTitle(e.target.value)}
                  placeholder="مثال: فاتورة كهرباء / إيجار المحل"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  التصنيف
                </label>
                <select
                  value={expCategory}
                  onChange={(e) => setExpCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="إيجار ومرافق">إيجار ومرافق</option>
                  <option value="رواتب وأجور">رواتب وأجور</option>
                  <option value="نقل وتوصيل">نقل وتوصيل</option>
                  <option value="صيانة وتشغيل">صيانة وتشغيل</option>
                  <option value="أكياس ومستلزمات">أكياس ومستلزمات</option>
                  <option value="أخرى">أخرى</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  المبلغ ({settings.currency}) *
                </label>
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={expAmount}
                  onChange={(e) => setExpAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ملاحظات
                </label>
                <input
                  type="text"
                  value={expNotes}
                  onChange={(e) => setExpNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>حفظ المصروف وخصمه من الصندوق</span>
              </button>
            </form>
          )}

          <div
            className={`${
              canManageExp ? 'lg:col-span-8' : 'lg:col-span-12'
            } bg-white border border-slate-200 rounded-xl overflow-hidden`}
          >
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">سجل المصروفات</h2>
              <span className="text-xs font-mono-num font-bold text-red-700">
                الإجمالي:{' '}
                {formatMoney(
                  expenses.reduce((a, e) => a + e.amount, 0),
                  settings.currency
                )}
              </span>
            </div>
            {expenses.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                لا توجد مصروفات مسجلة.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                    <tr>
                      <th className="text-right py-2.5 px-4">البند</th>
                      <th className="text-right py-2.5 px-4">التصنيف</th>
                      <th className="text-left py-2.5 px-4">المبلغ</th>
                      <th className="text-right py-2.5 px-4">المسجل والتاريخ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {expenses.map((exp) => (
                      <tr key={exp.id}>
                        <td className="py-2.5 px-4">
                          <div className="font-medium text-slate-900">{exp.title}</div>
                          {exp.notes && (
                            <div className="text-xs text-slate-500">{exp.notes}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-xs text-slate-600">
                          {exp.category}
                        </td>
                        <td className="py-2.5 px-4 text-left font-mono-num font-bold text-red-700">
                          {formatMoney(exp.amount, settings.currency)}
                        </td>
                        <td className="py-2.5 px-4 text-xs text-slate-500">
                          <div>
                            {exp.employeeName} · {formatDateTime(exp.createdAt)}
                          </div>
                          {exp.deviceName && (
                            <div className="text-[11px] text-slate-400">{exp.deviceName}</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'vouchers' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleAddVoucher}
            className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3"
          >
            <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
              إصدار سند قبض أو صرف
            </h2>
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setVchType('receipt');
                  setVchPartyId('');
                }}
                className={`py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                  vchType === 'receipt' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600'
                }`}
              >
                سند قبض (من عميل)
              </button>
              {(isAdmin || hasPermission('canPurchase')) && (
                <button
                  type="button"
                  onClick={() => {
                    setVchType('payment');
                    setVchPartyId('');
                  }}
                  className={`py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                    vchType === 'payment' ? 'bg-white text-red-700 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  سند صرف (لمورد)
                </button>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {vchType === 'receipt' ? 'العميل *' : 'المورد *'}
              </label>
              <select
                required
                value={vchPartyId}
                onChange={(e) => setVchPartyId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="">-- اختر --</option>
                {(vchType === 'receipt' ? customers : suppliers).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (الرصيد: {formatMoney(p.balanceDue, settings.currency)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                المبلغ *
              </label>
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={vchAmount}
                onChange={(e) => setVchAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                البيان / ملاحظات
              </label>
              <input
                type="text"
                value={vchNotes}
                onChange={(e) => setVchNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl cursor-pointer"
            >
              حفظ السند وتحديث الرصيد
            </button>
          </form>

          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-900">سجل سندات القبض والصرف</h2>
            </div>
            {vouchers.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                لا توجد سندات مسجلة.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                    <tr>
                      <th className="text-right py-2.5 px-4">رقم السند</th>
                      <th className="text-right py-2.5 px-4">النوع</th>
                      <th className="text-right py-2.5 px-4">الطرف</th>
                      <th className="text-left py-2.5 px-4">المبلغ</th>
                      <th className="text-right py-2.5 px-4">الموظف والتاريخ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {vouchers.map((v) => (
                      <tr key={v.id}>
                        <td className="py-2.5 px-4 font-mono-num font-semibold">
                          {v.voucherNumber}
                        </td>
                        <td className="py-2.5 px-4 text-xs font-semibold">
                          <span
                            className={
                              v.type === 'receipt' ? 'text-emerald-700' : 'text-red-700'
                            }
                          >
                            {v.type === 'receipt' ? 'سند قبض' : 'سند صرف'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-medium text-slate-900">{v.partyName}</div>
                          {v.notes && (
                            <div className="text-xs text-slate-500">{v.notes}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-left font-mono-num font-bold">
                          {formatMoney(v.amount, settings.currency)}
                        </td>
                        <td className="py-2.5 px-4 text-xs text-slate-500">
                          <div>
                            {v.employeeName} · {formatDateTime(v.createdAt)}
                          </div>
                          {v.deviceName && (
                            <div className="text-[11px] text-slate-400">{v.deviceName}</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'pnl' && canViewReports && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                قائمة الدخل والأرباح والخسائر
              </h2>
              <p className="text-xs text-slate-500">
                محسوبة بدقة بناءً على تكلفة شراء البضاعة وسعر البيع الفعلي بعد الخصومات والمرتجعات والمصروفات
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  ['today', 'اليوم'],
                  ['month', 'هذا الشهر'],
                  ['year', 'هذه السنة'],
                  ['all', 'الكل'],
                ] as const
              ).map(([p, lbl]) => (
                <button
                  key={p}
                  onClick={() => setPnlPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                    pnlPeriod === p ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="max-w-xl divide-y divide-slate-100 text-sm">
            <div className="py-3 flex justify-between">
              <span className="text-slate-600">إجمالي المبيعات ({pnl.invoiceCount} فاتورة)</span>
              <span className="font-mono-num font-semibold">
                {formatMoney(pnl.grossSales, settings.currency)}
              </span>
            </div>
            <div className="py-3 flex justify-between text-amber-700">
              <span>(-) إجمالي الخصومات الممنوحة</span>
              <span className="font-mono-num">
                {formatMoney(pnl.totalDiscounts, settings.currency)}
              </span>
            </div>
            <div className="py-3 flex justify-between text-red-700">
              <span>(-) إجمالي المرتجعات</span>
              <span className="font-mono-num">
                {formatMoney(pnl.totalReturns, settings.currency)}
              </span>
            </div>
            <div className="py-3 flex justify-between font-bold text-slate-900 bg-slate-50 px-3 rounded-lg">
              <span>صافي إيرادات المبيعات</span>
              <span className="font-mono-num">
                {formatMoney(pnl.netRevenue, settings.currency)}
              </span>
            </div>
            <div className="py-3 flex justify-between text-slate-600">
              <span>(-) تكلفة البضاعة المباعة (بعد المرتجع)</span>
              <span className="font-mono-num">
                {formatMoney(pnl.netCogs, settings.currency)}
              </span>
            </div>
            <div className="py-3 flex justify-between font-semibold text-slate-900">
              <span>مجمل الربح التشغيلي</span>
              <span className="font-mono-num">
                {formatMoney(pnl.grossProfit, settings.currency)}
              </span>
            </div>
            <div className="py-3 flex justify-between text-red-700">
              <span>(-) المصروفات التشغيلية</span>
              <span className="font-mono-num">
                {formatMoney(pnl.operatingExpenses, settings.currency)}
              </span>
            </div>
            <div className="py-4 flex justify-between text-lg font-bold bg-emerald-50 px-4 rounded-xl border border-emerald-200 mt-2">
              <span className="text-emerald-900">صافي الربح النهائي</span>
              <span
                className={`font-mono-num ${
                  pnl.netProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {formatMoney(pnl.netProfit, settings.currency)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
