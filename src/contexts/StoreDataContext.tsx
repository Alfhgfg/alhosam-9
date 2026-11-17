import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { flushSinglePendingOperation } from '../services/accountingService';
import {
  computeReservedStockMap,
  isNetworkOrOfflineError,
  loadPendingOperations,
  PENDING_OPS_EVENT,
  removePendingOperation,
  updatePendingOperation,
} from '../services/offlineQueueService';
import { useAuth } from './AuthContext';
import type {
  AuditLog,
  CashTransaction,
  Counters,
  Customer,
  DeviceRecord,
  Expense,
  PendingOperation,
  Product,
  PurchaseInvoice,
  SaleInvoice,
  SalesReturn,
  StaffInvite,
  StockMovement,
  StoreSettings,
  Supplier,
  UserProfile,
  Voucher,
} from '../types';

interface StoreDataContextValue {
  settings: StoreSettings;
  counters: Counters;
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  sales: SaleInvoice[];
  purchases: PurchaseInvoice[];
  returns: SalesReturn[];
  stockMovements: StockMovement[];
  expenses: Expense[];
  vouchers: Voucher[];
  cashTransactions: CashTransaction[];
  auditLogs: AuditLog[];
  staffUsers: UserProfile[];
  staffInvites: StaffInvite[];
  devices: DeviceRecord[];
  pendingOperations: PendingOperation[];
  reservedStockByProductId: Map<string, number>;
  isSyncingQueue: boolean;
  syncNotice: string | null;
  recentSaleAlert: string | null;
  dismissSyncNotice: () => void;
  dismissSaleAlert: () => void;
  flushPendingQueue: () => Promise<void>;
  retryPendingOperation: (operationId: string) => Promise<void>;
  discardPendingOperation: (operationId: string) => void;
  dataLoading: boolean;
  isOnline: boolean;
  hasPendingSync: boolean;
  productByCode: Map<string, Product>;
  productById: Map<string, Product>;
  customerById: Map<string, Customer>;
  supplierById: Map<string, Supplier>;
}

const DEFAULT_SETTINGS: StoreSettings = {
  storeName: 'بقالة الحسام',
  phone: '',
  address: '',
  currency: 'ر.ي',
  receiptFooter: 'شكراً لتعاملكم مع بقالة الحسام',
  updatedAt: null,
};

const DEFAULT_COUNTERS: Counters = {
  nextProductSeq: 1001,
  nextCustomerSeq: 1001,
  nextSupplierSeq: 1001,
  nextInvoiceSeq: 1,
  nextPurchaseSeq: 1,
  nextReturnSeq: 1,
  nextVoucherSeq: 1,
  cashBalance: 0,
  updatedAt: null,
};

const StoreDataContext = createContext<StoreDataContextValue | null>(null);

export const StoreDataProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const {
    firebaseUser,
    profile,
    isAdmin,
    isActiveStaff,
    isDeviceBlocked,
    deviceIdentity,
    hasPermission,
    ensureDeviceRegistered,
  } = useAuth();

  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_SETTINGS);
  const [counters, setCounters] = useState<Counters>(DEFAULT_COUNTERS);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [sales, setSales] = useState<SaleInvoice[]>([]);
  const [purchases, setPurchases] = useState<PurchaseInvoice[]>([]);
  const [returns, setReturns] = useState<SalesReturn[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [cashTransactions, setCashTransactions] = useState<CashTransaction[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [staffUsers, setStaffUsers] = useState<UserProfile[]>([]);
  const [staffInvites, setStaffInvites] = useState<StaffInvite[]>([]);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [pendingMap, setPendingMap] = useState<Record<string, boolean>>({});
  const [pendingOperations, setPendingOperations] = useState<PendingOperation[]>(() =>
    loadPendingOperations()
  );
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [recentSaleAlert, setRecentSaleAlert] = useState<string | null>(null);

  const isFlushingRef = useRef(false);
  const seenSaleIdsRef = useRef<Set<string> | null>(null);
  const settingsCurrencyRef = useRef<string>(DEFAULT_SETTINGS.currency);

  useEffect(() => {
    settingsCurrencyRef.current = settings.currency || 'ر.ي';
  }, [settings.currency]);

  useEffect(() => {
    const syncLocalQueue = () => {
      setPendingOperations(loadPendingOperations());
    };
    window.addEventListener(PENDING_OPS_EVENT, syncLocalQueue);
    window.addEventListener('storage', syncLocalQueue);
    return () => {
      window.removeEventListener(PENDING_OPS_EVENT, syncLocalQueue);
      window.removeEventListener('storage', syncLocalQueue);
    };
  }, []);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const markPending = (key: string, pending: boolean) => {
    setPendingMap((prev) => {
      if (prev[key] === pending) return prev;
      return { ...prev, [key]: pending };
    });
  };

  useEffect(() => {
    if (!firebaseUser || !isActiveStaff || isDeviceBlocked) {
      setProducts([]);
      setCustomers([]);
      setSuppliers([]);
      setSales([]);
      setPurchases([]);
      setReturns([]);
      setStockMovements([]);
      setExpenses([]);
      setVouchers([]);
      setCashTransactions([]);
      setAuditLogs([]);
      setStaffUsers([]);
      setStaffInvites([]);
      setDevices([]);
      seenSaleIdsRef.current = null;
      setDataLoading(false);
      return;
    }

    setDataLoading(true);
    const unsubs: Unsubscribe[] = [];

    // Settings
    unsubs.push(
      onSnapshot(
        doc(db, 'settings', 'store'),
        (snap) => {
          if (snap.exists()) {
            const raw = snap.data() as StoreSettings;
            setSettings({
              ...raw,
              currency: raw.currency === 'ر.س' ? 'ر.ي' : raw.currency || 'ر.ي',
            });
          }
          markPending('settings', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.GET, 'settings/store')
      )
    );

    // Counters & cash balance
    unsubs.push(
      onSnapshot(
        doc(db, 'counters', 'main'),
        (snap) => {
          if (snap.exists()) {
            setCounters(snap.data() as Counters);
          }
          markPending('counters', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.GET, 'counters/main')
      )
    );

    // Products
    unsubs.push(
      onSnapshot(
        query(collection(db, 'products'), orderBy('name', 'asc')),
        (snap) => {
          setProducts(
            snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<Product, 'id'>),
            }))
          );
          markPending('products', snap.metadata.hasPendingWrites);
          setDataLoading(false);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'products')
      )
    );

    // Customers
    unsubs.push(
      onSnapshot(
        query(collection(db, 'customers'), orderBy('createdAt', 'desc')),
        (snap) => {
          setCustomers(
            snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<Customer, 'id'>),
            }))
          );
          markPending('customers', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'customers')
      )
    );

    // Suppliers
    unsubs.push(
      onSnapshot(
        query(collection(db, 'suppliers'), orderBy('createdAt', 'desc')),
        (snap) => {
          setSuppliers(
            snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<Supplier, 'id'>),
            }))
          );
          markPending('suppliers', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'suppliers')
      )
    );

    // Sales (enforced by Firestore rules: admin or canViewAllSales sees all; otherwise filtered by employeeId)
    const canSeeAllSales = isAdmin || hasPermission('canViewAllSales');
    const salesQuery = canSeeAllSales
      ? query(collection(db, 'sales'), orderBy('createdAt', 'desc'))
      : query(
          collection(db, 'sales'),
          where('employeeId', '==', firebaseUser.uid)
        );

    unsubs.push(
      onSnapshot(
        salesQuery,
        (snap) => {
          const rows = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<SaleInvoice, 'id'>),
          }));
          if (!canSeeAllSales) {
            rows.sort(
              (a, b) =>
                (b.createdAt?.toMillis() ?? Date.now()) -
                (a.createdAt?.toMillis() ?? Date.now())
            );
          }

          if (seenSaleIdsRef.current === null) {
            seenSaleIdsRef.current = new Set(rows.map((r) => r.id));
          } else if (isAdmin) {
            const newlyArrived = rows.find(
              (r) =>
                !seenSaleIdsRef.current!.has(r.id) &&
                r.deviceId !== deviceIdentity.deviceId
            );
            for (const r of rows) {
              seenSaleIdsRef.current.add(r.id);
            }
            if (newlyArrived) {
              setRecentSaleAlert(
                `بيع فوري جديد: ${newlyArrived.invoiceNumber} — ${newlyArrived.employeeName} (${newlyArrived.deviceName || 'جهاز موظف'}) بقيمة ${newlyArrived.total.toLocaleString('en-US')} ${settingsCurrencyRef.current}`
              );
            }
          }

          setSales(rows);
          markPending('sales', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'sales')
      )
    );

    // Returns
    const canSeeAllReturns =
      isAdmin || hasPermission('canViewAllSales') || hasPermission('canReturn');
    const returnsQuery = canSeeAllReturns
      ? query(collection(db, 'returns'), orderBy('createdAt', 'desc'))
      : query(
          collection(db, 'returns'),
          where('employeeId', '==', firebaseUser.uid)
        );

    unsubs.push(
      onSnapshot(
        returnsQuery,
        (snap) => {
          const rows = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<SalesReturn, 'id'>),
          }));
          if (!canSeeAllReturns) {
            rows.sort(
              (a, b) =>
                (b.createdAt?.toMillis() ?? Date.now()) -
                (a.createdAt?.toMillis() ?? Date.now())
            );
          }
          setReturns(rows);
          markPending('returns', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'returns')
      )
    );

    // Stock Movements
    unsubs.push(
      onSnapshot(
        query(collection(db, 'stock_movements'), orderBy('createdAt', 'desc')),
        (snap) => {
          setStockMovements(
            snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<StockMovement, 'id'>),
            }))
          );
          markPending('stock_movements', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'stock_movements')
      )
    );

    // Vouchers
    unsubs.push(
      onSnapshot(
        query(collection(db, 'vouchers'), orderBy('createdAt', 'desc')),
        (snap) => {
          setVouchers(
            snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<Voucher, 'id'>),
            }))
          );
          markPending('vouchers', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'vouchers')
      )
    );

    // Purchases (admin or canPurchase)
    if (isAdmin || hasPermission('canPurchase')) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'purchases'), orderBy('createdAt', 'desc')),
          (snap) => {
            setPurchases(
              snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<PurchaseInvoice, 'id'>),
              }))
            );
            markPending('purchases', snap.metadata.hasPendingWrites);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'purchases')
        )
      );
    }

    // Expenses (admin or canManageExpenses or canViewReports)
    if (isAdmin || hasPermission('canManageExpenses') || hasPermission('canViewReports')) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'expenses'), orderBy('createdAt', 'desc')),
          (snap) => {
            setExpenses(
              snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<Expense, 'id'>),
              }))
            );
            markPending('expenses', snap.metadata.hasPendingWrites);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'expenses')
        )
      );
    }

    // Cash Transactions (admin or canViewReports)
    if (isAdmin || hasPermission('canViewReports')) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'cash_transactions'), orderBy('createdAt', 'desc')),
          (snap) => {
            setCashTransactions(
              snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<CashTransaction, 'id'>),
              }))
            );
            markPending('cash_transactions', snap.metadata.hasPendingWrites);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'cash_transactions')
        )
      );
    }

    // Admin-only collections
    if (isAdmin) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'audit_logs'), orderBy('createdAt', 'desc')),
          (snap) => {
            setAuditLogs(
              snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<AuditLog, 'id'>),
              }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'audit_logs')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'users'), orderBy('createdAt', 'desc')),
          (snap) => {
            setStaffUsers(
              snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<UserProfile, 'id'>),
              }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'users')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'staff_invites'), orderBy('createdAt', 'desc')),
          (snap) => {
            setStaffInvites(
              snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<StaffInvite, 'id'>),
              }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'staff_invites')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'devices'), orderBy('lastActiveAt', 'desc')),
          (snap) => {
            setDevices(
              snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<DeviceRecord, 'id'>),
              }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'devices')
        )
      );
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [
    firebaseUser,
    isActiveStaff,
    isAdmin,
    isDeviceBlocked,
    deviceIdentity.deviceId,
    profile?.permissions,
  ]);

  useEffect(() => {
    if (!recentSaleAlert) return;
    const t = setTimeout(() => setRecentSaleAlert(null), 7000);
    return () => clearTimeout(t);
  }, [recentSaleAlert]);

  useEffect(() => {
    if (!syncNotice) return;
    const t = setTimeout(() => setSyncNotice(null), 6000);
    return () => clearTimeout(t);
  }, [syncNotice]);

  const flushPendingQueue = useCallback(async () => {
    if (
      isFlushingRef.current ||
      !navigator.onLine ||
      !firebaseUser ||
      !isActiveStaff ||
      isDeviceBlocked
    ) {
      return;
    }

    const queueSnapshot = loadPendingOperations();
    const runnable = queueSnapshot.filter((op) => op.status !== 'conflict');
    if (runnable.length === 0) return;

    isFlushingRef.current = true;
    setIsSyncingQueue(true);
    let syncedCount = 0;

    try {
      const reg = await ensureDeviceRegistered();
      if (reg && reg.status === 'blocked') {
        return;
      }

      for (const op of runnable) {
        if (!navigator.onLine) break;
        updatePendingOperation(op.operationId, { status: 'syncing', errorMessage: undefined });
        try {
          await flushSinglePendingOperation(op);
          removePendingOperation(op.operationId);
          syncedCount++;
        } catch (err) {
          if (isNetworkOrOfflineError(err)) {
            updatePendingOperation(op.operationId, {
              status: 'pending',
              attempts: op.attempts + 1,
            });
            break;
          }
          const rawMsg = err instanceof Error ? err.message : String(err);
          updatePendingOperation(op.operationId, {
            status: 'conflict',
            attempts: op.attempts + 1,
            errorMessage: rawMsg.startsWith('{')
              ? 'تعذرت المزامنة بسبب تعارض أو رفض صلاحية من الخادم.'
              : rawMsg,
          });
        }
      }

      if (syncedCount > 0) {
        setSyncNotice(`تمت مزامنة ${syncedCount} عملية معلقة مع السحابة بنجاح.`);
      }
    } finally {
      isFlushingRef.current = false;
      setIsSyncingQueue(false);
    }
  }, [firebaseUser, isActiveStaff, isDeviceBlocked, ensureDeviceRegistered]);

  useEffect(() => {
    if (!isOnline || !firebaseUser || !isActiveStaff || isDeviceBlocked) return;
    flushPendingQueue();
    const timer = setInterval(() => {
      flushPendingQueue();
    }, 20000);
    return () => clearInterval(timer);
  }, [isOnline, firebaseUser, isActiveStaff, isDeviceBlocked, flushPendingQueue]);

  const retryPendingOperation = useCallback(
    async (operationId: string) => {
      updatePendingOperation(operationId, { status: 'pending', errorMessage: undefined });
      await flushPendingQueue();
    },
    [flushPendingQueue]
  );

  const discardPendingOperation = useCallback((operationId: string) => {
    removePendingOperation(operationId);
  }, []);

  const reservedStockByProductId = useMemo(
    () => computeReservedStockMap(pendingOperations),
    [pendingOperations]
  );

  const productByCode = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) {
      map.set(p.code.toUpperCase(), p);
      if (p.barcode) {
        map.set(p.barcode.trim().toUpperCase(), p);
      }
    }
    return map;
  }, [products]);

  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

  const customerById = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const c of customers) map.set(c.id, c);
    return map;
  }, [customers]);

  const supplierById = useMemo(() => {
    const map = new Map<string, Supplier>();
    for (const s of suppliers) map.set(s.id, s);
    return map;
  }, [suppliers]);

  const hasPendingSync =
    Object.values(pendingMap).some(Boolean) ||
    pendingOperations.some((op) => op.status !== 'conflict');

  return (
    <StoreDataContext.Provider
      value={{
        settings,
        counters,
        products,
        customers,
        suppliers,
        sales,
        purchases,
        returns,
        stockMovements,
        expenses,
        vouchers,
        cashTransactions,
        auditLogs,
        staffUsers,
        staffInvites,
        devices,
        pendingOperations,
        reservedStockByProductId,
        isSyncingQueue,
        syncNotice,
        recentSaleAlert,
        dismissSyncNotice: () => setSyncNotice(null),
        dismissSaleAlert: () => setRecentSaleAlert(null),
        flushPendingQueue,
        retryPendingOperation,
        discardPendingOperation,
        dataLoading,
        isOnline,
        hasPendingSync,
        productByCode,
        productById,
        customerById,
        supplierById,
      }}
    >
      {children}
    </StoreDataContext.Provider>
  );
};

export function useStoreData(): StoreDataContextValue {
  const ctx = useContext(StoreDataContext);
  if (!ctx) throw new Error('useStoreData must be used inside StoreDataProvider');
  return ctx;
}
