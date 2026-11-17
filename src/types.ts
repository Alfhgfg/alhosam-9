import type { Timestamp } from 'firebase/firestore';

export type UserRole = 'admin' | 'employee' | 'pending';
export type UserStatus = 'active' | 'suspended' | 'pending';
export type PaymentMethod = 'cash' | 'credit' | 'partial';
export type SaleStatus = 'completed' | 'partial_return' | 'returned' | 'cancelled';
export type DeviceType = 'mobile' | 'tablet' | 'desktop';
export type DeviceStatus = 'active' | 'blocked';
export type StockMovementType =
  | 'sale'
  | 'purchase'
  | 'return'
  | 'in'
  | 'out'
  | 'stocktake'
  | 'cancel_restore';

export interface UserPermissions {
  canDiscount: boolean;
  canViewAllSales: boolean;
  canReturn: boolean;
  canCancelInvoice: boolean;
  canPurchase: boolean;
  canManageProducts: boolean;
  canManageExpenses: boolean;
  canViewReports: boolean;
  canStocktake: boolean;
}

export const DEFAULT_EMPLOYEE_PERMISSIONS: UserPermissions = {
  canDiscount: false,
  canViewAllSales: false,
  canReturn: false,
  canCancelInvoice: false,
  canPurchase: false,
  canManageProducts: false,
  canManageExpenses: false,
  canViewReports: false,
  canStocktake: false,
};

export const ADMIN_PERMISSIONS: UserPermissions = {
  canDiscount: true,
  canViewAllSales: true,
  canReturn: true,
  canCancelInvoice: true,
  canPurchase: true,
  canManageProducts: true,
  canManageExpenses: true,
  canViewReports: true,
  canStocktake: true,
};

export const PERMISSION_LABELS: Record<keyof UserPermissions, string> = {
  canDiscount: 'منح خصومات على الفواتير',
  canViewAllSales: 'عرض مبيعات جميع الموظفين',
  canReturn: 'تسجيل مرتجعات العملاء',
  canCancelInvoice: 'إلغاء فواتير المبيعات',
  canPurchase: 'إدارة المشتريات والموردين',
  canManageProducts: 'إضافة وتعديل الأصناف والأسعار',
  canManageExpenses: 'تسجيل المصروفات وسندات الصرف',
  canViewReports: 'الاطلاع على التقارير المالية والصندوق',
  canStocktake: 'إجراء الجرد وتسويات المخزون',
};

export const FIELD_LIMITS = {
  codeMax: 64,
  barcodeMax: 64,
  nameMax: 160,
  shortNameMax: 120,
  deviceNameMax: 120,
  partyNameMax: 140,
  categoryMax: 80,
  unitMax: 40,
  phoneMax: 40,
  addressMax: 240,
  descriptionMax: 400,
  notesMax: 300,
  currencyMax: 20,
  detailsMax: 1000,
  maxLineItems: 100,
} as const;

export const CODE_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface UserProfile {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  permissions: UserPermissions;
  inviteId?: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface StaffInvite {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'employee';
  status: 'active' | 'suspended';
  permissions: UserPermissions;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface DeviceRecord {
  id: string;
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  platform: string;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: 'admin' | 'employee';
  status: DeviceStatus;
  lastOperationSummary?: string;
  lastActiveAt: Timestamp | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface StoreSettings {
  storeName: string;
  phone: string;
  address: string;
  currency: string;
  receiptFooter: string;
  updatedAt: Timestamp | null;
}

export interface Counters {
  nextProductSeq: number;
  nextCustomerSeq: number;
  nextSupplierSeq: number;
  nextInvoiceSeq: number;
  nextPurchaseSeq: number;
  nextReturnSeq: number;
  nextVoucherSeq: number;
  cashBalance: number;
  updatedAt: Timestamp | null;
}

export interface Product {
  id: string;
  code: string;
  barcode?: string;
  name: string;
  category: string;
  description?: string;
  unit: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  minStock: number;
  isActive: boolean;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Customer {
  id: string;
  customerCode: string;
  name: string;
  phone?: string;
  address?: string;
  notes?: string;
  totalPurchases: number;
  totalPaid: number;
  balanceDue: number;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Supplier {
  id: string;
  supplierCode: string;
  name: string;
  phone?: string;
  address?: string;
  notes?: string;
  totalPurchases: number;
  totalPaid: number;
  balanceDue: number;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface SaleItem {
  productId: string;
  code: string;
  name: string;
  unit: string;
  qty: number;
  costPrice: number;
  unitPrice: number;
  lineTotal: number;
}

export interface SaleInvoice {
  id: string;
  invoiceNumber: string;
  employeeId: string;
  employeeName: string;
  deviceId?: string;
  deviceName?: string;
  operationId?: string;
  customerId?: string;
  customerCode?: string;
  customerName: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  remainingAmount: number;
  totalCost: number;
  netProfit: number;
  paymentMethod: PaymentMethod;
  status: SaleStatus;
  notes?: string;
  isOfflinePending?: boolean;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface PurchaseItem {
  productId: string;
  code: string;
  name: string;
  unit: string;
  qty: number;
  costPrice: number;
  lineTotal: number;
}

export interface PurchaseInvoice {
  id: string;
  purchaseNumber: string;
  supplierId: string;
  supplierCode?: string;
  supplierName: string;
  employeeId: string;
  employeeName: string;
  deviceId?: string;
  deviceName?: string;
  operationId?: string;
  items: PurchaseItem[];
  total: number;
  paidAmount: number;
  remainingAmount: number;
  paymentMethod: PaymentMethod;
  status: 'completed' | 'cancelled';
  notes?: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface ReturnItem {
  productId: string;
  code: string;
  name: string;
  qty: number;
  unitPrice: number;
  costPrice: number;
  lineTotal: number;
}

export interface SalesReturn {
  id: string;
  returnNumber: string;
  saleId: string;
  invoiceNumber: string;
  customerId?: string;
  customerName: string;
  employeeId: string;
  employeeName: string;
  deviceId?: string;
  deviceName?: string;
  operationId?: string;
  items: ReturnItem[];
  refundAmount: number;
  returnedCost: number;
  returnedProfit: number;
  reason: string;
  restockValid: boolean;
  createdAt: Timestamp | null;
}

export interface StockMovement {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  type: StockMovementType;
  qtyChange: number;
  previousStock: number;
  newStock: number;
  referenceType?: string;
  referenceId?: string;
  referenceNumber?: string;
  reason: string;
  employeeId: string;
  employeeName: string;
  deviceId?: string;
  deviceName?: string;
  createdAt: Timestamp | null;
}

export interface Expense {
  id: string;
  title: string;
  category: string;
  amount: number;
  notes?: string;
  employeeId: string;
  employeeName: string;
  deviceId?: string;
  deviceName?: string;
  operationId?: string;
  createdAt: Timestamp | null;
}

export interface Voucher {
  id: string;
  voucherNumber: string;
  type: 'receipt' | 'payment';
  partyType: 'customer' | 'supplier';
  partyId: string;
  partyName: string;
  amount: number;
  notes?: string;
  employeeId: string;
  employeeName: string;
  deviceId?: string;
  deviceName?: string;
  operationId?: string;
  createdAt: Timestamp | null;
}

export interface CashTransaction {
  id: string;
  type: 'in' | 'out';
  category: string;
  amount: number;
  balanceAfter: number;
  referenceId?: string;
  referenceNumber?: string;
  description: string;
  employeeId: string;
  employeeName: string;
  deviceId?: string;
  deviceName?: string;
  createdAt: Timestamp | null;
}

export interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  actorId: string;
  actorName: string;
  actorRole: 'admin' | 'employee';
  deviceId?: string;
  deviceName?: string;
  details?: string;
  createdAt: Timestamp | null;
}

export type PendingOperationType =
  | 'sale'
  | 'purchase'
  | 'return'
  | 'voucher'
  | 'expense'
  | 'stock_adjust';

export type PendingOperationStatus = 'pending' | 'syncing' | 'conflict';

export interface PendingOperation {
  operationId: string;
  type: PendingOperationType;
  summary: string;
  localTempRef: string;
  actor: {
    uid: string;
    name: string;
    role: 'admin' | 'employee';
    deviceId: string;
    deviceName: string;
  };
  payload: Record<string, unknown>;
  status: PendingOperationStatus;
  errorMessage?: string;
  attempts: number;
  createdAtIso: string;
}

export type NavSection =
  | 'dashboard'
  | 'pos'
  | 'products'
  | 'inventory'
  | 'customers'
  | 'suppliers'
  | 'returns'
  | 'finance'
  | 'reports'
  | 'staff';
