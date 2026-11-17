import React, { useMemo, useState } from 'react';
import {
  Banknote,
  Edit2,
  FileText,
  Plus,
  Printer,
  Search,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useStoreData } from '../contexts/StoreDataContext';
import {
  createCustomer,
  recordVoucher,
  updateCustomer,
} from '../services/accountingService';
import type { Customer, SaleInvoice } from '../types';
import {
  formatDateTime,
  formatMoney,
  paymentMethodLabel,
} from '../utils/format';
import { InvoiceDetailModal } from './InvoiceDetailModal';

export const CustomersView: React.FC = () => {
  const { actorInfo, isAdmin } = useAuth();
  const { customers, sales, returns, vouchers, settings } = useStoreData();

  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedSale, setSelectedSale] = useState<SaleInvoice | null>(null);

  // Add/Edit Modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Receipt Voucher Modal (تسديد دين عميل)
  const [payCustomer, setPayCustomer] = useState<Customer | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [paying, setPaying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter(
      (c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.customerCode.toLowerCase().includes(q) ||
        (c.phone && c.phone.includes(q))
    );
  }, [customers, search]);

  const totalDebts = useMemo(
    () => customers.reduce((a, c) => a + Math.max(0, c.balanceDue), 0),
    [customers]
  );

  // Statement for selectedCustomer
  const statementData = useMemo(() => {
    if (!selectedCustomer) return { custSales: [], custReturns: [], custVouchers: [] };
    return {
      custSales: sales.filter((s) => s.customerId === selectedCustomer.id),
      custReturns: returns.filter((r) => r.customerId === selectedCustomer.id),
      custVouchers: vouchers.filter(
        (v) => v.partyType === 'customer' && v.partyId === selectedCustomer.id
      ),
    };
  }, [selectedCustomer, sales, returns, vouchers]);

  const liveSelectedCustomer = useMemo(
    () =>
      selectedCustomer
        ? customers.find((c) => c.id === selectedCustomer.id) || selectedCustomer
        : null,
    [selectedCustomer, customers]
  );

  const openAdd = () => {
    setEditingCustomer(null);
    setName('');
    setPhone('');
    setAddress('');
    setNotes('');
    setErrorMsg(null);
    setFormOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditingCustomer(c);
    setName(c.name);
    setPhone(c.phone || '');
    setAddress(c.address || '');
    setNotes(c.notes || '');
    setErrorMsg(null);
    setFormOpen(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorInfo) return;
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      if (editingCustomer) {
        await updateCustomer(actorInfo, editingCustomer, { name, phone, address, notes });
      } else {
        await createCustomer(actorInfo, { name, phone, address, notes });
      }
      setFormOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر حفظ بيانات العميل.');
    } finally {
      setSaving(false);
    }
  };

  const handleReceivePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorInfo || !payCustomer) return;
    setPaying(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const result = await recordVoucher(actorInfo, {
        type: 'receipt',
        partyType: 'customer',
        partyId: payCustomer.id,
        partyName: payCustomer.name,
        amount: Number(payAmount) || 0,
        notes: payNotes.trim() || 'تسديد دفعة من الحساب',
      });
      setSuccessMsg(
        result.queued
          ? `تم حفظ سند القبض (${result.voucherNumber}) للعميل ${payCustomer.name} محلياً وسيُزامن فور عودة الاتصال.`
          : `تم تسجيل سند القبض ${result.voucherNumber} وتحديث رصيد العميل والصندوق.`
      );
      setPayCustomer(null);
      setPayAmount('');
      setPayNotes('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تسجيل السند.');
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">إدارة العملاء وكشوف الحساب</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            سجل العملاء · إجمالي المشتريات والمدفوعات · الديون المتبقية · سندات القبض
          </p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة عميل جديد</span>
        </button>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">عدد العملاء المسجلين</div>
          <div className="text-xl font-bold font-mono-num text-slate-900 mt-1">
            {customers.length}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">إجمالي الديون المستحقة على العملاء</div>
          <div className="text-xl font-bold font-mono-num text-red-700 mt-1">
            {formatMoney(totalDebts, settings.currency)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">عملاء لديهم أرصدة مستحقة</div>
          <div className="text-xl font-bold font-mono-num text-amber-700 mt-1">
            {customers.filter((c) => c.balanceDue > 0).length}
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
          {successMsg}
        </div>
      )}

      {/* Search */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم العميل أو الكود أو الهاتف..."
            className="w-full pr-9 pl-3 py-2 text-sm border border-slate-200 rounded-lg"
          />
        </div>
      </div>

      {/* Customers Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            لا يوجد عملاء مسجلون بعد.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <tr>
                  <th className="text-right py-3 px-4 font-semibold">الكود</th>
                  <th className="text-right py-3 px-4 font-semibold">اسم العميل</th>
                  <th className="text-right py-3 px-4 font-semibold">الهاتف والعنوان</th>
                  <th className="text-left py-3 px-4 font-semibold">إجمالي المشتريات</th>
                  <th className="text-left py-3 px-4 font-semibold">المدفوع</th>
                  <th className="text-left py-3 px-4 font-semibold">المتبقي (الدين)</th>
                  <th className="text-center py-3 px-4 font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono-num text-xs font-semibold text-slate-600">
                      {c.customerCode}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{c.name}</div>
                      <div className="text-xs text-slate-400">
                        تاريخ التسجيل: {formatDateTime(c.createdAt)}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      <div className="font-mono-num">{c.phone || '—'}</div>
                      <div>{c.address || ''}</div>
                    </td>
                    <td className="py-3 px-4 text-left font-mono-num">
                      {formatMoney(c.totalPurchases, settings.currency)}
                    </td>
                    <td className="py-3 px-4 text-left font-mono-num text-emerald-700">
                      {formatMoney(c.totalPaid, settings.currency)}
                    </td>
                    <td className="py-3 px-4 text-left font-mono-num font-bold">
                      <span className={c.balanceDue > 0 ? 'text-red-700' : 'text-slate-700'}>
                        {formatMoney(c.balanceDue, settings.currency)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => setSelectedCustomer(c)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>كشف حساب</span>
                        </button>
                        <button
                          onClick={() => {
                            setPayCustomer(c);
                            setPayAmount(c.balanceDue > 0 ? String(c.balanceDue) : '');
                            setPayNotes('');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 cursor-pointer whitespace-nowrap"
                        >
                          <Banknote className="w-3.5 h-3.5" />
                          <span>قبض دفعة</span>
                        </button>
                        <button
                          onClick={() => openEdit(c)}
                          className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 cursor-pointer"
                          title="تعديل"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Customer Statement Modal */}
      {liveSelectedCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-3xl overflow-hidden print-container">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between no-print">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  كشف حساب العميل: {liveSelectedCustomer.name}
                </h3>
                <p className="text-xs text-slate-500 font-mono-num">
                  {liveSelectedCustomer.customerCode} · {liveSelectedCustomer.phone || 'بدون هاتف'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded-lg cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>طباعة الكشف</span>
                </button>
                <button
                  onClick={() => setSelectedCustomer(null)}
                  className="p-1.5 text-slate-500 hover:text-slate-900 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-3 gap-4 bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm">
                <div>
                  <div className="text-xs text-slate-500">إجمالي المشتريات</div>
                  <div className="font-bold font-mono-num text-slate-900 mt-0.5">
                    {formatMoney(liveSelectedCustomer.totalPurchases, settings.currency)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">إجمالي المدفوع</div>
                  <div className="font-bold font-mono-num text-emerald-700 mt-0.5">
                    {formatMoney(liveSelectedCustomer.totalPaid, settings.currency)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">الرصيد المتبقي (الدين)</div>
                  <div className="font-bold font-mono-num text-red-700 mt-0.5">
                    {formatMoney(liveSelectedCustomer.balanceDue, settings.currency)}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-bold text-slate-900">
                  سجل الفواتير ({statementData.custSales.length})
                </h4>
                {statementData.custSales.length === 0 ? (
                  <p className="text-xs text-slate-500">لا توجد فواتير مسجلة لهذا العميل.</p>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="text-right py-2 px-3">الفاتورة</th>
                          <th className="text-right py-2 px-3">التاريخ</th>
                          <th className="text-right py-2 px-3">البائع</th>
                          <th className="text-left py-2 px-3">الإجمالي</th>
                          <th className="text-left py-2 px-3">المدفوع</th>
                          <th className="text-left py-2 px-3">المتبقي</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {statementData.custSales.map((s) => (
                          <tr
                            key={s.id}
                            onClick={() => setSelectedSale(s)}
                            className="hover:bg-slate-50 cursor-pointer"
                          >
                            <td className="py-2 px-3 font-mono-num font-semibold text-emerald-700">
                              {s.invoiceNumber} ({paymentMethodLabel(s.paymentMethod)})
                            </td>
                            <td className="py-2 px-3 text-slate-500">
                              {formatDateTime(s.createdAt)}
                            </td>
                            <td className="py-2 px-3">{s.employeeName}</td>
                            <td className="py-2 px-3 text-left font-mono-num font-semibold">
                              {formatMoney(s.total, settings.currency)}
                            </td>
                            <td className="py-2 px-3 text-left font-mono-num text-emerald-700">
                              {formatMoney(s.paidAmount, settings.currency)}
                            </td>
                            <td className="py-2 px-3 text-left font-mono-num text-red-700">
                              {formatMoney(s.remainingAmount, settings.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-bold text-slate-900">
                  سندات القبض والتسديد ({statementData.custVouchers.length})
                </h4>
                {statementData.custVouchers.length === 0 ? (
                  <p className="text-xs text-slate-500">لا توجد سندات قبض مسجلة.</p>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="text-right py-2 px-3">رقم السند</th>
                          <th className="text-right py-2 px-3">التاريخ</th>
                          <th className="text-right py-2 px-3">الملاحظات</th>
                          <th className="text-left py-2 px-3">المبلغ المقبوض</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {statementData.custVouchers.map((v) => (
                          <tr key={v.id}>
                            <td className="py-2 px-3 font-mono-num font-semibold">
                              {v.voucherNumber}
                            </td>
                            <td className="py-2 px-3 text-slate-500">
                              {formatDateTime(v.createdAt)}
                            </td>
                            <td className="py-2 px-3">{v.notes || '—'}</td>
                            <td className="py-2 px-3 text-left font-mono-num font-bold text-emerald-700">
                              {formatMoney(v.amount, settings.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Customer Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveCustomer}
            className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                {editingCustomer ? 'تعديل بيانات العميل' : 'إضافة عميل جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="p-1 text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  اسم العميل *
                </label>
                <input
                  required
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  رقم الهاتف
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  العنوان
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ملاحظات
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="px-4 py-2 text-xs border border-slate-200 rounded-lg cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg cursor-pointer"
              >
                {saving ? 'جاري الحفظ...' : 'حفظ'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Customer Payment Voucher Modal */}
      {payCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleReceivePayment}
            className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                سند قبض من العميل: {payCustomer.name}
              </h3>
              <button
                type="button"
                onClick={() => setPayCustomer(null)}
                className="p-1 text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              الرصيد المستحق حالياً:{' '}
              <strong className="font-mono-num text-red-700">
                {formatMoney(payCustomer.balanceDue, settings.currency)}
              </strong>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  المبلغ المستلم ({settings.currency}) *
                </label>
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ملاحظات السند
                </label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="مثال: دفعة نقدية من الحساب"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPayCustomer(null)}
                className="px-4 py-2 text-xs border border-slate-200 rounded-lg cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={paying}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg cursor-pointer"
              >
                {paying ? 'جاري التسجيل...' : 'تأكيد القبض وتحديث الصندوق'}
              </button>
            </div>
          </form>
        </div>
      )}

      <InvoiceDetailModal
        sale={selectedSale}
        onClose={() => setSelectedSale(null)}
        showProfit={isAdmin}
      />
    </div>
  );
};
