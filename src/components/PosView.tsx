import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Barcode,
  Camera,
  CheckCircle2,
  Minus,
  Plus,
  ScanBarcode,
  Search,
  ShoppingCart,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useStoreData } from '../contexts/StoreDataContext';
import { createCustomer, executeSale } from '../services/accountingService';
import type { Customer, PaymentMethod, Product, SaleInvoice } from '../types';
import { formatMoney, formatNumber, generateDocId, roundMoney } from '../utils/format';
import { CameraBarcodeModal } from './CameraBarcodeModal';
import { InvoiceDetailModal } from './InvoiceDetailModal';

interface CartLine {
  product: Product;
  qty: number;
  unitPrice: number;
}

export const PosView: React.FC = () => {
  const { actorInfo, isAdmin, hasPermission } = useAuth();
  const {
    products,
    customers,
    settings,
    productByCode,
    reservedStockByProductId,
    isOnline,
  } = useStoreData();

  const [codeInput, setCodeInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('الكل');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paidAmountInput, setPaidAmountInput] = useState<string>('');
  const [discountInput, setDiscountInput] = useState<string>('0');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [scanToast, setScanToast] = useState<string | null>(null);
  const [scannerEnabled, setScannerEnabled] = useState(true);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [completedSale, setCompletedSale] = useState<SaleInvoice | null>(null);

  // Quick add customer modal
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [savingCustomer, setSavingCustomer] = useState(false);

  const codeFieldRef = useRef<HTMLInputElement>(null);
  const pendingOpIdRef = useRef<string | null>(null);
  const cartRef = useRef<CartLine[]>(cart);
  cartRef.current = cart;

  const scanBufferRef = useRef('');
  const lastScanKeyTimeRef = useRef(0);
  const scanResetTimerRef = useRef<number | null>(null);

  const canDiscount = isAdmin || hasPermission('canDiscount');
  const canEditPrice = isAdmin || hasPermission('canManageProducts');

  const availableStock = (product: Product): number => {
    const reserved = reservedStockByProductId.get(product.id) || 0;
    return Math.max(0, roundMoney(product.stock - reserved));
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.isActive) set.add(p.category);
    }
    return ['الكل', ...Array.from(set)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (!p.isActive) return false;
      if (selectedCategory !== 'الكل' && p.category !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
      );
    });
  }, [products, searchQuery, selectedCategory]);

  const selectedCustomer: Customer | null = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  const addProductToCart = (product: Product): boolean => {
    setErrorMsg(null);
    const avail = availableStock(product);
    if (avail <= 0) {
      setErrorMsg(`الصنف "${product.name}" (${product.code}) غير متوفر في المخزون حالياً.`);
      return false;
    }

    const currentCart = cartRef.current;
    const existing = currentCart.find((l) => l.product.id === product.id);
    if (existing && existing.qty + 1 > avail) {
      setErrorMsg(`الكمية المتاحة من "${product.name}" هي ${avail} فقط.`);
      return false;
    }

    pendingOpIdRef.current = null;
    const nextCart = existing
      ? currentCart.map((l) =>
          l.product.id === product.id ? { ...l, qty: l.qty + 1 } : l
        )
      : [...currentCart, { product, qty: 1, unitPrice: product.sellPrice }];

    cartRef.current = nextCart;
    setCart(nextCart);
    return true;
  };

  const handleScanCode = (rawCode: string, source: 'manual' | 'scanner') => {
    const clean = rawCode.trim().toUpperCase();
    if (!clean) return;
    const found = productByCode.get(clean);
    if (!found) {
      setScanToast(null);
      setErrorMsg(`لم يتم العثور على صنف بالكود أو الباركود "${clean}".`);
      return;
    }
    const added = addProductToCart(found);
    if (added && source === 'scanner') {
      setScanToast(`تمت إضافة "${found.name}" (${found.code}) للسلة`);
    }
  };

  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleScanCode(codeInput, 'manual');
    setCodeInput('');
    codeFieldRef.current?.focus();
  };

  const handleScanCodeRef = useRef(handleScanCode);
  handleScanCodeRef.current = handleScanCode;

  useEffect(() => {
    if (!scanToast) return;
    const timer = window.setTimeout(() => setScanToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [scanToast]);

  useEffect(() => {
    if (!scannerEnabled) return;

    const clearBuffer = () => {
      scanBufferRef.current = '';
      if (scanResetTimerRef.current !== null) {
        window.clearTimeout(scanResetTimerRef.current);
        scanResetTimerRef.current = null;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (showNewCustomer || completedSale || submitting || cameraOpen) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      if (target) {
        if (target === codeFieldRef.current) {
          // Handled directly by the barcode form input
          return;
        }
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }

      const now = Date.now();

      if (e.key === 'Enter' || e.key === 'Tab') {
        const scanned = scanBufferRef.current.trim();
        if (scanned.length >= 2 && now - lastScanKeyTimeRef.current <= 200) {
          e.preventDefault();
          e.stopPropagation();
          clearBuffer();
          handleScanCodeRef.current(scanned, 'scanner');
          return;
        }
        clearBuffer();
        return;
      }

      if (e.key.length === 1) {
        if (now - lastScanKeyTimeRef.current > 180) {
          scanBufferRef.current = '';
        }
        scanBufferRef.current += e.key;
        lastScanKeyTimeRef.current = now;

        if (scanResetTimerRef.current !== null) {
          window.clearTimeout(scanResetTimerRef.current);
        }
        scanResetTimerRef.current = window.setTimeout(() => {
          scanBufferRef.current = '';
          scanResetTimerRef.current = null;
        }, 250);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      clearBuffer();
    };
  }, [scannerEnabled, showNewCustomer, completedSale, submitting, cameraOpen]);

  const updateCartQty = (productId: string, nextQty: number) => {
    setErrorMsg(null);
    pendingOpIdRef.current = null;
    if (nextQty <= 0) {
      setCart((prev) => prev.filter((l) => l.product.id !== productId));
      return;
    }
    setCart((prev) =>
      prev.map((l) => {
        if (l.product.id !== productId) return l;
        const avail = availableStock(l.product);
        if (nextQty > avail) {
          setErrorMsg(`أقصى كمية متاحة من "${l.product.name}" هي ${avail}.`);
          return l;
        }
        return { ...l, qty: nextQty };
      })
    );
  };

  const updateCartPrice = (productId: string, nextPrice: number) => {
    if (!canEditPrice) return;
    pendingOpIdRef.current = null;
    setCart((prev) =>
      prev.map((l) =>
        l.product.id === productId
          ? { ...l, unitPrice: Math.max(0, nextPrice) }
          : l
      )
    );
  };

  const subtotal = useMemo(
    () => roundMoney(cart.reduce((acc, l) => acc + l.qty * l.unitPrice, 0)),
    [cart]
  );

  const discount = useMemo(() => {
    if (!canDiscount) return 0;
    const d = Number(discountInput) || 0;
    return roundMoney(Math.min(Math.max(0, d), subtotal));
  }, [canDiscount, discountInput, subtotal]);

  const total = roundMoney(Math.max(0, subtotal - discount));

  const paidAmount = useMemo(() => {
    if (paymentMethod === 'cash') return total;
    if (paymentMethod === 'credit') return 0;
    const p = Number(paidAmountInput) || 0;
    return roundMoney(Math.min(Math.max(0, p), total));
  }, [paymentMethod, paidAmountInput, total]);

  const remainingAmount = roundMoney(Math.max(0, total - paidAmount));

  const handleCheckout = async () => {
    if (!actorInfo) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    if (cart.length === 0) {
      setErrorMsg('السلة فارغة. أضف أصنافاً أولاً لإتمام الفاتورة.');
      return;
    }
    if ((paymentMethod === 'credit' || paymentMethod === 'partial') && !selectedCustomer) {
      setErrorMsg('يرجى اختيار العميل أو تسجيل عميل جديد للبيع الآجل أو الجزئي.');
      return;
    }

    if (!pendingOpIdRef.current) {
      pendingOpIdRef.current = generateDocId('op');
    }

    setSubmitting(true);
    try {
      const result = await executeSale(actorInfo, {
        customer: selectedCustomer,
        items: cart.map((l) => ({
          productId: l.product.id,
          qty: l.qty,
          unitPrice: l.unitPrice,
          code: l.product.code,
          name: l.product.name,
          unit: l.product.unit,
          costPrice: l.product.costPrice,
        })),
        discount,
        paymentMethod,
        paidAmount,
        notes,
        operationId: pendingOpIdRef.current,
      });

      pendingOpIdRef.current = null;
      setCart([]);
      setDiscountInput('0');
      setPaidAmountInput('');
      setNotes('');
      setPaymentMethod('cash');
      setSelectedCustomerId('');
      setSuccessMsg(
        result.queued
          ? `تم حفظ الفاتورة محلياً برقم مؤقت ${result.invoiceNumber} وستُزامن تلقائياً فور عودة الاتصال.`
          : `تم تسجيل الفاتورة ${result.invoiceNumber} وتحديث المخزون والصندوق بنجاح.`
      );
      setCompletedSale(result.saleData);
      codeFieldRef.current?.focus();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر إتمام عملية البيع.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateQuickCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorInfo || !newCustName.trim()) return;
    setSavingCustomer(true);
    try {
      const created = await createCustomer(actorInfo, {
        name: newCustName.trim(),
        phone: newCustPhone.trim(),
        address: newCustAddress.trim(),
      });
      setSelectedCustomerId(created.id);
      setShowNewCustomer(false);
      setNewCustName('');
      setNewCustPhone('');
      setNewCustAddress('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تسجيل العميل.');
    } finally {
      setSavingCustomer(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">شاشة البيع السريع (الكاشير)</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            أدخل كود الصنف أو الباركود للإضافة الفورية · جميع الفواتير تُحفظ وترتبط بحساب المسؤول لحظياً
            {!isOnline && ' · وضع عدم الاتصال نشط (حفظ مؤقت)'}
          </p>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center justify-between gap-3">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="p-1 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="p-1 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {scanToast && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ScanBarcode className="w-4 h-4 shrink-0 text-emerald-700" />
            <span>{scanToast}</span>
          </div>
          <button onClick={() => setScanToast(null)} className="p-1 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Right/Main Panel: Code scanner + Product selector */}
        <div className="lg:col-span-7 space-y-4">
          {/* Quick code / barcode input */}
          <form
            onSubmit={handleBarcodeSubmit}
            className="bg-white border border-slate-200 rounded-xl p-3 space-y-2"
          >
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Barcode className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  ref={codeFieldRef}
                  type="text"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  placeholder="امسح الباركود في أي وقت أو اكتب كود الصنف واضغط Enter..."
                  className="w-full pr-9 pl-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600 font-mono-num"
                  autoFocus
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                إضافة بالكود
              </button>
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <Camera className="w-4 h-4" />
                <span>مسح بالكاميرا</span>
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 px-0.5">
              <span>
                يدعم القراءة من الماسح الضوئي (USB / Bluetooth) أو عبر كاميرا الجهاز مباشرة
              </span>
              <button
                type="button"
                onClick={() => setScannerEnabled((prev) => !prev)}
                className={`inline-flex items-center gap-1 font-semibold cursor-pointer ${
                  scannerEnabled ? 'text-emerald-700' : 'text-slate-500'
                }`}
              >
                <ScanBarcode className="w-3.5 h-3.5" />
                <span>
                  {scannerEnabled ? 'الالتقاط التلقائي مفعل' : 'الالتقاط التلقائي متوقف'}
                </span>
              </button>
            </div>
          </form>

          {/* Search & Category Filter */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث سريع باسم الصنف أو الكود..."
                className="w-full pr-9 pl-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    selectedCategory === cat
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {filteredProducts.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">
                لا توجد أصناف مطابقة للبحث.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[520px] overflow-y-auto pt-1">
                {filteredProducts.map((product) => {
                  const avail = availableStock(product);
                  const reserved = reservedStockByProductId.get(product.id) || 0;
                  const outOfStock = avail <= 0;
                  const lowStock = avail > 0 && avail <= product.minStock;
                  return (
                    <button
                      key={product.id}
                      type="button"
                      disabled={outOfStock}
                      onClick={() => addProductToCart(product)}
                      className={`text-right p-3 rounded-xl border transition-colors flex flex-col justify-between gap-2 cursor-pointer ${
                        outOfStock
                          ? 'bg-slate-50 border-slate-200 opacity-50 cursor-not-allowed'
                          : 'bg-white border-slate-200 hover:border-emerald-600 hover:bg-emerald-50/30'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="text-[11px] font-mono-num text-slate-500">
                          {product.code}
                        </div>
                        <div className="text-sm font-semibold text-slate-900 line-clamp-2">
                          {product.name}
                        </div>
                      </div>
                      <div className="flex items-end justify-between gap-1 pt-1 border-t border-slate-100">
                        <span className="text-sm font-bold text-emerald-700 font-mono-num">
                          {formatMoney(product.sellPrice, settings.currency)}
                        </span>
                        <span
                          className={`text-[11px] font-mono-num ${
                            outOfStock
                              ? 'text-red-600'
                              : lowStock
                              ? 'text-amber-700'
                              : 'text-slate-500'
                          }`}
                        >
                          المتاح: {formatNumber(avail)}
                          {reserved > 0 ? ` (محجوز ${formatNumber(reserved)})` : ''}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Left Panel: Invoice Cart & Checkout */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-emerald-700" />
              <h2 className="text-sm font-bold text-slate-900">الفاتورة الحالية</h2>
            </div>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  pendingOpIdRef.current = null;
                  setCart([]);
                }}
                className="text-xs text-red-600 hover:underline cursor-pointer"
              >
                تفريغ السلة
              </button>
            )}
          </div>

          <div className="p-4 space-y-4">
            {/* Customer selector */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">العميل</label>
                <button
                  type="button"
                  onClick={() => setShowNewCustomer(true)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>عميل جديد</span>
                </button>
              </div>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-emerald-600"
              >
                <option value="">عميل نقدي عام</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.customerCode})
                    {c.balanceDue > 0
                      ? ` - دين: ${formatMoney(c.balanceDue, settings.currency)}`
                      : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Cart Items */}
            {cart.length === 0 ? (
              <div className="py-10 text-center border border-dashed border-slate-200 rounded-xl text-xs text-slate-500">
                أضف أصنافاً من القائمة أو عبر كود الصنف لبدء الفاتورة
              </div>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl max-h-72 overflow-y-auto">
                {cart.map((line) => (
                  <div key={line.product.id} className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {line.product.name}
                        </div>
                        <div className="text-[11px] font-mono-num text-slate-500">
                          {line.product.code} · {line.product.unit}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateCartQty(line.product.id, 0)}
                        className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                        aria-label="إزالة"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
                        <button
                          type="button"
                          onClick={() => updateCartQty(line.product.id, line.qty - 1)}
                          className="p-1.5 hover:bg-slate-100 text-slate-700 cursor-pointer"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <input
                          type="number"
                          min="1"
                          step="any"
                          value={line.qty}
                          onChange={(e) =>
                            updateCartQty(line.product.id, Number(e.target.value) || 0)
                          }
                          className="w-14 text-center text-sm font-mono-num py-1 border-x border-slate-200 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => updateCartQty(line.product.id, line.qty + 1)}
                          className="p-1.5 hover:bg-slate-100 text-slate-700 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        {canEditPrice ? (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.unitPrice}
                            onChange={(e) =>
                              updateCartPrice(
                                line.product.id,
                                Number(e.target.value) || 0
                              )
                            }
                            className="w-20 px-2 py-1 text-xs font-mono-num text-left border border-slate-200 rounded-md"
                            title="سعر الوحدة"
                          />
                        ) : (
                          <span className="text-xs font-mono-num text-slate-500">
                            × {formatMoney(line.unitPrice, settings.currency)}
                          </span>
                        )}
                        <span className="text-sm font-bold font-mono-num text-slate-900 min-w-[75px] text-left">
                          {formatMoney(line.qty * line.unitPrice, settings.currency)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Payment & Discount */}
            <div className="space-y-3 border-t border-slate-200 pt-3">
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    ['cash', 'نقدي'],
                    ['partial', 'دفع جزئي'],
                    ['credit', 'آجل'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPaymentMethod(mode)}
                    className={`py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                      paymentMethod === mode
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-600 mb-1">
                    الخصم {!canDiscount && '(يتطلب صلاحية)'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!canDiscount}
                    value={discountInput}
                    onChange={(e) => setDiscountInput(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono-num border border-slate-200 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                {paymentMethod === 'partial' && (
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">
                      المبلغ المدفوع الآن
                    </label>
                    <input
                      type="number"
                      min="0"
                      max={total}
                      step="0.01"
                      value={paidAmountInput}
                      onChange={(e) => setPaidAmountInput(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 text-sm font-mono-num border border-slate-200 rounded-lg"
                    />
                  </div>
                )}
              </div>

              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ملاحظات اختيارية على الفاتورة..."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
              />

              {/* Totals box */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-1.5 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>المجموع الفرعي</span>
                  <span className="font-mono-num">{formatMoney(subtotal, settings.currency)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-amber-700">
                    <span>الخصم</span>
                    <span className="font-mono-num">- {formatMoney(discount, settings.currency)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold text-slate-900 border-t border-slate-200 pt-2">
                  <span>الإجمالي النهائي</span>
                  <span className="font-mono-num text-emerald-700">
                    {formatMoney(total, settings.currency)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-slate-600 pt-1">
                  <span>
                    المدفوع:{' '}
                    <strong className="font-mono-num text-emerald-700">
                      {formatMoney(paidAmount, settings.currency)}
                    </strong>
                  </span>
                  <span>
                    المتبقي:{' '}
                    <strong className="font-mono-num text-red-700">
                      {formatMoney(remainingAmount, settings.currency)}
                    </strong>
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={submitting || cart.length === 0}
                onClick={handleCheckout}
                className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 text-white font-bold text-sm rounded-xl transition-colors cursor-pointer"
              >
                {submitting ? 'جاري حفظ الفاتورة...' : 'إصدار الفاتورة وحفظ البيع'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Add Customer Modal */}
      {showNewCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateQuickCustomer}
            className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">تسجيل عميل جديد سريع</h3>
              <button
                type="button"
                onClick={() => setShowNewCustomer(false)}
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
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  رقم الهاتف
                </label>
                <input
                  type="text"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  العنوان
                </label>
                <input
                  type="text"
                  value={newCustAddress}
                  onChange={(e) => setNewCustAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewCustomer(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={savingCustomer}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
              >
                {savingCustomer ? 'جاري الحفظ...' : 'حفظ واختيار العميل'}
              </button>
            </div>
          </form>
        </div>
      )}

      <CameraBarcodeModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        allowContinuous
        defaultContinuous
        title="مسح باركود الأصناف بالكاميرا"
        onDetected={(rawCode) => {
          const clean = rawCode.trim().toUpperCase();
          if (!clean) {
            return { ok: false, message: 'رمز الباركود غير صالح.' };
          }
          const found = productByCode.get(clean);
          if (!found) {
            setErrorMsg(`لم يتم العثور على صنف بالكود أو الباركود "${clean}".`);
            return {
              ok: false,
              message: `لم يتم العثور على صنف بالباركود "${clean}"`,
            };
          }
          const added = addProductToCart(found);
          if (added) {
            const msg = `تمت إضافة "${found.name}" (${found.code}) للسلة`;
            setScanToast(msg);
            return { ok: true, message: msg };
          }
          const avail = availableStock(found);
          return {
            ok: false,
            message:
              avail <= 0
                ? `الصنف "${found.name}" غير متوفر في المخزون حالياً`
                : `الكمية المتاحة من "${found.name}" هي ${avail} فقط`,
          };
        }}
      />

      <InvoiceDetailModal
        sale={completedSale}
        onClose={() => setCompletedSale(null)}
        showProfit={isAdmin}
      />
    </div>
  );
};
