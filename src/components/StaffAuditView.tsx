import React, { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  Download,
  Edit2,
  Monitor,
  MonitorSmartphone,
  ShieldCheck,
  Smartphone,
  Tablet,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useStoreData } from '../contexts/StoreDataContext';
import {
  createStaffInvite,
  deleteDeviceRecord,
  deleteStaffInvite,
  exportStoreBackup,
  renameDeviceRecord,
  restoreStoreBackup,
  setDeviceStatus,
  updateStoreSettings,
  updateUserAccount,
} from '../services/accountingService';
import {
  ADMIN_PERMISSIONS,
  DEFAULT_EMPLOYEE_PERMISSIONS,
  PERMISSION_LABELS,
  type DeviceRecord,
  type UserPermissions,
  type UserProfile,
} from '../types';
import { deviceTypeLabel } from '../utils/device';
import { saveTextFileCrossPlatform } from '../utils/exportExcel';
import { formatDateTime } from '../utils/format';

export const StaffAuditView: React.FC = () => {
  const { actorInfo, deviceIdentity } = useAuth();
  const { staffUsers, staffInvites, auditLogs, devices, settings } = useStoreData();

  const [tab, setTab] = useState<'staff' | 'devices' | 'audit' | 'settings'>('staff');

  // Invite form
  const [invEmail, setInvEmail] = useState('');
  const [invName, setInvName] = useState('');
  const [invRole, setInvRole] = useState<'employee' | 'admin'>('employee');
  const [invPerms, setInvPerms] = useState<UserPermissions>({
    ...DEFAULT_EMPLOYEE_PERMISSIONS,
  });

  // Edit user modal
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<'admin' | 'employee'>('employee');
  const [editStatus, setEditStatus] = useState<'active' | 'suspended'>('active');
  const [editPerms, setEditPerms] = useState<UserPermissions>({
    ...DEFAULT_EMPLOYEE_PERMISSIONS,
  });

  // Device rename modal
  const [renamingDevice, setRenamingDevice] = useState<DeviceRecord | null>(null);
  const [renameDevInput, setRenameDevInput] = useState('');

  // Store settings form
  const [storeName, setStoreName] = useState(settings.storeName);
  const [storePhone, setStorePhone] = useState(settings.phone || '');
  const [storeAddress, setStoreAddress] = useState(settings.address || '');
  const [currency, setCurrency] = useState(settings.currency || 'ر.ي');
  const [receiptFooter, setReceiptFooter] = useState(settings.receiptFooter || '');

  useEffect(() => {
    setStoreName(settings.storeName || 'بقالة الحسام');
    setStorePhone(settings.phone || '');
    setStoreAddress(settings.address || '');
    setCurrency(settings.currency || 'ر.ي');
    setReceiptFooter(settings.receiptFooter || '');
  }, [settings]);

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  const sortedStaffUsers = useMemo(() => {
    const rank = (u: UserProfile) => (u.status === 'pending' ? 0 : u.status === 'active' ? 1 : 2);
    return [...staffUsers].sort((a, b) => rank(a) - rank(b));
  }, [staffUsers]);

  const pendingUsersCount = useMemo(
    () => staffUsers.filter((u) => u.status === 'pending').length,
    [staffUsers]
  );

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorInfo) return;
    setSaving(true);
    setFeedback(null);
    try {
      await createStaffInvite(actorInfo, {
        email: invEmail,
        name: invName,
        role: invRole,
        permissions: invRole === 'admin' ? ADMIN_PERMISSIONS : invPerms,
      });
      setInvEmail('');
      setInvName('');
      setInvPerms({ ...DEFAULT_EMPLOYEE_PERMISSIONS });
      setFeedback({
        type: 'ok',
        text: 'تم تسجيل الموظف في قائمة الدعوات المفعلة. بمجرد دخوله بحساب Google سيحصل على صلاحياته فوراً.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر إضافة الدعوة.',
      });
    } finally {
      setSaving(false);
    }
  };

  const openEditUser = (u: UserProfile) => {
    setEditingUser(u);
    setEditName(u.displayName);
    setEditRole(u.role === 'admin' ? 'admin' : 'employee');
    setEditStatus(u.status === 'suspended' ? 'suspended' : 'active');
    setEditPerms({ ...DEFAULT_EMPLOYEE_PERMISSIONS, ...(u.permissions || {}) });
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || !actorInfo) return;
    setSaving(true);
    setFeedback(null);
    try {
      await updateUserAccount(actorInfo, editingUser, {
        displayName: editName,
        role: editRole,
        status: editStatus,
        permissions: editPerms,
      });
      setEditingUser(null);
      setFeedback({ type: 'ok', text: 'تم تحديث حساب الموظف وصلاحياته.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر تحديث الحساب.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDeviceRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingDevice || !actorInfo || !renameDevInput.trim()) return;
    setSaving(true);
    setFeedback(null);
    try {
      await renameDeviceRecord(actorInfo, renamingDevice.deviceId, renameDevInput.trim());
      setRenamingDevice(null);
      setFeedback({ type: 'ok', text: 'تم تحديث اسم الجهاز بنجاح.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر تغيير اسم الجهاز.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleDeviceStatus = async (dev: DeviceRecord) => {
    if (!actorInfo || dev.deviceId === deviceIdentity.deviceId) return;
    setSaving(true);
    setFeedback(null);
    const nextStatus = dev.status === 'blocked' ? 'active' : 'blocked';
    try {
      await setDeviceStatus(actorInfo, dev, nextStatus);
      setFeedback({
        type: 'ok',
        text:
          nextStatus === 'blocked'
            ? `تم حظر الجهاز "${dev.deviceName}" ومنعه من الوصول للنظام.`
            : `تم إعادة تفعيل الجهاز "${dev.deviceName}".`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر تغيير حالة الجهاز.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDevice = async (dev: DeviceRecord) => {
    if (!actorInfo || dev.deviceId === deviceIdentity.deviceId) return;
    setSaving(true);
    setFeedback(null);
    try {
      await deleteDeviceRecord(actorInfo, dev);
      setFeedback({
        type: 'ok',
        text: `تم حذف سجل الجهاز "${dev.deviceName}".`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر حذف الجهاز.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorInfo) return;
    setSaving(true);
    setFeedback(null);
    try {
      await updateStoreSettings(actorInfo, {
        storeName,
        phone: storePhone,
        address: storeAddress,
        currency,
        receiptFooter,
      });
      setFeedback({ type: 'ok', text: 'تم حفظ إعدادات بقالة الحسام.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر حفظ الإعدادات.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleBackupDownload = async () => {
    setSaving(true);
    try {
      const json = await exportStoreBackup();
      const ok = saveTextFileCrossPlatform(
        json,
        `alhussam_backup_${new Date().toISOString().slice(0, 10)}.json`,
        'application/json'
      );
      if (!ok) {
        throw new Error('تعذر حفظ ملف النسخة الاحتياطية على الجهاز.');
      }
      setFeedback({ type: 'ok', text: 'تم تنزيل ملف النسخة الاحتياطية بنجاح.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر تصدير النسخة الاحتياطية.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleBackupRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !actorInfo) return;
    setSaving(true);
    setFeedback(null);
    try {
      const text = await file.text();
      const count = await restoreStoreBackup(actorInfo, text);
      setFeedback({
        type: 'ok',
        text: `تمت استعادة ${count} سجل من النسخة الاحتياطية بنجاح.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر استعادة النسخة الاحتياطية.',
      });
    } finally {
      setSaving(false);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            إدارة الموظفين وسجل التدقيق والإعدادات
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            إضافة وتعديل وإيقاف حسابات البائعين · سجل التدقيق غير القابل للتعديل · النسخ الاحتياطي
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl max-w-full overflow-x-auto">
          <button
            onClick={() => setTab('staff')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap shrink-0 ${
              tab === 'staff' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            الموظفون والصلاحيات ({staffUsers.length})
            {pendingUsersCount > 0 ? ` · ${pendingUsersCount} معلق` : ''}
          </button>
          <button
            onClick={() => setTab('devices')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap shrink-0 ${
              tab === 'devices' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            الأجهزة والمراقبة ({devices.length})
          </button>
          <button
            onClick={() => setTab('audit')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap shrink-0 ${
              tab === 'audit' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            سجل التدقيق ({auditLogs.length})
          </button>
          <button
            onClick={() => setTab('settings')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap shrink-0 ${
              tab === 'settings' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            الإعدادات والنسخ الاحتياطي
          </button>
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

      {tab === 'staff' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Invite Employee Form */}
          <form
            onSubmit={handleCreateInvite}
            className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
          >
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <UserPlus className="w-4 h-4 text-emerald-700" />
              <h2 className="text-sm font-bold text-slate-900">
                إضافة موظف / بائع جديد
              </h2>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  اسم الموظف *
                </label>
                <input
                  required
                  type="text"
                  value={invName}
                  onChange={(e) => setInvName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  البريد الإلكتروني (Google) *
                </label>
                <input
                  required
                  type="email"
                  value={invEmail}
                  onChange={(e) => setInvEmail(e.target.value)}
                  placeholder="employee@gmail.com"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  نوع الحساب
                </label>
                <select
                  value={invRole}
                  onChange={(e) =>
                    setInvRole(e.target.value as 'employee' | 'admin')
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="employee">موظف / بائع (بصلاحيات محددة)</option>
                  <option value="admin">مسؤول رئيسي (صلاحية كاملة)</option>
                </select>
              </div>

              {invRole === 'employee' && (
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <div className="text-xs font-semibold text-slate-700">
                    صلاحيات الموظف المسموحة:
                  </div>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
                    {(Object.keys(PERMISSION_LABELS) as (keyof UserPermissions)[]).map(
                      (key) => (
                        <label
                          key={key}
                          className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={invPerms[key]}
                            onChange={(e) =>
                              setInvPerms((prev) => ({
                                ...prev,
                                [key]: e.target.checked,
                              }))
                            }
                          />
                          <span>{PERMISSION_LABELS[key]}</span>
                        </label>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl cursor-pointer"
            >
              إضافة الموظف وتفعيل الصلاحيات
            </button>
          </form>

          {/* Users & Invites List */}
          <div className="lg:col-span-7 space-y-5">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200">
                <h2 className="text-sm font-bold text-slate-900">
                  الحسابات المسجلة ({staffUsers.length})
                </h2>
              </div>
              <div className="divide-y divide-slate-100">
                {sortedStaffUsers.map((u) => (
                  <div
                    key={u.id}
                    className={`p-4 flex flex-wrap items-center justify-between gap-3 ${
                      u.status === 'pending' ? 'bg-amber-50/60' : ''
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 text-sm">
                          {u.displayName}
                        </span>
                        {u.status === 'pending' && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                            طلب انضمام معلق
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-mono-num text-slate-500" dir="ltr">
                        {u.email}
                      </div>
                      <div className="text-xs mt-1">
                        <span className="font-medium text-slate-700">
                          {u.role === 'admin'
                            ? 'مسؤول رئيسي'
                            : u.role === 'employee'
                            ? 'موظف / بائع'
                            : 'بانتظار الاعتماد'}
                        </span>
                        {' · '}
                        <span
                          className={
                            u.status === 'active'
                              ? 'text-emerald-700 font-semibold'
                              : u.status === 'suspended'
                              ? 'text-red-700 font-semibold'
                              : 'text-amber-700 font-semibold'
                          }
                        >
                          {u.status === 'active'
                            ? 'نشط'
                            : u.status === 'suspended'
                            ? 'موقوف'
                            : 'معلق'}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => openEditUser(u)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
                        u.status === 'pending'
                          ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                          : 'text-slate-700 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {u.status === 'pending' ? 'اعتماد وتفعيل' : 'تعديل الصلاحيات / الحالة'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {staffInvites.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200">
                  <h2 className="text-sm font-bold text-slate-900">
                    دعوات الموظفين المسبقة ({staffInvites.length})
                  </h2>
                </div>
                <div className="divide-y divide-slate-100">
                  {staffInvites.map((inv) => (
                    <div
                      key={inv.id}
                      className="p-4 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-semibold text-slate-900">{inv.name}</div>
                        <div className="font-mono-num text-slate-500">{inv.email}</div>
                      </div>
                      <button
                        onClick={() => {
                          if (actorInfo) deleteStaffInvite(actorInfo, inv.id, inv.email);
                        }}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                        title="حذف الدعوة"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'devices' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MonitorSmartphone className="w-4 h-4 text-emerald-700" />
              <h2 className="text-sm font-bold text-slate-900">
                الأجهزة المتصلة ومراقبة العمليات ({devices.length})
              </h2>
            </div>
            <span className="text-xs text-slate-500">
              يمكن للمسؤول تسمية أي جهاز أو حظره فوراً لمنعه من إجراء أي عملية على السحابة
            </span>
          </div>

          {devices.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              لا توجد أجهزة مسجلة بعد.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="text-right py-2.5 px-4">الجهاز والمنصة</th>
                    <th className="text-right py-2.5 px-4">آخر مستخدم</th>
                    <th className="text-right py-2.5 px-4">آخر عملية</th>
                    <th className="text-right py-2.5 px-4">آخر نشاط</th>
                    <th className="text-right py-2.5 px-4">الحالة</th>
                    <th className="text-center py-2.5 px-4">إجراءات التحكم</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {devices.map((dev) => {
                    const isSelf = dev.deviceId === deviceIdentity.deviceId;
                    const DevIcon =
                      dev.deviceType === 'mobile'
                        ? Smartphone
                        : dev.deviceType === 'tablet'
                        ? Tablet
                        : Monitor;
                    return (
                      <tr
                        key={dev.id}
                        className={dev.status === 'blocked' ? 'bg-red-50/40' : 'hover:bg-slate-50'}
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <DevIcon className="w-4 h-4 text-slate-600 shrink-0" />
                            <div>
                              <div className="font-bold text-slate-900 text-sm">
                                {dev.deviceName}
                                {isSelf && (
                                  <span className="mr-1.5 text-[11px] font-semibold text-emerald-700">
                                    (هذا الجهاز)
                                  </span>
                                )}
                              </div>
                              <div className="text-slate-500">
                                {deviceTypeLabel(dev.deviceType)} · {dev.platform}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{dev.userName}</div>
                          <div className="text-slate-500 font-mono-num" dir="ltr">
                            {dev.userEmail}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {dev.userRole === 'admin' ? 'مسؤول' : 'موظف'}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-700 max-w-xs">
                          {dev.lastOperationSummary || '—'}
                        </td>
                        <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                          {formatDateTime(dev.lastActiveAt)}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`font-semibold ${
                              dev.status === 'active' ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {dev.status === 'active' ? 'نشط ومسموح' : 'محظور'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingDevice(dev);
                                setRenameDevInput(dev.deviceName);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                              title="تغيير اسم الجهاز"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                              <span>تسمية</span>
                            </button>
                            <button
                              type="button"
                              disabled={isSelf || saving}
                              onClick={() => handleToggleDeviceStatus(dev)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 border rounded-lg cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
                                dev.status === 'blocked'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                  : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                              }`}
                              title={isSelf ? 'لا يمكنك حظر جهازك الحالي' : undefined}
                            >
                              {dev.status === 'blocked' ? (
                                <>
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>تفعيل</span>
                                </>
                              ) : (
                                <>
                                  <Ban className="w-3.5 h-3.5" />
                                  <span>حظر</span>
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              disabled={isSelf || saving}
                              onClick={() => handleDeleteDevice(dev)}
                              className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              title={isSelf ? 'لا يمكنك حذف جهازك الحالي' : 'حذف سجل الجهاز'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-700" />
            <h2 className="text-sm font-bold text-slate-900">
              سجل التدقيق الأمني والمحاسبي (محمي وغير قابل للتعديل أو الحذف)
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="text-right py-2.5 px-4">التاريخ والوقت</th>
                  <th className="text-right py-2.5 px-4">المنفذ</th>
                  <th className="text-right py-2.5 px-4">الجهاز</th>
                  <th className="text-right py-2.5 px-4">العملية</th>
                  <th className="text-right py-2.5 px-4">التفاصيل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-slate-900">
                      {log.actorName} (
                      {log.actorRole === 'admin' ? 'مسؤول' : 'موظف'})
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">
                      {log.deviceName || '—'}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-emerald-800">
                      {log.action}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700">
                      <div>{log.summary}</div>
                      {log.details && (
                        <div className="text-slate-400 mt-0.5">{log.details}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <form
            onSubmit={handleSaveSettings}
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
              بيانات المحل والفواتير
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  اسم المحل
                </label>
                <input
                  required
                  type="text"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  العملة
                </label>
                <div className="flex items-center gap-2">
                  <input
                    required
                    type="text"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => setCurrency('ر.ي')}
                    className="px-3 py-2 text-xs font-semibold border border-emerald-200 bg-emerald-50 text-emerald-800 rounded-lg hover:bg-emerald-100 cursor-pointer whitespace-nowrap"
                  >
                    استخدام الريال اليمني (ر.ي)
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  رقم الهاتف
                </label>
                <input
                  type="text"
                  value={storePhone}
                  onChange={(e) => setStorePhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  العنوان
                </label>
                <input
                  type="text"
                  value={storeAddress}
                  onChange={(e) => setStoreAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  تذييل الفاتورة
                </label>
                <input
                  type="text"
                  value={receiptFooter}
                  onChange={(e) => setReceiptFooter(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl cursor-pointer"
            >
              حفظ الإعدادات
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
              النسخ الاحتياطي واستعادة البيانات
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              احفظ نسخة احتياطية كاملة لجميع بيانات بقالة الحسام (الأصناف، العملاء، الموردون، الفواتير، الحركات المالية) بصيغة JSON، أو استعد بيانات سابقة عند الحاجة.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={handleBackupDownload}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>تصدير نسخة احتياطية (JSON)</span>
              </button>

              <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-xl cursor-pointer">
                <Upload className="w-4 h-4" />
                <span>استعادة من ملف JSON</span>
                <input
                  type="file"
                  accept="application/json"
                  onChange={handleBackupRestore}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveUser}
            className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                إدارة حساب: {editingUser.displayName}
              </h3>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="p-1 text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  الاسم
                </label>
                <input
                  required
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الدور
                  </label>
                  <select
                    value={editRole}
                    onChange={(e) =>
                      setEditRole(e.target.value as 'admin' | 'employee')
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="employee">موظف / بائع</option>
                    <option value="admin">مسؤول رئيسي</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الحالة
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) =>
                      setEditStatus(e.target.value as 'active' | 'suspended')
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="active">نشط</option>
                    <option value="suspended">موقوف</option>
                  </select>
                </div>
              </div>

              {editRole === 'employee' && (
                <div className="space-y-1.5 border-t border-slate-100 pt-3 max-h-52 overflow-y-auto">
                  {(Object.keys(PERMISSION_LABELS) as (keyof UserPermissions)[]).map(
                    (key) => (
                      <label
                        key={key}
                        className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={editPerms[key]}
                          onChange={(e) =>
                            setEditPerms((prev) => ({
                              ...prev,
                              [key]: e.target.checked,
                            }))
                          }
                        />
                        <span>{PERMISSION_LABELS[key]}</span>
                      </label>
                    )
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="px-4 py-2 text-xs border border-slate-200 rounded-lg cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg cursor-pointer"
              >
                حفظ التغييرات
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Rename Device Modal */}
      {renamingDevice && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveDeviceRename}
            className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                تغيير اسم الجهاز
              </h3>
              <button
                type="button"
                onClick={() => setRenamingDevice(null)}
                className="p-1 text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                اسم الجهاز الجديد *
              </label>
              <input
                required
                type="text"
                value={renameDevInput}
                onChange={(e) => setRenameDevInput(e.target.value)}
                placeholder="مثال: كاشير البوابة / هاتف أحمد"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenamingDevice(null)}
                className="px-4 py-2 text-xs border border-slate-200 rounded-lg cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg cursor-pointer"
              >
                حفظ الاسم
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
