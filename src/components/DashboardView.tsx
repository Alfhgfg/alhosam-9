import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  FileText,
  MonitorSmartphone,
  Package,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useStoreData } from '../contexts/StoreDataContext';
import type { NavSection, SaleInvoice } from '../types';
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  isSameDay,
  paymentMethodLabel,
  saleStatusLabel,
} from '../utils/format';
import { InvoiceDetailModal } from './InvoiceDetailModal';

interface DashboardViewProps {
  onNavigate: (sec: NavSection) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const { isAdmin, hasPermission } = useAuth();
  const {
    settings,
    counters,
    products,
    customers,
    suppliers,
    sales,
    returns,
    expenses,
    auditLogs,
    devices,
    pendingOperations,
    dataLoading,
  } = useStoreData();

  const [selectedSale, setSelectedSale] = useState<SaleInvoice | null>(null);

  const metrics = useMemo(() => {
    const validSales = sales.filter((s) => s.status !== 'cancelled');
    const todaySales = validSales.filter((s) => isSameDay(s.createdAt));

    const todaySalesTotal = todaySales.reduce((acc, s) => acc + s.total, 0);
    const todayReturnsTotal = returns
      .filter((r) => isSameDay(r.createdAt))
      .reduce((acc, r) => acc + r.refundAmount, 0);
    const netTodaySales = Math.max(0, todaySalesTotal - todayReturnsTotal);

    const grossProfitTotal = validSales.reduce((acc, s) => acc + s.netProfit, 0);
    const returnedProfitTotal = returns.reduce((acc, r) => acc + r.returnedProfit, 0);
    const totalExpenses = expenses.reduce((acc, e) => acc + e.amount, 0);
    const netProfit = grossProfitTotal - returnedProfitTotal - totalExpenses;

    const todayProfit =
      todaySales.reduce((acc, s) => acc + s.netProfit, 0) -
      returns
        .filter((r) => isSameDay(r.createdAt))
        .reduce((acc, r) => acc + r.returnedProfit, 0) -
      expenses
        .filter((e) => isSameDay(e.createdAt))
        .reduce((acc, e) => acc + e.amount, 0);

    const inventoryCostValue = products.reduce(
      (acc, p) => acc + p.stock * p.costPrice,
      0
    );
    const customerDebts = customers.reduce((acc, c) => acc + Math.max(0, c.balanceDue), 0);
    const supplierPayables = suppliers.reduce(
      (acc, s) => acc + Math.max(0, s.balanceDue),
      0
    );
    const lowStockProducts = products.filter((p) => p.stock <= p.minStock);

    // Top selling products
    const productStats = new Map<
      string,
      { code: string; name: string; qty: number; revenue: number }
    >();
    for (const s of validSales) {
      for (const it of s.items) {
        const cur = productStats.get(it.productId) || {
          code: it.code,
          name: it.name,
          qty: 0,
          revenue: 0,
        };
        cur.qty += it.qty;
        cur.revenue += it.lineTotal;
        productStats.set(it.productId, cur);
      }
    }
    const topProducts = Array.from(productStats.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 6);

    // Employee activity
    const empMap = new Map<
      string,
      {
        employeeId: string;
        employeeName: string;
        count: number;
        total: number;
        paid: number;
        lastAt: SaleInvoice['createdAt'];
      }
    >();
    for (const s of validSales) {
      const cur = empMap.get(s.employeeId) || {
        employeeId: s.employeeId,
        employeeName: s.employeeName,
        count: 0,
        total: 0,
        paid: 0,
        lastAt: s.createdAt,
      };
      cur.count += 1;
      cur.total += s.total;
      cur.paid += s.paidAmount;
      empMap.set(s.employeeId, cur);
    }
    const employeeActivity = Array.from(empMap.values()).sort(
      (a, b) => b.total - a.total
    );

    return {
      netTodaySales,
      todayInvoiceCount: todaySales.length,
      netProfit,
      todayProfit,
      totalExpenses,
      inventoryCostValue,
      customerDebts,
      supplierPayables,
      lowStockProducts,
      topProducts,
      employeeActivity,
    };
  }, [sales, returns, expenses, products, customers, suppliers]);

  const canViewFinances = isAdmin || hasPermission('canViewReports');

  if (dataLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header action strip */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {isAdmin ? 'لوحة تحكم المسؤول' : 'ملخص المبيعات اليومية'}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            متابعة لحظية للمبيعات والمخزون وحركة الموظفين في {settings.storeName}
          </p>
        </div>
        <button
          onClick={() => onNavigate('pos')}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap"
        >
          <span>فتح شاشة البيع السريع</span>
          <ArrowUpRight className="w-4 h-4" />
        </button>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>صافي مبيعات اليوم</span>
            <Banknote className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="text-2xl font-bold text-slate-900 font-mono-num">
            {formatMoney(metrics.netTodaySales, settings.currency)}
          </div>
          <div className="text-xs text-slate-500">
            عدد فواتير اليوم:{' '}
            <span className="font-mono-num font-semibold text-slate-800">
              {metrics.todayInvoiceCount}
            </span>
          </div>
        </div>

        {canViewFinances ? (
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>صافي الأرباح التراكمي</span>
              <TrendingUp className="w-4 h-4 text-emerald-700" />
            </div>
            <div className="text-2xl font-bold text-emerald-700 font-mono-num">
              {formatMoney(metrics.netProfit, settings.currency)}
            </div>
            <div className="text-xs text-slate-500">
              ربح اليوم الصافي:{' '}
              <span className="font-mono-num font-semibold text-slate-800">
                {formatMoney(metrics.todayProfit, settings.currency)}
              </span>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>فواتيري المسجلة</span>
              <FileText className="w-4 h-4 text-slate-600" />
            </div>
            <div className="text-2xl font-bold text-slate-900 font-mono-num">
              {sales.length}
            </div>
            <div className="text-xs text-slate-500">إجمالي العمليات المسجلة بحسابك</div>
          </div>
        )}

        {canViewFinances && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>الصندوق النقدي</span>
              <Wallet className="w-4 h-4 text-slate-600" />
            </div>
            <div className="text-2xl font-bold text-slate-900 font-mono-num">
              {formatMoney(counters.cashBalance, settings.currency)}
            </div>
            <div className="text-xs text-slate-500">
              إجمالي المصروفات:{' '}
              <span className="font-mono-num font-semibold text-red-700">
                {formatMoney(metrics.totalExpenses, settings.currency)}
              </span>
            </div>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>قيمة المخزون (بالتكلفة)</span>
            <Package className="w-4 h-4 text-slate-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900 font-mono-num">
            {formatMoney(metrics.inventoryCostValue, settings.currency)}
          </div>
          <div className="text-xs text-slate-500">
            عدد الأصناف:{' '}
            <span className="font-mono-num font-semibold text-slate-800">
              {products.length}
            </span>{' '}
            · منخفض:{' '}
            <span className="font-mono-num font-semibold text-amber-700">
              {metrics.lowStockProducts.length}
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>العملاء والديون المستحقة</span>
            <Users className="w-4 h-4 text-slate-600" />
          </div>
          <div className="text-2xl font-bold text-red-700 font-mono-num">
            {formatMoney(metrics.customerDebts, settings.currency)}
          </div>
          <div className="text-xs text-slate-500">
            عدد العملاء المسجلين:{' '}
            <span className="font-mono-num font-semibold text-slate-800">
              {customers.length}
            </span>
          </div>
        </div>

        {canViewFinances && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>مستحقات الموردين</span>
              <FileText className="w-4 h-4 text-slate-600" />
            </div>
            <div className="text-2xl font-bold text-slate-900 font-mono-num">
              {formatMoney(metrics.supplierPayables, settings.currency)}
            </div>
            <div className="text-xs text-slate-500">
              عدد الموردين:{' '}
              <span className="font-mono-num font-semibold text-slate-800">
                {suppliers.length}
              </span>
            </div>
          </div>
        )}

        {isAdmin && (
          <div
            onClick={() => onNavigate('staff')}
            className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 hover:border-emerald-500 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>الأجهزة المتصلة</span>
              <MonitorSmartphone className="w-4 h-4 text-emerald-700" />
            </div>
            <div className="text-2xl font-bold text-slate-900 font-mono-num">
              {devices.filter((d) => d.status === 'active').length}
              <span className="text-xs font-normal text-slate-400 mr-1.5">
                / {devices.length}
              </span>
            </div>
            <div className="text-xs text-slate-500">
              محظور:{' '}
              <span className="font-mono-num font-semibold text-red-700">
                {devices.filter((d) => d.status === 'blocked').length}
              </span>
              {pendingOperations.length > 0 && (
                <>
                  {' '}· معلق:{' '}
                  <span className="font-mono-num font-semibold text-amber-700">
                    {pendingOperations.length}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Alerts + Top Products + Employee Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Sales Live Feed */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
            <div>
              <h2 className="text-base font-bold text-slate-900">آخر عمليات البيع (مباشر)</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                اضغط على أي عملية لعرض تفاصيل الفاتورة كاملة والأصناف والموظف
              </p>
            </div>
            <span className="text-xs font-mono-num text-slate-500">
              {sales.length} فاتورة
            </span>
          </div>

          {sales.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm text-slate-500">لا توجد عمليات بيع مسجلة حتى الآن.</p>
              <button
                onClick={() => onNavigate('pos')}
                className="px-4 py-2 bg-emerald-700 text-white text-xs font-semibold rounded-lg hover:bg-emerald-800 cursor-pointer"
              >
                تسجيل أول فاتورة بيع
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <tr>
                    <th className="text-right py-2.5 px-4 font-semibold">الفاتورة</th>
                    <th className="text-right py-2.5 px-4 font-semibold">الموظف</th>
                    <th className="text-right py-2.5 px-4 font-semibold">العميل</th>
                    <th className="text-left py-2.5 px-4 font-semibold">الإجمالي</th>
                    <th className="text-left py-2.5 px-4 font-semibold">المدفوع / المتبقي</th>
                    <th className="text-right py-2.5 px-4 font-semibold">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sales.slice(0, 12).map((sale) => (
                    <tr
                      key={sale.id}
                      onClick={() => setSelectedSale(sale)}
                      className="hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-4">
                        <div className="font-mono-num font-semibold text-slate-900">
                          {sale.invoiceNumber}
                        </div>
                        <div className="text-xs text-slate-500">
                          {formatDateTime(sale.createdAt)}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-slate-700">{sale.employeeName}</div>
                        {sale.deviceName && (
                          <div className="text-[11px] text-slate-400">
                            {sale.deviceName}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-slate-900 font-medium">{sale.customerName}</div>
                        <div className="text-xs text-slate-500">
                          {sale.items.length} صنف · {paymentMethodLabel(sale.paymentMethod)}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-left font-mono-num font-bold text-slate-900">
                        {formatMoney(sale.total, settings.currency)}
                      </td>
                      <td className="py-3 px-4 text-left font-mono-num text-xs">
                        <div className="text-emerald-700 font-semibold">
                          مدفوع: {formatMoney(sale.paidAmount, settings.currency)}
                        </div>
                        {sale.remainingAmount > 0 && (
                          <div className="text-red-700">
                            متبقي: {formatMoney(sale.remainingAmount, settings.currency)}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs font-medium">
                        {sale.isOfflinePending ? (
                          <span className="text-amber-700 font-semibold">قيد المزامنة</span>
                        ) : (
                          <span
                            className={
                              sale.status === 'cancelled'
                                ? 'text-red-700'
                                : sale.status === 'completed'
                                ? 'text-emerald-700'
                                : 'text-amber-700'
                            }
                          >
                            {saleStatusLabel(sale.status)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Side: Stock Alerts & Top Products */}
        <div className="space-y-6">
          {/* Low stock alerts */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <h2 className="text-sm font-bold text-slate-900">تنبيهات المخزون</h2>
              </div>
              <button
                onClick={() => onNavigate('inventory')}
                className="text-xs font-medium text-emerald-700 hover:underline cursor-pointer"
              >
                فتح المخزون
              </button>
            </div>
            {metrics.lowStockProducts.length === 0 ? (
              <div className="p-5 text-xs text-slate-500">
                جميع الأصناف متوفرة فوق الحد الأدنى.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {metrics.lowStockProducts.slice(0, 8).map((p) => (
                  <div
                    key={p.id}
                    className="px-5 py-3 flex items-center justify-between text-sm"
                  >
                    <div>
                      <div className="font-medium text-slate-900">{p.name}</div>
                      <div className="text-xs text-slate-500 font-mono-num">
                        كود: {p.code} · الحد الأدنى: {p.minStock}
                      </div>
                    </div>
                    <div
                      className={`font-mono-num font-bold text-sm ${
                        p.stock === 0 ? 'text-red-700' : 'text-amber-700'
                      }`}
                    >
                      {p.stock === 0 ? 'نفد (0)' : `${formatNumber(p.stock)} ${p.unit}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top selling products */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-900">الأصناف الأكثر مبيعاً</h2>
            </div>
            {metrics.topProducts.length === 0 ? (
              <div className="p-5 text-xs text-slate-500">لا توجد بيانات مبيعات بعد.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {metrics.topProducts.map((tp, idx) => (
                  <div
                    key={tp.code}
                    className="px-5 py-2.5 flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-xs font-mono-num text-slate-400 w-4">
                        {idx + 1}.
                      </span>
                      <div className="truncate">
                        <div className="font-medium text-slate-900 truncate">{tp.name}</div>
                        <div className="text-xs font-mono-num text-slate-500">{tp.code}</div>
                      </div>
                    </div>
                    <div className="text-left shrink-0">
                      <div className="font-mono-num font-semibold text-slate-900">
                        {formatNumber(tp.qty)} وحدة
                      </div>
                      <div className="text-xs font-mono-num text-slate-500">
                        {formatMoney(tp.revenue, settings.currency)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Admin Only: Employee Activity & Recent Audit Alerts */}
      {isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-900">نشاط الموظفين</h2>
              <button
                onClick={() => onNavigate('staff')}
                className="text-xs font-medium text-emerald-700 hover:underline cursor-pointer"
              >
                إدارة الموظفين
              </button>
            </div>
            {metrics.employeeActivity.length === 0 ? (
              <div className="p-5 text-xs text-slate-500">لا يوجد نشاط مسجل بعد.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                    <tr>
                      <th className="text-right py-2 px-4 font-semibold">الموظف</th>
                      <th className="text-center py-2 px-4 font-semibold">الفواتير</th>
                      <th className="text-left py-2 px-4 font-semibold">إجمالي المبيعات</th>
                      <th className="text-left py-2 px-4 font-semibold">آخر عملية</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {metrics.employeeActivity.map((emp) => (
                      <tr key={emp.employeeId}>
                        <td className="py-2.5 px-4 font-medium text-slate-900">
                          {emp.employeeName}
                        </td>
                        <td className="py-2.5 px-4 text-center font-mono-num">
                          {emp.count}
                        </td>
                        <td className="py-2.5 px-4 text-left font-mono-num font-semibold text-emerald-700">
                          {formatMoney(emp.total, settings.currency)}
                        </td>
                        <td className="py-2.5 px-4 text-left text-xs text-slate-500">
                          {formatDateTime(emp.lastAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-900">أحدث سجلات المراقبة والتدقيق</h2>
              <button
                onClick={() => onNavigate('staff')}
                className="text-xs font-medium text-emerald-700 hover:underline cursor-pointer"
              >
                عرض السجل الكامل
              </button>
            </div>
            {auditLogs.length === 0 ? (
              <div className="p-5 text-xs text-slate-500">لا توجد سجلات تدقيق بعد.</div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {auditLogs.slice(0, 8).map((log) => (
                  <div key={log.id} className="px-5 py-2.5 text-xs space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">
                        {log.action} · {log.actorName}
                        {log.deviceName ? (
                          <span className="text-slate-500 font-normal">
                            {' '}({log.deviceName})
                          </span>
                        ) : null}
                      </span>
                      <span className="text-slate-400">{formatDateTime(log.createdAt)}</span>
                    </div>
                    <p className="text-slate-600">{log.summary}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
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
