import React, { useMemo, useState } from 'react';
import { Camera, Edit2, Plus, Search, Trash2, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useStoreData } from '../contexts/StoreDataContext';
import {
  createProduct,
  deleteProduct,
  updateProduct,
} from '../services/accountingService';
import type { Product } from '../types';
import { formatMoney, formatNumber } from '../utils/format';
import { CameraBarcodeModal } from './CameraBarcodeModal';

export const ProductsView: React.FC = () => {
  const { actorInfo, isAdmin, hasPermission } = useAuth();
  const { products, settings, counters } = useStoreData();

  const canManage = isAdmin || hasPermission('canManageProducts');

  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'low'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const [autoCode, setAutoCode] = useState(true);
  const [code, setCode] = useState('');
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('مواد غذائية');
  const [unit, setUnit] = useState('حبة');
  const [costPrice, setCostPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [stock, setStock] = useState('0');
  const [minStock, setMinStock] = useState('5');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (filterMode === 'low' && p.stock > p.minStock) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
      );
    });
  }, [products, searchQuery, filterMode]);

  const openAddModal = () => {
    setEditingProduct(null);
    setAutoCode(true);
    setCode('');
    setBarcode('');
    setName('');
    setCategory('مواد غذائية');
    setUnit('حبة');
    setCostPrice('');
    setSellPrice('');
    setStock('0');
    setMinStock('5');
    setDescription('');
    setIsActive(true);
    setErrorMsg(null);
    setModalOpen(true);
  };

  const openEditModal = (p: Product) => {
    setEditingProduct(p);
    setAutoCode(false);
    setCode(p.code);
    setBarcode(p.barcode || '');
    setName(p.name);
    setCategory(p.category);
    setUnit(p.unit);
    setCostPrice(String(p.costPrice));
    setSellPrice(String(p.sellPrice));
    setStock(String(p.stock));
    setMinStock(String(p.minStock));
    setDescription(p.description || '');
    setIsActive(p.isActive);
    setErrorMsg(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorInfo) return;
    setErrorMsg(null);
    setSaving(true);
    try {
      if (editingProduct) {
        await updateProduct(actorInfo, editingProduct, {
          barcode,
          name,
          category,
          description,
          unit,
          costPrice: Number(costPrice) || 0,
          sellPrice: Number(sellPrice) || 0,
          minStock: Number(minStock) || 0,
          isActive,
        });
      } else {
        await createProduct(actorInfo, {
          code: autoCode ? '' : code,
          barcode,
          name,
          category,
          description,
          unit,
          costPrice: Number(costPrice) || 0,
          sellPrice: Number(sellPrice) || 0,
          stock: Number(stock) || 0,
          minStock: Number(minStock) || 0,
        });
      }
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ الصنف.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: Product) => {
    if (!actorInfo || !isAdmin) return;
    try {
      await deleteProduct(actorInfo, p);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر حذف الصنف.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">إدارة الأصناف والأكواد</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            كود فريد لكل صنف · دعم الباركود · تنبيهات انخفاض المخزون · منع تكرار الأكواد
          </p>
        </div>
        {canManage && (
          <button
            onClick={openAddModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة صنف جديد</span>
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالكود أو الباركود أو اسم الصنف أو التصنيف..."
            className="w-full pr-9 pl-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
          />
        </div>
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            onClick={() => setFilterMode('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
              filterMode === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            جميع الأصناف ({products.length})
          </button>
          <button
            onClick={() => setFilterMode('low')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
              filterMode === 'low' ? 'bg-white text-amber-700 shadow-xs' : 'text-slate-600'
            }`}
          >
            مخزون منخفض ({products.filter((p) => p.stock <= p.minStock).length})
          </button>
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filteredProducts.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <p className="text-sm text-slate-500">لا توجد أصناف مسجلة بعد.</p>
            {canManage && (
              <button
                onClick={openAddModal}
                className="px-4 py-2 bg-emerald-700 text-white text-xs font-semibold rounded-lg hover:bg-emerald-800 cursor-pointer"
              >
                إضافة أول صنف
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <tr>
                  <th className="text-right py-3 px-4 font-semibold">الكود / الباركود</th>
                  <th className="text-right py-3 px-4 font-semibold">الصنف والتصنيف</th>
                  {isAdmin && (
                    <th className="text-left py-3 px-4 font-semibold">سعر الشراء</th>
                  )}
                  <th className="text-left py-3 px-4 font-semibold">سعر البيع</th>
                  <th className="text-center py-3 px-4 font-semibold">الكمية الحالية</th>
                  <th className="text-center py-3 px-4 font-semibold">الحد الأدنى</th>
                  <th className="text-right py-3 px-4 font-semibold">الحالة</th>
                  {canManage && (
                    <th className="text-center py-3 px-4 font-semibold">إجراءات</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProducts.map((p) => {
                  const isLow = p.stock <= p.minStock;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono-num">
                        <div className="font-semibold text-slate-900">{p.code}</div>
                        {p.barcode && (
                          <div className="text-xs text-slate-500">{p.barcode}</div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{p.name}</div>
                        <div className="text-xs text-slate-500">
                          {p.category} · {p.unit}
                        </div>
                      </td>
                      {isAdmin && (
                        <td className="py-3 px-4 text-left font-mono-num text-slate-700">
                          {formatMoney(p.costPrice, settings.currency)}
                        </td>
                      )}
                      <td className="py-3 px-4 text-left font-mono-num font-bold text-emerald-700">
                        {formatMoney(p.sellPrice, settings.currency)}
                      </td>
                      <td className="py-3 px-4 text-center font-mono-num font-semibold">
                        <span
                          className={
                            p.stock === 0
                              ? 'text-red-700'
                              : isLow
                              ? 'text-amber-700'
                              : 'text-slate-900'
                          }
                        >
                          {formatNumber(p.stock)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono-num text-slate-500">
                        {formatNumber(p.minStock)}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        {!p.isActive ? (
                          <span className="text-slate-500">موقوف</span>
                        ) : p.stock === 0 ? (
                          <span className="text-red-700 font-semibold">نفد المخزون</span>
                        ) : isLow ? (
                          <span className="text-amber-700 font-semibold">مخزون منخفض</span>
                        ) : (
                          <span className="text-emerald-700 font-medium">متوفر</span>
                        )}
                      </td>
                      {canManage && (
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => openEditModal(p)}
                              className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                              title="تعديل"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => handleDelete(p)}
                                className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
                                title="حذف"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSave}
            className="bg-white border border-slate-200 rounded-2xl w-full max-w-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingProduct ? `تعديل الصنف (${editingProduct.code})` : 'إضافة صنف جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                {errorMsg}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {!editingProduct && (
                <div className="sm:col-span-2 bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-700">
                      كود الصنف الفريد
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoCode}
                        onChange={(e) => setAutoCode(e.target.checked)}
                      />
                      <span>إنشاء تلقائي (HS-{counters.nextProductSeq})</span>
                    </label>
                  </div>
                  {!autoCode && (
                    <input
                      required
                      type="text"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="مثال: PROD-101 (حروف إنجليزية وأرقام فقط)"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white font-mono-num"
                      dir="ltr"
                    />
                  )}
                </div>
              )}

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  اسم الصنف *
                </label>
                <input
                  required
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: أرز بسمتي 5 كيلو"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  التصنيف *
                </label>
                <input
                  required
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  الوحدة *
                </label>
                <input
                  required
                  type="text"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="حبة / كرتون / كيلو"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  سعر الشراء ({settings.currency}) *
                </label>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={costPrice}
                  onChange={(e) => setCostPrice(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  سعر البيع ({settings.currency}) *
                </label>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={sellPrice}
                  onChange={(e) => setSellPrice(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num"
                />
              </div>

              {!editingProduct && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الكمية الافتتاحية
                  </label>
                  <input
                    required
                    type="number"
                    min="0"
                    step="any"
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  الحد الأدنى للمخزون
                </label>
                <input
                  required
                  type="number"
                  min="0"
                  step="any"
                  value={minStock}
                  onChange={(e) => setMinStock(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  الباركود (اختياري)
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setCameraOpen(true)}
                    className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg shrink-0 cursor-pointer"
                    title="التقاط الباركود بالكاميرا"
                  >
                    <Camera className="w-4 h-4" />
                    <span>مسح</span>
                  </button>
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  الوصف (اختياري)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>

              {editingProduct && (
                <label className="sm:col-span-2 inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                  />
                  <span>الصنف نشط ومتاح للبيع</span>
                </label>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
              >
                {saving ? 'جاري الحفظ...' : 'حفظ البيانات'}
              </button>
            </div>
          </form>
        </div>
      )}

      <CameraBarcodeModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        title="التقاط باركود الصنف بالكاميرا"
        onDetected={(scanned) => {
          const clean = scanned.trim();
          setBarcode(clean);
          return { ok: true, message: `تم التقاط الباركود: ${clean}` };
        }}
      />
    </div>
  );
};
