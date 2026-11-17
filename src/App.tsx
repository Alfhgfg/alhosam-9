import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Bell,
  Boxes,
  CheckCircle2,
  CloudOff,
  Laptop,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  RefreshCw,
  RotateCcw,
  Shield,
  ShoppingCart,
  Smartphone,
  Store,
  Tablet,
  Trash2,
  Truck,
  Users,
  Wallet,
  WifiOff,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { StoreDataProvider, useStoreData } from './contexts/StoreDataContext';
import { CustomersView } from './components/CustomersView';
import { DashboardView } from './components/DashboardView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FinanceView } from './components/FinanceView';
import { InventoryView } from './components/InventoryView';
import { LoginView } from './components/LoginView';
import { PosView } from './components/PosView';
import { ProductsView } from './components/ProductsView';
import { ReportsView } from './components/ReportsView';
import { ReturnsView } from './components/ReturnsView';
import { StaffAuditView } from './components/StaffAuditView';
import { SuppliersPurchasesView } from './components/SuppliersPurchasesView';
import type { NavSection, PendingOperationType } from './types';
import { deviceTypeLabel } from './utils/device';
import { formatDateTime } from './utils/format';

interface NavItem {
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  visible: boolean;
}

function pendingTypeLabel(t: PendingOperationType): string {
  switch (t) {
    case 'sale':
      return 'فاتورة مبيعات';
    case 'purchase':
      return 'فاتورة مشتريات';
    case 'return':
      return 'مرتجع عميل';
    case 'voucher':
      return 'سند قبض/صرف';
    case 'expense':
      return 'مصروف تشغيلي';
    case 'stock_adjust':
      return 'تعديل/جرد مخزون';
  }
}

const MainShell: React.FC = () => {
  const {
    firebaseUser,
    profile,
    loading,
    isAdmin,
    isActiveStaff,
    isDeviceBlocked,
    deviceIdentity,
    deviceRecord,
    hasPermission,
    updateCurrentDeviceName,
    logout,
  } = useAuth();
  const {
    settings,
    isOnline,
    hasPendingSync,
    pendingOperations,
    isSyncingQueue,
    syncNotice,
    recentSaleAlert,
    dismissSyncNotice,
    dismissSaleAlert,
    flushPendingQueue,
    retryPendingOperation,
    discardPendingOperation,
  } = useStoreData();

  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [queueModalOpen, setQueueModalOpen] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [deviceNameDraft, setDeviceNameDraft] = useState('');
  const [savingDeviceName, setSavingDeviceName] = useState(false);

  const navItems: NavItem[] = useMemo(
    () => [
      { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard, visible: true },
      { id: 'pos', label: 'نقطة البيع (الكاشير)', icon: ShoppingCart, visible: true },
      { id: 'products', label: 'الأصناف والأكواد', icon: Package, visible: true },
      { id: 'inventory', label: 'المخزون والجرد', icon: Boxes, visible: true },
      { id: 'customers', label: 'العملاء والديون', icon: Users, visible: true },
      {
        id: 'suppliers',
        label: 'المشتريات والموردون',
        icon: Truck,
        visible: isAdmin || hasPermission('canPurchase'),
      },
      {
        id: 'returns',
        label: 'المرتجعات والإلغاء',
        icon: RotateCcw,
        visible:
          isAdmin || hasPermission('canReturn') || hasPermission('canCancelInvoice'),
      },
      { id: 'finance', label: 'الحسابات والصندوق', icon: Wallet, visible: true },
      {
        id: 'reports',
        label: 'التقارير والتصدير',
        icon: BarChart3,
        visible: isAdmin || hasPermission('canViewReports'),
      },
      {
        id: 'staff',
        label: 'الموظفون والأجهزة والتدقيق',
        icon: Shield,
        visible: isAdmin,
      },
    ],
    [isAdmin, hasPermission]
  );

  if (loading || !firebaseUser || !isActiveStaff || isDeviceBlocked) {
    return <LoginView />;
  }

  const visibleNav = navItems.filter((n) => n.visible);
  const currentNav =
    visibleNav.find((n) => n.id === activeSection) || visibleNav[0];

  const currentDeviceName = deviceRecord?.deviceName || deviceIdentity.deviceName;
  const DeviceIcon =
    deviceIdentity.deviceType === 'mobile'
      ? Smartphone
      : deviceIdentity.deviceType === 'tablet'
      ? Tablet
      : Laptop;

  const conflictCount = pendingOperations.filter((o) => o.status === 'conflict').length;

  const handleSelectNav = (id: NavSection) => {
    setActiveSection(id);
    setMobileMenuOpen(false);
  };

  const openRenameModal = () => {
    setDeviceNameDraft(currentDeviceName);
    setRenameModalOpen(true);
  };

  const handleSaveDeviceName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceNameDraft.trim()) return;
    setSavingDeviceName(true);
    try {
      await updateCurrentDeviceName(deviceNameDraft);
      setRenameModalOpen(false);
    } finally {
      setSavingDeviceName(false);
    }
  };

  const renderSection = () => {
    switch (currentNav.id) {
      case 'dashboard':
        return <DashboardView onNavigate={handleSelectNav} />;
      case 'pos':
        return <PosView />;
      case 'products':
        return <ProductsView />;
      case 'inventory':
        return <InventoryView />;
      case 'customers':
        return <CustomersView />;
      case 'suppliers':
        return <SuppliersPurchasesView />;
      case 'returns':
        return <ReturnsView />;
      case 'finance':
        return <FinanceView />;
      case 'reports':
        return <ReportsView />;
      case 'staff':
        return <StaffAuditView />;
    }
  };

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white border-l border-slate-200 sticky top-0 h-screen no-print">
        <div className="h-16 px-5 border-b border-slate-200 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-700 text-white flex items-center justify-center shrink-0">
            <Store className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-slate-900 text-sm truncate">
              {settings.storeName}
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              {isAdmin ? 'حساب المسؤول الرئيسي' : 'حساب البائع'} · {settings.currency}
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = currentNav.id === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleSelectNav(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-emerald-700 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 space-y-2">
          <div className="px-3 py-2 bg-slate-50 rounded-xl space-y-1">
            <div className="text-xs font-semibold text-slate-900 truncate">
              {profile?.displayName}
            </div>
            <div className="text-[11px] font-mono-num text-slate-500 truncate" dir="ltr">
              {profile?.email}
            </div>
            <button
              type="button"
              onClick={openRenameModal}
              className="w-full flex items-center gap-1.5 text-[11px] text-emerald-700 font-medium hover:underline cursor-pointer pt-0.5"
              title="تعديل اسم الجهاز"
            >
              <DeviceIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{currentDeviceName}</span>
            </button>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 rounded-xl transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print">
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-72 max-w-[82vw] bg-white h-full flex flex-col border-l border-slate-200 z-10">
            <div className="h-14 px-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-700 text-white flex items-center justify-center">
                  <Store className="w-4 h-4" />
                </div>
                <span className="font-bold text-slate-900 text-sm">
                  {settings.storeName}
                </span>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {visibleNav.map((item) => {
                const Icon = item.icon;
                const active = currentNav.id === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelectNav(item.id)}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium cursor-pointer ${
                      active
                        ? 'bg-emerald-700 text-white'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="p-3 border-t border-slate-200 space-y-2">
              <div className="px-3 py-2 bg-slate-50 rounded-xl text-xs">
                <div className="font-semibold text-slate-900 truncate">
                  {profile?.displayName}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    openRenameModal();
                  }}
                  className="flex items-center gap-1.5 text-[11px] text-emerald-700 font-medium mt-1 cursor-pointer"
                >
                  <DeviceIcon className="w-3.5 h-3.5" />
                  <span>{currentDeviceName}</span>
                </button>
              </div>
              <button
                onClick={logout}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 rounded-xl cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>تسجيل الخروج</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="h-14 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-3 sticky top-0 z-30 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              aria-label="فتح القائمة"
              className="lg:hidden p-2 -mr-1 text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm font-semibold text-slate-900 truncate">
              {settings.storeName} <span className="text-slate-400">/</span>{' '}
              <span className="text-emerald-700">{currentNav.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={openRenameModal}
              className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-lg cursor-pointer whitespace-nowrap max-w-[170px]"
              title={`${deviceTypeLabel(deviceIdentity.deviceType)} · اضغط لتغيير اسم الجهاز`}
            >
              <DeviceIcon className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              <span className="truncate">{currentDeviceName}</span>
            </button>

            {pendingOperations.length > 0 && (
              <button
                type="button"
                onClick={() => setQueueModalOpen(true)}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border cursor-pointer whitespace-nowrap ${
                  conflictCount > 0
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}
              >
                {isSyncingQueue ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CloudOff className="w-3.5 h-3.5" />
                )}
                <span>
                  معلقة ({pendingOperations.length})
                  {conflictCount > 0 ? ` · تعارض (${conflictCount})` : ''}
                </span>
              </button>
            )}

            {!isOnline && (
              <div className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg whitespace-nowrap">
                <WifiOff className="w-3.5 h-3.5" />
                <span>غير متصل</span>
              </div>
            )}

            {isOnline && hasPendingSync && pendingOperations.length === 0 && (
              <div className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg whitespace-nowrap">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>جاري المزامنة</span>
              </div>
            )}

            {currentNav.id !== 'pos' && (
              <button
                onClick={() => handleSelectNav('pos')}
                className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                شاشة البيع
              </button>
            )}
          </div>
        </header>

        {/* Live Cloud Alerts */}
        {(recentSaleAlert || syncNotice) && (
          <div className="px-4 lg:px-6 pt-3 space-y-2 max-w-[1440px] w-full mx-auto no-print">
            {recentSaleAlert && (
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-medium">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>{recentSaleAlert}</span>
                </div>
                <button
                  onClick={dismissSaleAlert}
                  className="p-1 text-emerald-700 hover:text-emerald-900 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            {syncNotice && (
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-medium">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{syncNotice}</span>
                </div>
                <button
                  onClick={dismissSyncNotice}
                  className="p-1 text-slate-300 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}

        <main className="flex-1 p-3.5 sm:p-4 lg:p-6 pb-24 lg:pb-6 max-w-[1440px] w-full mx-auto">
          {renderSection()}
        </main>

        {/* Mobile Bottom Quick Navigation */}
        <nav
          aria-label="التنقل السريع"
          className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 px-2 pt-1.5 pb-[max(0.45rem,env(safe-area-inset-bottom))] grid grid-cols-5 gap-1 no-print"
        >
          {(
            [
              { id: 'dashboard', label: 'الرئيسية', icon: LayoutDashboard },
              { id: 'pos', label: 'الكاشير', icon: ShoppingCart },
              { id: 'products', label: 'الأصناف', icon: Package },
              { id: 'customers', label: 'العملاء', icon: Users },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = currentNav.id === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectNav(item.id)}
                className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl text-[11px] font-medium cursor-pointer transition-colors ${
                  active
                    ? 'text-emerald-700 bg-emerald-50 font-semibold'
                    : 'text-slate-600'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate max-w-full">{item.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl text-[11px] font-medium text-slate-600 cursor-pointer"
          >
            <Menu className="w-4 h-4 shrink-0" />
            <span>المزيد</span>
          </button>
        </nav>
      </div>

      {/* Rename Device Modal */}
      {renameModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 no-print">
          <form
            onSubmit={handleSaveDeviceName}
            className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">تسمية هذا الجهاز</h3>
              <button
                type="button"
                onClick={() => setRenameModalOpen(false)}
                className="p-1 text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">
                الاسم الظاهر للمسؤول وفي الفواتير *
              </label>
              <input
                required
                type="text"
                value={deviceNameDraft}
                onChange={(e) => setDeviceNameDraft(e.target.value)}
                placeholder="مثال: كاشير 1 أو هاتف محمد"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <div className="text-[11px] text-slate-500 font-mono-num">
                {deviceTypeLabel(deviceIdentity.deviceType)} · {deviceIdentity.platform}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRenameModalOpen(false)}
                className="px-4 py-2 text-xs border border-slate-200 rounded-lg cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={savingDeviceName}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg cursor-pointer"
              >
                {savingDeviceName ? 'جاري الحفظ...' : 'حفظ الاسم'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Pending Offline Queue Modal */}
      {queueModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto no-print">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  العمليات المعلقة بانتظار المزامنة ({pendingOperations.length})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  تُحفظ العمليات عند انقطاع الإنترنت وتُعالج تلقائياً بترتيب التسجيل دون تكرار عند عودة الاتصال
                </p>
              </div>
              <button
                onClick={() => setQueueModalOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {pendingOperations.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500">
                  جميع العمليات متزامنة مع السحابة ولا توجد عمليات معلقة.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl max-h-96 overflow-y-auto">
                  {pendingOperations.map((op) => (
                    <div key={op.operationId} className="p-4 space-y-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold text-slate-900">
                          {pendingTypeLabel(op.type)} ·{' '}
                          <span className="font-mono-num text-emerald-700">
                            {op.localTempRef}
                          </span>
                        </div>
                        <span
                          className={`font-semibold px-2 py-0.5 rounded-md ${
                            op.status === 'conflict'
                              ? 'bg-red-50 text-red-700'
                              : op.status === 'syncing'
                              ? 'bg-blue-50 text-blue-700'
                              : 'bg-amber-50 text-amber-800'
                          }`}
                        >
                          {op.status === 'conflict'
                            ? 'تعارض يتطلب معالجة'
                            : op.status === 'syncing'
                            ? 'جاري المزامنة...'
                            : 'بانتظار الاتصال'}
                        </span>
                      </div>
                      <div className="text-slate-700">{op.summary}</div>
                      <div className="text-slate-400">
                        {formatDateTime(op.createdAtIso)} · الموظف: {op.actor.name} · الجهاز:{' '}
                        {op.actor.deviceName}
                      </div>
                      {op.errorMessage && (
                        <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{op.errorMessage}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        {isOnline && (
                          <button
                            type="button"
                            onClick={() => retryPendingOperation(op.operationId)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-700 text-white rounded-lg cursor-pointer"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>إعادة المزامنة</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => discardPendingOperation(op.operationId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-red-700 bg-red-50 border border-red-200 rounded-lg cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>حذف من الانتظار</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <span className="text-xs text-slate-500">
                  الحالة الحالية: {isOnline ? 'متصل بالسحابة' : 'غير متصل بالإنترنت'}
                </span>
                <div className="flex items-center gap-2">
                  {isOnline && pendingOperations.length > 0 && (
                    <button
                      type="button"
                      disabled={isSyncingQueue}
                      onClick={() => flushPendingQueue()}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl cursor-pointer"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${isSyncingQueue ? 'animate-spin' : ''}`}
                      />
                      <span>مزامنة الكل الآن</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setQueueModalOpen(false)}
                    className="px-4 py-2 text-xs border border-slate-200 rounded-xl cursor-pointer"
                  >
                    إغلاق
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <StoreDataProvider>
          <MainShell />
        </StoreDataProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
