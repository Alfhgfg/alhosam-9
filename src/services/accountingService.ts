import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  ADMIN_PERMISSIONS,
  CODE_PATTERN,
  FIELD_LIMITS,
  type Customer,
  type DeviceRecord,
  type DeviceStatus,
  type DeviceType,
  type PaymentMethod,
  type PendingOperation,
  type Product,
  type PurchaseItem,
  type ReturnItem,
  type SaleInvoice,
  type SaleItem,
  type SalesReturn,
  type StockMovementType,
  type StoreSettings,
  type Supplier,
  type UserPermissions,
  type UserProfile,
} from '../types';
import {
  generateDocId,
  makeSafeCodeId,
  roundMoney,
  truncateText,
} from '../utils/format';
import {
  enqueuePendingOperation,
  isNetworkOrOfflineError,
} from './offlineQueueService';

export interface ActorInfo {
  uid: string;
  name: string;
  role: 'admin' | 'employee';
  deviceId: string;
  deviceName: string;
}

function buildAuditEntry(
  actor: ActorInfo,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
  details?: string
) {
  return {
    action: truncateText(action, 80),
    entityType: truncateText(entityType, 60),
    entityId: truncateText(entityId, 128),
    summary: truncateText(summary, 300),
    actorId: actor.uid,
    actorName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
    actorRole: actor.role,
    deviceId: actor.deviceId,
    deviceName: truncateText(actor.deviceName, FIELD_LIMITS.deviceNameMax) || 'جهاز غير مسمى',
    ...(details ? { details: truncateText(details, FIELD_LIMITS.detailsMax) } : {}),
    createdAt: serverTimestamp(),
  };
}

function deviceFieldsFor(actor: ActorInfo) {
  return {
    deviceId: actor.deviceId,
    deviceName: truncateText(actor.deviceName, FIELD_LIMITS.deviceNameMax) || 'جهاز غير مسمى',
  };
}

// ---------------- DEVICES MANAGEMENT ----------------
export async function registerOrHeartbeatDevice(params: {
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  platform: string;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: 'admin' | 'employee';
  lastOperationSummary?: string;
}): Promise<DeviceRecord | null> {
  const deviceRef = doc(db, 'devices', params.deviceId);
  const cleanName = truncateText(params.deviceName, FIELD_LIMITS.deviceNameMax) || 'جهاز كاشير';
  const cleanUserName = truncateText(params.userName, FIELD_LIMITS.shortNameMax) || 'موظف';
  const cleanEmail = truncateText(params.userEmail, 200) || 'staff@local';
  const cleanPlatform = truncateText(params.platform, FIELD_LIMITS.deviceNameMax) || 'Web';

  try {
    const snap = await getDoc(deviceRef);
    if (!snap.exists()) {
      const createPayload: Record<string, unknown> = {
        deviceId: params.deviceId,
        deviceName: cleanName,
        deviceType: params.deviceType,
        platform: cleanPlatform,
        userId: params.userId,
        userName: cleanUserName,
        userEmail: cleanEmail,
        userRole: params.userRole,
        status: 'active',
        lastActiveAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (params.lastOperationSummary?.trim()) {
        createPayload.lastOperationSummary = truncateText(params.lastOperationSummary, 240);
      }
      await setDoc(deviceRef, createPayload);
      return {
        id: params.deviceId,
        deviceId: params.deviceId,
        deviceName: cleanName,
        deviceType: params.deviceType,
        platform: cleanPlatform,
        userId: params.userId,
        userName: cleanUserName,
        userEmail: cleanEmail,
        userRole: params.userRole,
        status: 'active',
        lastOperationSummary: params.lastOperationSummary,
        lastActiveAt: null,
        createdAt: null,
        updatedAt: null,
      };
    }

    const existing = snap.data() as Omit<DeviceRecord, 'id'>;
    if (existing.status === 'blocked') {
      return { id: snap.id, ...existing };
    }

    const updatePayload: Record<string, unknown> = {
      deviceName: existing.deviceName || cleanName,
      deviceType: params.deviceType,
      platform: cleanPlatform,
      userId: params.userId,
      userName: cleanUserName,
      userEmail: cleanEmail,
      userRole: params.userRole,
      lastActiveAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (params.lastOperationSummary?.trim()) {
      updatePayload.lastOperationSummary = truncateText(params.lastOperationSummary, 240);
    }

    await updateDoc(deviceRef, updatePayload);
    return {
      id: snap.id,
      ...existing,
      deviceName: String(updatePayload.deviceName),
      deviceType: params.deviceType,
      platform: cleanPlatform,
      userId: params.userId,
      userName: cleanUserName,
      userEmail: cleanEmail,
      userRole: params.userRole,
    };
  } catch (err) {
    if (isNetworkOrOfflineError(err)) {
      return null;
    }
    throw err;
  }
}

export async function renameDeviceRecord(
  actor: ActorInfo,
  deviceId: string,
  newName: string,
  options?: { isActiveStaff?: boolean }
): Promise<string> {
  const cleanName = truncateText(newName, FIELD_LIMITS.deviceNameMax);
  if (!cleanName) {
    throw new Error('يرجى إدخال اسم صالح للجهاز.');
  }
  if (options?.isActiveStaff === false) {
    return cleanName;
  }

  try {
    const targetRef = doc(db, 'devices', deviceId);
    await runTransaction(db, async (tx) => {
      const targetSnap = await tx.get(targetRef);
      if (!targetSnap.exists()) {
        throw new Error('سجل الجهاز غير موجود.');
      }
      const existing = targetSnap.data() as Omit<DeviceRecord, 'id'>;
      const updateObj: Record<string, unknown> = {
        deviceName: cleanName,
        updatedAt: serverTimestamp(),
        lastActiveAt: serverTimestamp(),
      };
      if (actor.role !== 'admin') {
        updateObj.userId = actor.uid;
        updateObj.userName = truncateText(actor.name, FIELD_LIMITS.shortNameMax);
      }
      tx.update(targetRef, updateObj);

      if (existing.status === 'active') {
        tx.set(
          doc(db, 'audit_logs', generateDocId('aud')),
          buildAuditEntry(
            actor,
            'تسمية جهاز',
            'device',
            deviceId,
            `تغيير اسم الجهاز "${existing.deviceName}" إلى "${cleanName}"`
          )
        );
      }
    });
    return cleanName;
  } catch (err) {
    if (isNetworkOrOfflineError(err)) {
      return cleanName;
    }
    handleFirestoreError(err, OperationType.UPDATE, `devices/${deviceId}`);
  }
}

export async function setDeviceStatus(
  actor: ActorInfo,
  device: DeviceRecord,
  status: DeviceStatus
): Promise<void> {
  try {
    const targetRef = doc(db, 'devices', device.deviceId);
    await runTransaction(db, async (tx) => {
      tx.update(targetRef, {
        status,
        updatedAt: serverTimestamp(),
      });
      tx.set(
        doc(db, 'audit_logs', generateDocId('aud')),
        buildAuditEntry(
          actor,
          status === 'blocked' ? 'حظر جهاز' : 'تفعيل جهاز',
          'device',
          device.deviceId,
          `${status === 'blocked' ? 'حظر' : 'إعادة تفعيل'} الجهاز ${device.deviceName} (${device.userName})`
        )
      );
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `devices/${device.deviceId}`);
  }
}

export async function deleteDeviceRecord(
  actor: ActorInfo,
  device: DeviceRecord
): Promise<void> {
  try {
    await runTransaction(db, async (tx) => {
      tx.delete(doc(db, 'devices', device.deviceId));
      tx.set(
        doc(db, 'audit_logs', generateDocId('aud')),
        buildAuditEntry(
          actor,
          'حذف سجل جهاز',
          'device',
          device.deviceId,
          `حذف الجهاز ${device.deviceName} (${device.userName})`
        )
      );
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `devices/${device.deviceId}`);
  }
}

// ---------------- PRODUCTS ----------------
export async function createProduct(
  actor: ActorInfo,
  input: {
    code?: string;
    barcode?: string;
    name: string;
    category: string;
    description?: string;
    unit: string;
    costPrice: number;
    sellPrice: number;
    stock: number;
    minStock: number;
  }
): Promise<string> {
  const productId = generateDocId('prod');
  const countersRef = doc(db, 'counters', 'main');
  const productRef = doc(db, 'products', productId);

  try {
    let finalCode = (input.code || '').trim().toUpperCase();
    if (finalCode && !CODE_PATTERN.test(finalCode)) {
      throw new Error('كود الصنف يجب أن يحتوي على أحرف إنجليزية وأرقام أو (- , _) فقط.');
    }

    await runTransaction(db, async (tx) => {
      const countersSnap = await tx.get(countersRef);
      const nextSeq = countersSnap.exists()
        ? Number(countersSnap.data().nextProductSeq || 1001)
        : 1001;

      if (!finalCode) {
        finalCode = `HS-${nextSeq}`;
      }

      const codeDocId = makeSafeCodeId(finalCode);
      const codeRef = doc(db, 'product_codes', codeDocId);
      const codeSnap = await tx.get(codeRef);
      if (codeSnap.exists()) {
        throw new Error(`كود الصنف "${finalCode}" مستخدم بالفعل لصنف آخر. يرجى اختيار كود فريد.`);
      }

      const cleanStock = Math.max(0, Number(input.stock) || 0);
      const cleanCost = roundMoney(Math.max(0, Number(input.costPrice) || 0));
      const cleanSell = roundMoney(Math.max(0, Number(input.sellPrice) || 0));
      const cleanMin = Math.max(0, Number(input.minStock) || 0);

      if (countersSnap.exists()) {
        tx.update(countersRef, {
          nextProductSeq: nextSeq + 1,
          updatedAt: serverTimestamp(),
        });
      }

      tx.set(codeRef, {
        code: finalCode,
        productId,
        createdAt: serverTimestamp(),
      });

      const payload: Record<string, unknown> = {
        code: truncateText(finalCode, FIELD_LIMITS.codeMax),
        name: truncateText(input.name, FIELD_LIMITS.nameMax),
        category: truncateText(input.category || 'عام', FIELD_LIMITS.categoryMax),
        unit: truncateText(input.unit || 'حبة', FIELD_LIMITS.unitMax),
        costPrice: cleanCost,
        sellPrice: cleanSell,
        stock: cleanStock,
        minStock: cleanMin,
        isActive: true,
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (input.barcode?.trim()) {
        payload.barcode = truncateText(input.barcode, FIELD_LIMITS.barcodeMax);
      }
      if (input.description?.trim()) {
        payload.description = truncateText(input.description, FIELD_LIMITS.descriptionMax);
      }

      tx.set(productRef, payload);

      if (cleanStock > 0) {
        const movId = generateDocId('mov');
        tx.set(doc(db, 'stock_movements', movId), {
          productId,
          productCode: finalCode,
          productName: truncateText(input.name, FIELD_LIMITS.nameMax),
          type: 'in',
          qtyChange: cleanStock,
          previousStock: 0,
          newStock: cleanStock,
          referenceType: 'initial',
          referenceId: productId,
          referenceNumber: finalCode,
          reason: 'رصيد افتتاحي عند إضافة الصنف',
          employeeId: actor.uid,
          employeeName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
          ...deviceFieldsFor(actor),
          createdAt: serverTimestamp(),
        });
      }

      tx.set(
        doc(db, 'audit_logs', generateDocId('aud')),
        buildAuditEntry(
          actor,
          'إضافة صنف',
          'product',
          productId,
          `إضافة الصنف ${input.name} (${finalCode}) بسعر بيع ${cleanSell}`
        )
      );
    });

    return productId;
  } catch (err) {
    if (err instanceof Error && (err.message.includes('مستخدم بالفعل') || err.message.includes('كود الصنف'))) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, 'products');
  }
}

export async function updateProduct(
  actor: ActorInfo,
  product: Product,
  updates: {
    barcode?: string;
    name: string;
    category: string;
    description?: string;
    unit: string;
    costPrice: number;
    sellPrice: number;
    minStock: number;
    isActive: boolean;
  }
): Promise<void> {
  try {
    const productRef = doc(db, 'products', product.id);
    const payload: Record<string, unknown> = {
      name: truncateText(updates.name, FIELD_LIMITS.nameMax),
      category: truncateText(updates.category, FIELD_LIMITS.categoryMax),
      unit: truncateText(updates.unit, FIELD_LIMITS.unitMax),
      costPrice: roundMoney(Math.max(0, updates.costPrice)),
      sellPrice: roundMoney(Math.max(0, updates.sellPrice)),
      minStock: Math.max(0, updates.minStock),
      isActive: updates.isActive,
      barcode: updates.barcode?.trim()
        ? truncateText(updates.barcode, FIELD_LIMITS.barcodeMax)
        : deleteField(),
      description: updates.description?.trim()
        ? truncateText(updates.description, FIELD_LIMITS.descriptionMax)
        : deleteField(),
      updatedAt: serverTimestamp(),
    };

    await runTransaction(db, async (tx) => {
      tx.update(productRef, payload);
      tx.set(
        doc(db, 'audit_logs', generateDocId('aud')),
        buildAuditEntry(
          actor,
          'تعديل صنف',
          'product',
          product.id,
          `تعديل بيانات الصنف ${updates.name} (${product.code})`,
          `سعر الشراء: ${product.costPrice} -> ${payload.costPrice}, سعر البيع: ${product.sellPrice} -> ${payload.sellPrice}`
        )
      );
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `products/${product.id}`);
  }
}

export async function deleteProduct(actor: ActorInfo, product: Product): Promise<void> {
  try {
    await runTransaction(db, async (tx) => {
      tx.delete(doc(db, 'products', product.id));
      tx.delete(doc(db, 'product_codes', makeSafeCodeId(product.code)));
      tx.set(
        doc(db, 'audit_logs', generateDocId('aud')),
        buildAuditEntry(
          actor,
          'حذف صنف',
          'product',
          product.id,
          `حذف الصنف ${product.name} (${product.code})`
        )
      );
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `products/${product.id}`);
  }
}

// ---------------- CUSTOMERS & SUPPLIERS ----------------
export async function createCustomer(
  actor: ActorInfo,
  input: { name: string; phone?: string; address?: string; notes?: string }
): Promise<Customer> {
  const customerId = generateDocId('cust');
  const countersRef = doc(db, 'counters', 'main');
  const custRef = doc(db, 'customers', customerId);
  let generatedCode = '';

  try {
    await runTransaction(db, async (tx) => {
      const cSnap = await tx.get(countersRef);
      const seq = cSnap.exists() ? Number(cSnap.data().nextCustomerSeq || 1001) : 1001;
      generatedCode = `C-${seq}`;

      if (cSnap.exists()) {
        tx.update(countersRef, {
          nextCustomerSeq: seq + 1,
          updatedAt: serverTimestamp(),
        });
      }

      const data: Record<string, unknown> = {
        customerCode: generatedCode,
        name: truncateText(input.name, FIELD_LIMITS.partyNameMax),
        totalPurchases: 0,
        totalPaid: 0,
        balanceDue: 0,
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (input.phone?.trim()) data.phone = truncateText(input.phone, FIELD_LIMITS.phoneMax);
      if (input.address?.trim()) data.address = truncateText(input.address, FIELD_LIMITS.addressMax);
      if (input.notes?.trim()) data.notes = truncateText(input.notes, FIELD_LIMITS.notesMax);

      tx.set(custRef, data);
      tx.set(
        doc(db, 'audit_logs', generateDocId('aud')),
        buildAuditEntry(actor, 'إضافة عميل', 'customer', customerId, `تسجيل العميل ${input.name} (${generatedCode})`)
      );
    });

    return {
      id: customerId,
      customerCode: generatedCode,
      name: truncateText(input.name, FIELD_LIMITS.partyNameMax),
      phone: input.phone?.trim(),
      address: input.address?.trim(),
      notes: input.notes?.trim(),
      totalPurchases: 0,
      totalPaid: 0,
      balanceDue: 0,
      createdBy: actor.uid,
      createdAt: null,
      updatedAt: null,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'customers');
  }
}

export async function updateCustomer(
  actor: ActorInfo,
  customer: Customer,
  input: { name: string; phone?: string; address?: string; notes?: string }
): Promise<void> {
  try {
    const custRef = doc(db, 'customers', customer.id);
    const data: Record<string, unknown> = {
      name: truncateText(input.name, FIELD_LIMITS.partyNameMax),
      phone: input.phone?.trim()
        ? truncateText(input.phone, FIELD_LIMITS.phoneMax)
        : deleteField(),
      address: input.address?.trim()
        ? truncateText(input.address, FIELD_LIMITS.addressMax)
        : deleteField(),
      notes: input.notes?.trim()
        ? truncateText(input.notes, FIELD_LIMITS.notesMax)
        : deleteField(),
      updatedAt: serverTimestamp(),
    };

    await runTransaction(db, async (tx) => {
      tx.update(custRef, data);
      tx.set(
        doc(db, 'audit_logs', generateDocId('aud')),
        buildAuditEntry(actor, 'تعديل عميل', 'customer', customer.id, `تحديث بيانات العميل ${input.name} (${customer.customerCode})`)
      );
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `customers/${customer.id}`);
  }
}

export async function createSupplier(
  actor: ActorInfo,
  input: { name: string; phone?: string; address?: string; notes?: string }
): Promise<string> {
  const supplierId = generateDocId('supp');
  const countersRef = doc(db, 'counters', 'main');
  const suppRef = doc(db, 'suppliers', supplierId);

  try {
    await runTransaction(db, async (tx) => {
      const cSnap = await tx.get(countersRef);
      const seq = cSnap.exists() ? Number(cSnap.data().nextSupplierSeq || 1001) : 1001;
      const code = `S-${seq}`;

      if (cSnap.exists()) {
        tx.update(countersRef, {
          nextSupplierSeq: seq + 1,
          updatedAt: serverTimestamp(),
        });
      }

      const data: Record<string, unknown> = {
        supplierCode: code,
        name: truncateText(input.name, FIELD_LIMITS.partyNameMax),
        totalPurchases: 0,
        totalPaid: 0,
        balanceDue: 0,
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (input.phone?.trim()) data.phone = truncateText(input.phone, FIELD_LIMITS.phoneMax);
      if (input.address?.trim()) data.address = truncateText(input.address, FIELD_LIMITS.addressMax);
      if (input.notes?.trim()) data.notes = truncateText(input.notes, FIELD_LIMITS.notesMax);

      tx.set(suppRef, data);
      tx.set(
        doc(db, 'audit_logs', generateDocId('aud')),
        buildAuditEntry(actor, 'إضافة مورد', 'supplier', supplierId, `تسجيل المورد ${input.name} (${code})`)
      );
    });
    return supplierId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'suppliers');
  }
}

export async function updateSupplier(
  actor: ActorInfo,
  supplier: Supplier,
  input: { name: string; phone?: string; address?: string; notes?: string }
): Promise<void> {
  try {
    const suppRef = doc(db, 'suppliers', supplier.id);
    const data: Record<string, unknown> = {
      name: truncateText(input.name, FIELD_LIMITS.partyNameMax),
      phone: input.phone?.trim()
        ? truncateText(input.phone, FIELD_LIMITS.phoneMax)
        : deleteField(),
      address: input.address?.trim()
        ? truncateText(input.address, FIELD_LIMITS.addressMax)
        : deleteField(),
      notes: input.notes?.trim()
        ? truncateText(input.notes, FIELD_LIMITS.notesMax)
        : deleteField(),
      updatedAt: serverTimestamp(),
    };

    await runTransaction(db, async (tx) => {
      tx.update(suppRef, data);
      tx.set(
        doc(db, 'audit_logs', generateDocId('aud')),
        buildAuditEntry(actor, 'تعديل مورد', 'supplier', supplier.id, `تحديث بيانات المورد ${input.name}`)
      );
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `suppliers/${supplier.id}`);
  }
}

// ---------------- POS SALE TRANSACTION ----------------
export interface SaleInputItem {
  productId: string;
  qty: number;
  unitPrice: number;
  code?: string;
  name?: string;
  unit?: string;
  costPrice?: number;
}

export async function executeSale(
  actor: ActorInfo,
  input: {
    customer: Pick<Customer, 'id' | 'customerCode' | 'name'> | null;
    items: SaleInputItem[];
    discount: number;
    paymentMethod: PaymentMethod;
    paidAmount: number;
    notes?: string;
    operationId?: string;
    skipQueue?: boolean;
  }
): Promise<{
  saleId: string;
  invoiceNumber: string;
  saleData: SaleInvoice;
  queued: boolean;
}> {
  if (input.items.length === 0 || input.items.length > FIELD_LIMITS.maxLineItems) {
    throw new Error('يجب أن تحتوي الفاتورة على صنف واحد على الأقل وبحد أقصى 100 صنف.');
  }

  if ((input.paymentMethod === 'credit' || input.paymentMethod === 'partial') && !input.customer) {
    throw new Error('البيع الآجل أو الدفع الجزئي يتطلب اختيار عميل مسجل.');
  }

  const opId = input.operationId || generateDocId('op');
  const devFields = deviceFieldsFor(actor);

  const buildProvisionalSale = (tempRef: string): SaleInvoice => {
    const items: SaleItem[] = input.items.map((it) => ({
      productId: it.productId,
      code: it.code || '',
      name: it.name || 'صنف',
      unit: it.unit || 'حبة',
      qty: it.qty,
      costPrice: it.costPrice || 0,
      unitPrice: roundMoney(Math.max(0, it.unitPrice)),
      lineTotal: roundMoney(Math.max(0, it.unitPrice) * it.qty),
    }));
    const subtotal = roundMoney(items.reduce((s, i) => s + i.lineTotal, 0));
    const totalCost = roundMoney(items.reduce((s, i) => s + i.costPrice * i.qty, 0));
    const discount = roundMoney(Math.min(Math.max(0, input.discount), subtotal));
    const total = roundMoney(Math.max(0, subtotal - discount));
    const paidAmount =
      input.paymentMethod === 'cash'
        ? total
        : input.paymentMethod === 'credit'
        ? 0
        : roundMoney(Math.min(Math.max(0, input.paidAmount), total));
    const remainingAmount = roundMoney(Math.max(0, total - paidAmount));
    return {
      id: opId,
      invoiceNumber: tempRef,
      employeeId: actor.uid,
      employeeName: actor.name,
      deviceId: devFields.deviceId,
      deviceName: devFields.deviceName,
      operationId: opId,
      customerId: input.customer?.id,
      customerCode: input.customer?.customerCode,
      customerName: input.customer ? input.customer.name : 'عميل نقدي عام',
      items,
      subtotal,
      discount,
      total,
      paidAmount,
      remainingAmount,
      totalCost,
      netProfit: roundMoney(total - totalCost),
      paymentMethod: input.paymentMethod,
      status: 'completed',
      notes: input.notes?.trim(),
      isOfflinePending: true,
      createdAt: null,
      updatedAt: null,
    };
  };

  const enqueueOfflineSale = () => {
    const tempRef = `OFF-${opId.slice(-5).toUpperCase()}`;
    const provisional = buildProvisionalSale(tempRef);
    const op: PendingOperation = {
      operationId: opId,
      type: 'sale',
      summary: `بيع ${tempRef} - ${provisional.customerName} (${provisional.total})`,
      localTempRef: tempRef,
      actor,
      payload: {
        customer: input.customer
          ? {
              id: input.customer.id,
              customerCode: input.customer.customerCode,
              name: input.customer.name,
            }
          : null,
        items: input.items,
        discount: input.discount,
        paymentMethod: input.paymentMethod,
        paidAmount: input.paidAmount,
        notes: input.notes?.trim() || '',
      },
      status: 'pending',
      attempts: 0,
      createdAtIso: new Date().toISOString(),
    };
    enqueuePendingOperation(op);
    return {
      saleId: opId,
      invoiceNumber: tempRef,
      saleData: provisional,
      queued: true,
    };
  };

  if (!navigator.onLine && !input.skipQueue) {
    return enqueueOfflineSale();
  }

  const saleId = generateDocId('sale');
  const countersRef = doc(db, 'counters', 'main');
  const opRef = doc(db, 'processed_operations', opId);
  const deviceRef = doc(db, 'devices', actor.deviceId);
  let resolvedSaleId = saleId;
  let invoiceNumber = '';
  let constructedSale!: SaleInvoice;

  try {
    await runTransaction(db, async (tx) => {
      // 1. ALL READS FIRST (including idempotency check)
      const opSnap = await tx.get(opRef);
      if (opSnap.exists()) {
        const opData = opSnap.data() as {
          referenceId: string;
          referenceNumber?: string;
        };
        resolvedSaleId = opData.referenceId;
        invoiceNumber = opData.referenceNumber || '';
        const existingSaleSnap = await tx.get(doc(db, 'sales', resolvedSaleId));
        if (existingSaleSnap.exists()) {
          constructedSale = {
            id: existingSaleSnap.id,
            ...(existingSaleSnap.data() as Omit<SaleInvoice, 'id'>),
          };
        } else {
          constructedSale = buildProvisionalSale(invoiceNumber);
        }
        return;
      }

      const [countersSnap, deviceSnap, prodSnaps, custSnap] = await Promise.all([
        tx.get(countersRef),
        tx.get(deviceRef),
        Promise.all(input.items.map((item) => tx.get(doc(db, 'products', item.productId)))),
        input.customer ? tx.get(doc(db, 'customers', input.customer.id)) : Promise.resolve(null),
      ]);

      if (deviceSnap.exists() && deviceSnap.data().status === 'blocked') {
        throw new Error('تم حظر هذا الجهاز من قبل المسؤول ولا يمكن تنفيذ عمليات منه.');
      }

      const seq = countersSnap.exists() ? Number(countersSnap.data().nextInvoiceSeq || 1) : 1;
      const currentCash = countersSnap.exists() ? Number(countersSnap.data().cashBalance || 0) : 0;
      invoiceNumber = `INV-${String(seq).padStart(5, '0')}`;

      // 2. VALIDATE STOCK & COMPUTE TOTALS
      const saleItems: SaleItem[] = [];
      let subtotal = 0;
      let totalCost = 0;
      const stockUpdates: {
        ref: ReturnType<typeof doc>;
        prevStock: number;
        newStock: number;
        qty: number;
        code: string;
        name: string;
      }[] = [];

      for (let idx = 0; idx < input.items.length; idx++) {
        const reqItem = input.items[idx];
        const snap = prodSnaps[idx];
        if (!snap.exists()) {
          throw new Error('أحد الأصناف المختارة غير موجود في قاعدة البيانات.');
        }
        const prod = snap.data() as Omit<Product, 'id'>;
        if (reqItem.qty <= 0) {
          throw new Error(`الكمية غير صالحة للصنف ${prod.name}.`);
        }
        if (prod.stock < reqItem.qty) {
          throw new Error(
            `الكمية المتوفرة من "${prod.name}" (${prod.stock}) أقل من المطلوب (${reqItem.qty}).`
          );
        }

        const unitPrice = roundMoney(Math.max(0, reqItem.unitPrice));
        const lineTotal = roundMoney(unitPrice * reqItem.qty);
        const lineCost = roundMoney(prod.costPrice * reqItem.qty);
        subtotal = roundMoney(subtotal + lineTotal);
        totalCost = roundMoney(totalCost + lineCost);

        saleItems.push({
          productId: snap.id,
          code: prod.code,
          name: prod.name,
          unit: prod.unit,
          qty: reqItem.qty,
          costPrice: prod.costPrice,
          unitPrice,
          lineTotal,
        });

        stockUpdates.push({
          ref: snap.ref,
          prevStock: prod.stock,
          newStock: roundMoney(prod.stock - reqItem.qty),
          qty: reqItem.qty,
          code: prod.code,
          name: prod.name,
        });
      }

      const discount = roundMoney(Math.min(Math.max(0, input.discount), subtotal));
      const total = roundMoney(Math.max(0, subtotal - discount));
      const paidAmount =
        input.paymentMethod === 'cash'
          ? total
          : input.paymentMethod === 'credit'
          ? 0
          : roundMoney(Math.min(Math.max(0, input.paidAmount), total));
      const remainingAmount = roundMoney(Math.max(0, total - paidAmount));
      const netProfit = roundMoney(total - totalCost);
      const newCashBalance = roundMoney(currentCash + paidAmount);

      // 3. ALL WRITES
      if (countersSnap.exists()) {
        tx.update(countersRef, {
          nextInvoiceSeq: seq + 1,
          cashBalance: newCashBalance,
          updatedAt: serverTimestamp(),
        });
      }

      for (const upd of stockUpdates) {
        tx.update(upd.ref, {
          stock: upd.newStock,
          updatedAt: serverTimestamp(),
        });

        tx.set(doc(db, 'stock_movements', generateDocId('mov')), {
          productId: upd.ref.id,
          productCode: upd.code,
          productName: truncateText(upd.name, FIELD_LIMITS.nameMax),
          type: 'sale' as StockMovementType,
          qtyChange: -upd.qty,
          previousStock: upd.prevStock,
          newStock: upd.newStock,
          referenceType: 'sale',
          referenceId: saleId,
          referenceNumber: invoiceNumber,
          reason: `فاتورة مبيعات رقم ${invoiceNumber}`,
          employeeId: actor.uid,
          employeeName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
          ...devFields,
          createdAt: serverTimestamp(),
        });
      }

      if (custSnap && custSnap.exists()) {
        const cData = custSnap.data() as Omit<Customer, 'id'>;
        tx.update(custSnap.ref, {
          totalPurchases: roundMoney(cData.totalPurchases + total),
          totalPaid: roundMoney(cData.totalPaid + paidAmount),
          balanceDue: roundMoney(cData.balanceDue + remainingAmount),
          updatedAt: serverTimestamp(),
        });
      }

      const salePayload: Record<string, unknown> = {
        invoiceNumber,
        employeeId: actor.uid,
        employeeName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
        ...devFields,
        operationId: opId,
        customerName: truncateText(
          input.customer ? input.customer.name : 'عميل نقدي عام',
          FIELD_LIMITS.partyNameMax
        ),
        items: saleItems,
        subtotal,
        discount,
        total,
        paidAmount,
        remainingAmount,
        totalCost,
        netProfit,
        paymentMethod: input.paymentMethod,
        status: 'completed',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      if (input.customer) {
        salePayload.customerId = input.customer.id;
        salePayload.customerCode = input.customer.customerCode;
      }
      if (input.notes?.trim()) {
        salePayload.notes = truncateText(input.notes, FIELD_LIMITS.notesMax);
      }

      tx.set(doc(db, 'sales', saleId), salePayload);

      if (paidAmount > 0) {
        tx.set(doc(db, 'cash_transactions', generateDocId('cash')), {
          type: 'in',
          category: 'مبيعات',
          amount: paidAmount,
          balanceAfter: newCashBalance,
          referenceId: saleId,
          referenceNumber: invoiceNumber,
          description: `تحصيل فاتورة مبيعات ${invoiceNumber} - ${salePayload.customerName}`,
          employeeId: actor.uid,
          employeeName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
          ...devFields,
          createdAt: serverTimestamp(),
        });
      }

      tx.set(
        doc(db, 'audit_logs', generateDocId('aud')),
        buildAuditEntry(
          actor,
          'عملية بيع',
          'sale',
          saleId,
          `فاتورة ${invoiceNumber} للعميل ${salePayload.customerName} بقيمة ${total} (مدفوع: ${paidAmount}، متبقي: ${remainingAmount})`
        )
      );

      tx.set(opRef, {
        operationId: opId,
        operationType: 'sale',
        referenceId: saleId,
        referenceNumber: invoiceNumber,
        employeeId: actor.uid,
        ...devFields,
        createdAt: serverTimestamp(),
      });

      if (deviceSnap.exists() && deviceSnap.data().status === 'active') {
        tx.update(deviceRef, {
          userId: actor.uid,
          userName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
          userRole: actor.role,
          deviceName: devFields.deviceName,
          lastOperationSummary: truncateText(`فاتورة بيع ${invoiceNumber} (${total})`, 240),
          lastActiveAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      constructedSale = {
        id: saleId,
        invoiceNumber,
        employeeId: actor.uid,
        employeeName: actor.name,
        deviceId: devFields.deviceId,
        deviceName: devFields.deviceName,
        operationId: opId,
        customerId: input.customer?.id,
        customerCode: input.customer?.customerCode,
        customerName: String(salePayload.customerName),
        items: saleItems,
        subtotal,
        discount,
        total,
        paidAmount,
        remainingAmount,
        totalCost,
        netProfit,
        paymentMethod: input.paymentMethod,
        status: 'completed',
        notes: input.notes?.trim(),
        createdAt: null,
        updatedAt: null,
      };
    });

    return {
      saleId: resolvedSaleId,
      invoiceNumber,
      saleData: constructedSale,
      queued: false,
    };
  } catch (err) {
    if (isNetworkOrOfflineError(err) && !input.skipQueue) {
      return enqueueOfflineSale();
    }
    if (
      err instanceof Error &&
      (err.message.includes('الكمية المتوفرة') ||
        err.message.includes('الكمية غير صالحة') ||
        err.message.includes('غير موجود') ||
        err.message.includes('محظور'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, 'sales');
  }
}

// ---------------- PURCHASES ----------------
export async function executePurchase(
  actor: ActorInfo,
  input: {
    supplier: Pick<Supplier, 'id' | 'supplierCode' | 'name'>;
    items: { productId: string; qty: number; costPrice: number; updateProductCost: boolean }[];
    paymentMethod: PaymentMethod;
    paidAmount: number;
    notes?: string;
    operationId?: string;
    skipQueue?: boolean;
  }
): Promise<{ purchaseId: string; queued: boolean }> {
  if (input.items.length === 0 || input.items.length > FIELD_LIMITS.maxLineItems) {
    throw new Error('يجب أن تحتوي فاتورة الشراء على صنف واحد على الأقل.');
  }

  const opId = input.operationId || generateDocId('op');
  const devFields = deviceFieldsFor(actor);

  const enqueueOfflinePurchase = () => {
    const tempRef = `OFF-PUR-${opId.slice(-4).toUpperCase()}`;
    enqueuePendingOperation({
      operationId: opId,
      type: 'purchase',
      summary: `شراء ${tempRef} من ${input.supplier.name}`,
      localTempRef: tempRef,
      actor,
      payload: {
        supplier: {
          id: input.supplier.id,
          supplierCode: input.supplier.supplierCode,
          name: input.supplier.name,
        },
        items: input.items,
        paymentMethod: input.paymentMethod,
        paidAmount: input.paidAmount,
        notes: input.notes?.trim() || '',
      },
      status: 'pending',
      attempts: 0,
      createdAtIso: new Date().toISOString(),
    });
    return { purchaseId: opId, queued: true };
  };

  if (!navigator.onLine && !input.skipQueue) {
    return enqueueOfflinePurchase();
  }

  const purchaseId = generateDocId('pur');
  const countersRef = doc(db, 'counters', 'main');
  const opRef = doc(db, 'processed_operations', opId);
  const deviceRef = doc(db, 'devices', actor.deviceId);
  let resolvedId = purchaseId;

  try {
    await runTransaction(db, async (tx) => {
      const opSnap = await tx.get(opRef);
      if (opSnap.exists()) {
        resolvedId = String(opSnap.data().referenceId || purchaseId);
        return;
      }

      const [countersSnap, deviceSnap, prodSnaps, suppSnap] = await Promise.all([
        tx.get(countersRef),
        tx.get(deviceRef),
        Promise.all(input.items.map((item) => tx.get(doc(db, 'products', item.productId)))),
        tx.get(doc(db, 'suppliers', input.supplier.id)),
      ]);

      if (deviceSnap.exists() && deviceSnap.data().status === 'blocked') {
        throw new Error('تم حظر هذا الجهاز من قبل المسؤول ولا يمكن تنفيذ عمليات منه.');
      }
      if (!suppSnap.exists()) throw new Error('المورد المحدد غير موجود.');

      const seq = countersSnap.exists() ? Number(countersSnap.data().nextPurchaseSeq || 1) : 1;
      const currentCash = countersSnap.exists() ? Number(countersSnap.data().cashBalance || 0) : 0;
      const purchaseNumber = `PUR-${String(seq).padStart(5, '0')}`;

      const purchaseItems: PurchaseItem[] = [];
      let total = 0;
      const updates: {
        ref: ReturnType<typeof doc>;
        prevStock: number;
        newStock: number;
        qty: number;
        newCost: number;
        updateCost: boolean;
        code: string;
        name: string;
      }[] = [];

      for (let i = 0; i < input.items.length; i++) {
        const req = input.items[i];
        const snap = prodSnaps[i];
        if (!snap.exists()) throw new Error('أحد الأصناف غير موجود.');
        const prod = snap.data() as Omit<Product, 'id'>;
        if (req.qty <= 0) throw new Error(`كمية غير صالحة للصنف ${prod.name}`);

        const costPrice = roundMoney(Math.max(0, req.costPrice));
        const lineTotal = roundMoney(costPrice * req.qty);
        total = roundMoney(total + lineTotal);

        purchaseItems.push({
          productId: snap.id,
          code: prod.code,
          name: prod.name,
          unit: prod.unit,
          qty: req.qty,
          costPrice,
          lineTotal,
        });

        updates.push({
          ref: snap.ref,
          prevStock: prod.stock,
          newStock: roundMoney(prod.stock + req.qty),
          qty: req.qty,
          newCost: costPrice,
          updateCost: req.updateProductCost,
          code: prod.code,
          name: prod.name,
        });
      }

      const paidAmount =
        input.paymentMethod === 'cash'
          ? total
          : input.paymentMethod === 'credit'
          ? 0
          : roundMoney(Math.min(Math.max(0, input.paidAmount), total));
      const remainingAmount = roundMoney(Math.max(0, total - paidAmount));
      const newCashBalance = roundMoney(currentCash - paidAmount);

      if (countersSnap.exists()) {
        tx.update(countersRef, {
          nextPurchaseSeq: seq + 1,
          cashBalance: newCashBalance,
          updatedAt: serverTimestamp(),
        });
      }

      for (const u of updates) {
        const prodUpd: Record<string, unknown> = {
          stock: u.newStock,
          updatedAt: serverTimestamp(),
        };
        if (u.updateCost) prodUpd.costPrice = u.newCost;
        tx.update(u.ref, prodUpd);

        tx.set(doc(db, 'stock_movements', generateDocId('mov')), {
          productId: u.ref.id,
          productCode: u.code,
          productName: truncateText(u.name, FIELD_LIMITS.nameMax),
          type: 'purchase',
          qtyChange: u.qty,
          previousStock: u.prevStock,
          newStock: u.newStock,
          referenceType: 'purchase',
          referenceId: purchaseId,
          referenceNumber: purchaseNumber,
          reason: `فاتورة مشتريات رقم ${purchaseNumber} من ${input.supplier.name}`,
          employeeId: actor.uid,
          employeeName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
          ...devFields,
          createdAt: serverTimestamp(),
        });
      }

      const sData = suppSnap.data() as Omit<Supplier, 'id'>;
      tx.update(suppSnap.ref, {
        totalPurchases: roundMoney(sData.totalPurchases + total),
        totalPaid: roundMoney(sData.totalPaid + paidAmount),
        balanceDue: roundMoney(sData.balanceDue + remainingAmount),
        updatedAt: serverTimestamp(),
      });

      const purchasePayload: Record<string, unknown> = {
        purchaseNumber,
        supplierId: input.supplier.id,
        supplierCode: input.supplier.supplierCode,
        supplierName: truncateText(input.supplier.name, FIELD_LIMITS.partyNameMax),
        employeeId: actor.uid,
        employeeName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
        ...devFields,
        operationId: opId,
        items: purchaseItems,
        total,
        paidAmount,
        remainingAmount,
        paymentMethod: input.paymentMethod,
        status: 'completed',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (input.notes?.trim()) {
        purchasePayload.notes = truncateText(input.notes, FIELD_LIMITS.notesMax);
      }

      tx.set(doc(db, 'purchases', purchaseId), purchasePayload);

      if (paidAmount > 0) {
        tx.set(doc(db, 'cash_transactions', generateDocId('cash')), {
          type: 'out',
          category: 'مشتريات',
          amount: paidAmount,
          balanceAfter: newCashBalance,
          referenceId: purchaseId,
          referenceNumber: purchaseNumber,
          description: `سداد فاتورة شراء ${purchaseNumber} للمورد ${input.supplier.name}`,
          employeeId: actor.uid,
          employeeName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
          ...devFields,
          createdAt: serverTimestamp(),
        });
      }

      tx.set(
        doc(db, 'audit_logs', generateDocId('aud')),
        buildAuditEntry(
          actor,
          'فاتورة شراء',
          'purchase',
          purchaseId,
          `شراء بضاعة ${purchaseNumber} من ${input.supplier.name} بقيمة ${total}`
        )
      );

      tx.set(opRef, {
        operationId: opId,
        operationType: 'purchase',
        referenceId: purchaseId,
        referenceNumber: purchaseNumber,
        employeeId: actor.uid,
        ...devFields,
        createdAt: serverTimestamp(),
      });

      if (deviceSnap.exists() && deviceSnap.data().status === 'active') {
        tx.update(deviceRef, {
          userId: actor.uid,
          userName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
          userRole: actor.role,
          deviceName: devFields.deviceName,
          lastOperationSummary: truncateText(`فاتورة شراء ${purchaseNumber} (${total})`, 240),
          lastActiveAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
    return { purchaseId: resolvedId, queued: false };
  } catch (err) {
    if (isNetworkOrOfflineError(err) && !input.skipQueue) {
      return enqueueOfflinePurchase();
    }
    if (
      err instanceof Error &&
      (err.message.includes('غير موجود') ||
        err.message.includes('كمية غير صالحة') ||
        err.message.includes('محظور'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, 'purchases');
  }
}

// ---------------- RETURNS & CANCELLATION ----------------
export async function executeSalesReturn(
  actor: ActorInfo,
  input: {
    sale: SaleInvoice;
    existingReturns: SalesReturn[];
    itemsToReturn: { productId: string; qty: number }[];
    restockValid: boolean;
    refundCash: boolean;
    reason: string;
    operationId?: string;
    skipQueue?: boolean;
  }
): Promise<{ returnId: string; queued: boolean }> {
  if (input.sale.status === 'cancelled') {
    throw new Error('لا يمكن تسجيل مرتجع لفاتورة ملغاة.');
  }

  const activeReturnItems = input.itemsToReturn.filter((i) => i.qty > 0);
  if (activeReturnItems.length === 0) {
    throw new Error('يرجى تحديد كمية واحدة على الأقل للإرجاع.');
  }

  const opId = input.operationId || generateDocId('op');
  const devFields = deviceFieldsFor(actor);

  const enqueueOfflineReturn = () => {
    const tempRef = `OFF-RET-${opId.slice(-4).toUpperCase()}`;
    enqueuePendingOperation({
      operationId: opId,
      type: 'return',
      summary: `مرتجع فاتورة ${input.sale.invoiceNumber}`,
      localTempRef: tempRef,
      actor,
      payload: {
        saleId: input.sale.id,
        itemsToReturn: activeReturnItems,
        restockValid: input.restockValid,
        refundCash: input.refundCash,
        reason: input.reason,
      },
      status: 'pending',
      attempts: 0,
      createdAtIso: new Date().toISOString(),
    });
    return { returnId: opId, queued: true };
  };

  if (!navigator.onLine && !input.skipQueue) {
    return enqueueOfflineReturn();
  }

  // Compute already returned qty per productId
  const alreadyReturnedMap = new Map<string, number>();
  for (const r of input.existingReturns) {
    if (r.saleId === input.sale.id) {
      for (const it of r.items) {
        alreadyReturnedMap.set(
          it.productId,
          (alreadyReturnedMap.get(it.productId) || 0) + it.qty
        );
      }
    }
  }

  const returnId = generateDocId('ret');
  const countersRef = doc(db, 'counters', 'main');
  const saleRef = doc(db, 'sales', input.sale.id);
  const opRef = doc(db, 'processed_operations', opId);
  const deviceRef = doc(db, 'devices', actor.deviceId);
  let resolvedReturnId = returnId;

  try {
    await runTransaction(db, async (tx) => {
      const opSnap = await tx.get(opRef);
      if (opSnap.exists()) {
        resolvedReturnId = String(opSnap.data().referenceId || returnId);
        return;
      }

      const [countersSnap, deviceSnap, saleSnap, prodSnaps, custSnap] = await Promise.all([
        tx.get(countersRef),
        tx.get(deviceRef),
        tx.get(saleRef),
        Promise.all(activeReturnItems.map((i) => tx.get(doc(db, 'products', i.productId)))),
        input.sale.customerId
          ? tx.get(doc(db, 'customers', input.sale.customerId))
          : Promise.resolve(null),
      ]);

      if (deviceSnap.exists() && deviceSnap.data().status === 'blocked') {
        throw new Error('تم حظر هذا الجهاز من قبل المسؤول ولا يمكن تنفيذ عمليات منه.');
      }

      const seq = countersSnap.exists() ? Number(countersSnap.data().nextReturnSeq || 1) : 1;
      const currentCash = countersSnap.exists() ? Number(countersSnap.data().cashBalance || 0) : 0;
      const returnNumber = `RET-${String(seq).padStart(5, '0')}`;

      if (!saleSnap.exists()) throw new Error('الفاتورة غير موجودة.');
      const saleData = saleSnap.data() as Omit<SaleInvoice, 'id'>;
      if (saleData.status === 'cancelled') throw new Error('الفاتورة ملغاة بالفعل.');

      const returnItems: ReturnItem[] = [];
      let refundAmount = 0;
      let returnedCost = 0;
      const prodUpdates: {
        ref: ReturnType<typeof doc>;
        prevStock: number;
        newStock: number;
        qty: number;
        code: string;
        name: string;
      }[] = [];

      const discountRatio =
        saleData.subtotal > 0 ? saleData.total / saleData.subtotal : 1;

      for (let i = 0; i < activeReturnItems.length; i++) {
        const req = activeReturnItems[i];
        const origItem = saleData.items.find((x) => x.productId === req.productId);
        if (!origItem) throw new Error('الصنف غير موجود في الفاتورة.');

        const prevRet = alreadyReturnedMap.get(req.productId) || 0;
        const maxAllowed = origItem.qty - prevRet;
        if (req.qty > maxAllowed) {
          throw new Error(
            `الكمية المرتجعة من "${origItem.name}" (${req.qty}) تتجاوز المتبقي القابل للإرجاع (${maxAllowed}).`
          );
        }

        const effectiveUnitPrice = roundMoney(origItem.unitPrice * discountRatio);
        const lineTotal = roundMoney(effectiveUnitPrice * req.qty);
        const lineCost = roundMoney(origItem.costPrice * req.qty);
        refundAmount = roundMoney(refundAmount + lineTotal);
        returnedCost = roundMoney(returnedCost + lineCost);

        returnItems.push({
          productId: origItem.productId,
          code: origItem.code,
          name: origItem.name,
          qty: req.qty,
          unitPrice: effectiveUnitPrice,
          costPrice: origItem.costPrice,
          lineTotal,
        });

        const pSnap = prodSnaps[i];
        if (input.restockValid && pSnap.exists()) {
          const pData = pSnap.data() as Omit<Product, 'id'>;
          prodUpdates.push({
            ref: pSnap.ref,
            prevStock: pData.stock,
            newStock: roundMoney(pData.stock + req.qty),
            qty: req.qty,
            code: pData.code,
            name: pData.name,
          });
        }
      }

      const returnedProfit = roundMoney(refundAmount - returnedCost);

      let allReturned = true;
      for (const orig of saleData.items) {
        const prevRet = alreadyReturnedMap.get(orig.productId) || 0;
        const nowRet =
          activeReturnItems.find((x) => x.productId === orig.productId)?.qty || 0;
        if (prevRet + nowRet < orig.qty) {
          allReturned = false;
          break;
        }
      }

      const cashOutAmount = input.refundCash ? refundAmount : 0;
      const newCashBalance = roundMoney(currentCash - cashOutAmount);

      if (countersSnap.exists()) {
        tx.update(countersRef, {
          nextReturnSeq: seq + 1,
          cashBalance: newCashBalance,
          updatedAt: serverTimestamp(),
        });
      }

      tx.update(saleRef, {
        status: allReturned ? 'returned' : 'partial_return',
        updatedAt: serverTimestamp(),
      });

      for (const pu of prodUpdates) {
        tx.update(pu.ref, {
          stock: pu.newStock,
          updatedAt: serverTimestamp(),
        });
        tx.set(doc(db, 'stock_movements', generateDocId('mov')), {
          productId: pu.ref.id,
          productCode: pu.code,
          productName: truncateText(pu.name, FIELD_LIMITS.nameMax),
          type: 'return',
          qtyChange: pu.qty,
          previousStock: pu.prevStock,
          newStock: pu.newStock,
          referenceType: 'return',
          referenceId: returnId,
          referenceNumber: returnNumber,
          reason: `مرتجع فاتورة ${input.sale.invoiceNumber}: ${truncateText(input.reason, 180)}`,
          employeeId: actor.uid,
          employeeName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
          ...devFields,
          createdAt: serverTimestamp(),
        });
      }

      if (custSnap && custSnap.exists()) {
        const cData = custSnap.data() as Omit<Customer, 'id'>;
        const debtReduction = input.refundCash ? 0 : Math.min(cData.balanceDue, refundAmount);
        tx.update(custSnap.ref, {
          totalPurchases: Math.max(0, roundMoney(cData.totalPurchases - refundAmount)),
          totalPaid: input.refundCash
            ? Math.max(0, roundMoney(cData.totalPaid - refundAmount))
            : cData.totalPaid,
          balanceDue: roundMoney(cData.balanceDue - debtReduction),
          updatedAt: serverTimestamp(),
        });
      }

      const returnPayload: Record<string, unknown> = {
        returnNumber,
        saleId: input.sale.id,
        invoiceNumber: input.sale.invoiceNumber,
        customerName: input.sale.customerName,
        employeeId: actor.uid,
        employeeName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
        ...devFields,
        operationId: opId,
        items: returnItems,
        refundAmount,
        returnedCost,
        returnedProfit,
        reason: truncateText(input.reason, FIELD_LIMITS.notesMax),
        restockValid: input.restockValid,
        createdAt: serverTimestamp(),
      };
      if (input.sale.customerId) returnPayload.customerId = input.sale.customerId;

      tx.set(doc(db, 'returns', returnId), returnPayload);

      if (cashOutAmount > 0) {
        tx.set(doc(db, 'cash_transactions', generateDocId('cash')), {
          type: 'out',
          category: 'مرتجعات',
          amount: cashOutAmount,
          balanceAfter: newCashBalance,
          referenceId: returnId,
          referenceNumber: returnNumber,
          description: `رد مبلغ مرتجع ${returnNumber} عن فاتورة ${input.sale.invoiceNumber}`,
          employeeId: actor.uid,
          employeeName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
          ...devFields,
          createdAt: serverTimestamp(),
        });
      }

      tx.set(
        doc(db, 'audit_logs', generateDocId('aud')),
        buildAuditEntry(
          actor,
          'تسجيل مرتجع',
          'return',
          returnId,
          `مرتجع ${returnNumber} للفاتورة ${input.sale.invoiceNumber} بمبلغ ${refundAmount} - السبب: ${input.reason}`
        )
      );

      tx.set(opRef, {
        operationId: opId,
        operationType: 'return',
        referenceId: returnId,
        referenceNumber: returnNumber,
        employeeId: actor.uid,
        ...devFields,
        createdAt: serverTimestamp(),
      });

      if (deviceSnap.exists() && deviceSnap.data().status === 'active') {
        tx.update(deviceRef, {
          userId: actor.uid,
          userName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
          userRole: actor.role,
          deviceName: devFields.deviceName,
          lastOperationSummary: truncateText(`مرتجع ${returnNumber} (${refundAmount})`, 240),
          lastActiveAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });

    return { returnId: resolvedReturnId, queued: false };
  } catch (err) {
    if (isNetworkOrOfflineError(err) && !input.skipQueue) {
      return enqueueOfflineReturn();
    }
    if (
      err instanceof Error &&
      (err.message.includes('تتجاوز') ||
        err.message.includes('غير موجود') ||
        err.message.includes('ملغاة') ||
        err.message.includes('محظور'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, 'returns');
  }
}

export async function cancelSaleInvoice(
  actor: ActorInfo,
  sale: SaleInvoice,
  reason: string
): Promise<void> {
  if (sale.status === 'cancelled') return;

  const countersRef = doc(db, 'counters', 'main');
  const saleRef = doc(db, 'sales', sale.id);
  const devFields = deviceFieldsFor(actor);

  try {
    await runTransaction(db, async (tx) => {
      const countersSnap = await tx.get(countersRef);
      const currentCash = countersSnap.exists() ? Number(countersSnap.data().cashBalance || 0) : 0;
      const saleSnap = await tx.get(saleRef);
      if (!saleSnap.exists()) throw new Error('الفاتورة غير موجودة.');

      const prodSnaps = await Promise.all(
        sale.items.map((item) => tx.get(doc(db, 'products', item.productId)))
      );
      const custSnap = sale.customerId
        ? await tx.get(doc(db, 'customers', sale.customerId))
        : null;

      const newCashBalance = roundMoney(currentCash - sale.paidAmount);
      if (countersSnap.exists() && sale.paidAmount > 0) {
        tx.update(countersRef, {
          cashBalance: newCashBalance,
          updatedAt: serverTimestamp(),
        });
      }

      tx.update(saleRef, {
        status: 'cancelled',
        notes: truncateText(`ملغاة: ${reason}`, FIELD_LIMITS.notesMax),
        updatedAt: serverTimestamp(),
      });

      for (let i = 0; i < sale.items.length; i++) {
        const it = sale.items[i];
        const pSnap = prodSnaps[i];
        if (pSnap.exists()) {
          const pData = pSnap.data() as Omit<Product, 'id'>;
          const newStock = roundMoney(pData.stock + it.qty);
          tx.update(pSnap.ref, {
            stock: newStock,
            updatedAt: serverTimestamp(),
          });
          tx.set(doc(db, 'stock_movements', generateDocId('mov')), {
            productId: pSnap.id,
            productCode: pData.code,
            productName: truncateText(pData.name, FIELD_LIMITS.nameMax),
            type: 'cancel_restore',
            qtyChange: it.qty,
            previousStock: pData.stock,
            newStock,
            referenceType: 'sale_cancel',
            referenceId: sale.id,
            referenceNumber: sale.invoiceNumber,
            reason: `إلغاء فاتورة ${sale.invoiceNumber}: ${truncateText(reason, 180)}`,
            employeeId: actor.uid,
            employeeName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
            ...devFields,
            createdAt: serverTimestamp(),
          });
        }
      }

      if (custSnap && custSnap.exists()) {
        const cData = custSnap.data() as Omit<Customer, 'id'>;
        tx.update(custSnap.ref, {
          totalPurchases: Math.max(0, roundMoney(cData.totalPurchases - sale.total)),
          totalPaid: Math.max(0, roundMoney(cData.totalPaid - sale.paidAmount)),
          balanceDue: roundMoney(cData.balanceDue - sale.remainingAmount),
          updatedAt: serverTimestamp(),
        });
      }

      if (sale.paidAmount > 0) {
        tx.set(doc(db, 'cash_transactions', generateDocId('cash')), {
          type: 'out',
          category: 'إلغاء فاتورة',
          amount: sale.paidAmount,
          balanceAfter: newCashBalance,
          referenceId: sale.id,
          referenceNumber: sale.invoiceNumber,
          description: `عكس تحصيل فاتورة ملغاة ${sale.invoiceNumber}`,
          employeeId: actor.uid,
          employeeName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
          ...devFields,
          createdAt: serverTimestamp(),
        });
      }

      tx.set(
        doc(db, 'audit_logs', generateDocId('aud')),
        buildAuditEntry(
          actor,
          'إلغاء فاتورة',
          'sale',
          sale.id,
          `إلغاء فاتورة ${sale.invoiceNumber} بقيمة ${sale.total} - السبب: ${reason}`
        )
      );
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `sales/${sale.id}`);
  }
}

// ---------------- INVENTORY ADJUSTMENT & STOCKTAKE ----------------
export async function recordStockAdjustment(
  actor: ActorInfo,
  input: {
    productId: string;
    productName?: string;
    mode: 'in' | 'out' | 'stocktake';
    quantityOrActual: number;
    reason: string;
    operationId?: string;
    skipQueue?: boolean;
  }
): Promise<{ queued: boolean }> {
  const opId = input.operationId || generateDocId('op');
  const devFields = deviceFieldsFor(actor);

  const enqueueOfflineStock = () => {
    const tempRef = `OFF-STK-${opId.slice(-4).toUpperCase()}`;
    enqueuePendingOperation({
      operationId: opId,
      type: 'stock_adjust',
      summary: `تعديل مخزون ${input.productName || input.productId} (${input.quantityOrActual})`,
      localTempRef: tempRef,
      actor,
      payload: {
        productId: input.productId,
        productName: input.productName || '',
        mode: input.mode,
        quantityOrActual: input.quantityOrActual,
        reason: input.reason,
      },
      status: 'pending',
      attempts: 0,
      createdAtIso: new Date().toISOString(),
    });
    return { queued: true };
  };

  if (!navigator.onLine && !input.skipQueue) {
    return enqueueOfflineStock();
  }

  const prodRef = doc(db, 'products', input.productId);
  const opRef = doc(db, 'processed_operations', opId);
  const deviceRef = doc(db, 'devices', actor.deviceId);

  try {
    await runTransaction(db, async (tx) => {
      const opSnap = await tx.get(opRef);
      if (opSnap.exists()) return;

      const [snap, deviceSnap] = await Promise.all([tx.get(prodRef), tx.get(deviceRef)]);
      if (deviceSnap.exists() && deviceSnap.data().status === 'blocked') {
        throw new Error('تم حظر هذا الجهاز من قبل المسؤول ولا يمكن تنفيذ عمليات منه.');
      }
      if (!snap.exists()) throw new Error('الصنف غير موجود.');
      const prod = snap.data() as Omit<Product, 'id'>;

      let newStock = prod.stock;
      let qtyChange = 0;

      if (input.mode === 'in') {
        qtyChange = Math.max(0, input.quantityOrActual);
        newStock = roundMoney(prod.stock + qtyChange);
      } else if (input.mode === 'out') {
        qtyChange = -Math.max(0, input.quantityOrActual);
        newStock = roundMoney(prod.stock + qtyChange);
      } else {
        newStock = Math.max(0, input.quantityOrActual);
        qtyChange = roundMoney(newStock - prod.stock);
      }

      if (newStock < 0) {
        throw new Error('لا يمكن أن تصبح الكمية في المخزون أقل من صفر.');
      }

      tx.update(prodRef, {
        stock: newStock,
        updatedAt: serverTimestamp(),
      });

      tx.set(doc(db, 'stock_movements', generateDocId('mov')), {
        productId: snap.id,
        productCode: prod.code,
        productName: truncateText(prod.name, FIELD_LIMITS.nameMax),
        type: input.mode,
        qtyChange,
        previousStock: prod.stock,
        newStock,
        referenceType: 'inventory',
        referenceId: snap.id,
        referenceNumber: prod.code,
        reason: truncateText(input.reason, FIELD_LIMITS.notesMax),
        employeeId: actor.uid,
        employeeName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
        ...devFields,
        createdAt: serverTimestamp(),
      });

      tx.set(
        doc(db, 'audit_logs', generateDocId('aud')),
        buildAuditEntry(
          actor,
          input.mode === 'stocktake' ? 'جرد مخزون' : 'تعديل مخزون',
          'product',
          snap.id,
          `${prod.name} (${prod.code}): ${prod.stock} -> ${newStock} (${input.reason})`
        )
      );

      tx.set(opRef, {
        operationId: opId,
        operationType: 'stock_adjust',
        referenceId: snap.id,
        referenceNumber: prod.code,
        employeeId: actor.uid,
        ...devFields,
        createdAt: serverTimestamp(),
      });

      if (deviceSnap.exists() && deviceSnap.data().status === 'active') {
        tx.update(deviceRef, {
          userId: actor.uid,
          userName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
          userRole: actor.role,
          deviceName: devFields.deviceName,
          lastOperationSummary: truncateText(`تعديل مخزون ${prod.name}`, 240),
          lastActiveAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
    return { queued: false };
  } catch (err) {
    if (isNetworkOrOfflineError(err) && !input.skipQueue) {
      return enqueueOfflineStock();
    }
    if (
      err instanceof Error &&
      (err.message.includes('أقل من صفر') ||
        err.message.includes('غير موجود') ||
        err.message.includes('محظور'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `products/${input.productId}`);
  }
}

// ---------------- EXPENSES & VOUCHERS ----------------
export async function recordExpense(
  actor: ActorInfo,
  input: {
    title: string;
    category: string;
    amount: number;
    notes?: string;
    operationId?: string;
    skipQueue?: boolean;
  }
): Promise<{ queued: boolean }> {
  const cleanAmount = roundMoney(Math.max(0, input.amount));
  if (cleanAmount <= 0) throw new Error('يجب أن يكون مبلغ المصروف أكبر من صفر.');

  const opId = input.operationId || generateDocId('op');
  const devFields = deviceFieldsFor(actor);

  const enqueueOfflineExpense = () => {
    const tempRef = `OFF-EXP-${opId.slice(-4).toUpperCase()}`;
    enqueuePendingOperation({
      operationId: opId,
      type: 'expense',
      summary: `مصروف: ${input.title} (${cleanAmount})`,
      localTempRef: tempRef,
      actor,
      payload: {
        title: input.title,
        category: input.category,
        amount: cleanAmount,
        notes: input.notes?.trim() || '',
      },
      status: 'pending',
      attempts: 0,
      createdAtIso: new Date().toISOString(),
    });
    return { queued: true };
  };

  if (!navigator.onLine && !input.skipQueue) {
    return enqueueOfflineExpense();
  }

  const expId = generateDocId('exp');
  const countersRef = doc(db, 'counters', 'main');
  const opRef = doc(db, 'processed_operations', opId);
  const deviceRef = doc(db, 'devices', actor.deviceId);

  try {
    await runTransaction(db, async (tx) => {
      const opSnap = await tx.get(opRef);
      if (opSnap.exists()) return;

      const [countersSnap, deviceSnap] = await Promise.all([
        tx.get(countersRef),
        tx.get(deviceRef),
      ]);
      if (deviceSnap.exists() && deviceSnap.data().status === 'blocked') {
        throw new Error('تم حظر هذا الجهاز من قبل المسؤول ولا يمكن تنفيذ عمليات منه.');
      }

      const currentCash = countersSnap.exists() ? Number(countersSnap.data().cashBalance || 0) : 0;
      const newCashBalance = roundMoney(currentCash - cleanAmount);

      if (countersSnap.exists()) {
        tx.update(countersRef, {
          cashBalance: newCashBalance,
          updatedAt: serverTimestamp(),
        });
      }

      const expData: Record<string, unknown> = {
        title: truncateText(input.title, FIELD_LIMITS.partyNameMax),
        category: truncateText(input.category, FIELD_LIMITS.categoryMax),
        amount: cleanAmount,
        employeeId: actor.uid,
        employeeName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
        ...devFields,
        operationId: opId,
        createdAt: serverTimestamp(),
      };
      if (input.notes?.trim()) expData.notes = truncateText(input.notes, FIELD_LIMITS.notesMax);

      tx.set(doc(db, 'expenses', expId), expData);

      tx.set(doc(db, 'cash_transactions', generateDocId('cash')), {
        type: 'out',
        category: 'مصروفات',
        amount: cleanAmount,
        balanceAfter: newCashBalance,
        referenceId: expId,
        description: `مصروف: ${truncateText(input.title, 180)}`,
        employeeId: actor.uid,
        employeeName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
        ...devFields,
        createdAt: serverTimestamp(),
      });

      tx.set(
        doc(db, 'audit_logs', generateDocId('aud')),
        buildAuditEntry(
          actor,
          'تسجيل مصروف',
          'expense',
          expId,
          `صرف ${cleanAmount} - ${input.title} (${input.category})`
        )
      );

      tx.set(opRef, {
        operationId: opId,
        operationType: 'expense',
        referenceId: expId,
        employeeId: actor.uid,
        ...devFields,
        createdAt: serverTimestamp(),
      });

      if (deviceSnap.exists() && deviceSnap.data().status === 'active') {
        tx.update(deviceRef, {
          userId: actor.uid,
          userName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
          userRole: actor.role,
          deviceName: devFields.deviceName,
          lastOperationSummary: truncateText(`مصروف ${input.title} (${cleanAmount})`, 240),
          lastActiveAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
    return { queued: false };
  } catch (err) {
    if (isNetworkOrOfflineError(err) && !input.skipQueue) {
      return enqueueOfflineExpense();
    }
    if (err instanceof Error && err.message.includes('محظور')) throw err;
    handleFirestoreError(err, OperationType.CREATE, 'expenses');
  }
}

export async function recordVoucher(
  actor: ActorInfo,
  input: {
    type: 'receipt' | 'payment';
    partyType: 'customer' | 'supplier';
    partyId: string;
    partyName?: string;
    amount: number;
    notes?: string;
    operationId?: string;
    skipQueue?: boolean;
  }
): Promise<{ voucherNumber: string; queued: boolean }> {
  const cleanAmount = roundMoney(Math.max(0, input.amount));
  if (cleanAmount <= 0) throw new Error('يجب أن يكون مبلغ السند أكبر من صفر.');

  const opId = input.operationId || generateDocId('op');
  const devFields = deviceFieldsFor(actor);

  const enqueueOfflineVoucher = () => {
    const tempRef = `OFF-VCH-${opId.slice(-4).toUpperCase()}`;
    enqueuePendingOperation({
      operationId: opId,
      type: 'voucher',
      summary: `${input.type === 'receipt' ? 'سند قبض' : 'سند صرف'} (${cleanAmount}) ${input.partyName ? `- ${input.partyName}` : ''}`,
      localTempRef: tempRef,
      actor,
      payload: {
        type: input.type,
        partyType: input.partyType,
        partyId: input.partyId,
        partyName: input.partyName || '',
        amount: cleanAmount,
        notes: input.notes?.trim() || '',
      },
      status: 'pending',
      attempts: 0,
      createdAtIso: new Date().toISOString(),
    });
    return { voucherNumber: tempRef, queued: true };
  };

  if (!navigator.onLine && !input.skipQueue) {
    return enqueueOfflineVoucher();
  }

  const voucherId = generateDocId('vch');
  const countersRef = doc(db, 'counters', 'main');
  const partyCol = input.partyType === 'customer' ? 'customers' : 'suppliers';
  const partyRef = doc(db, partyCol, input.partyId);
  const opRef = doc(db, 'processed_operations', opId);
  const deviceRef = doc(db, 'devices', actor.deviceId);
  let voucherNumber = '';

  try {
    await runTransaction(db, async (tx) => {
      const opSnap = await tx.get(opRef);
      if (opSnap.exists()) {
        voucherNumber = String(opSnap.data().referenceNumber || '');
        return;
      }

      const [countersSnap, deviceSnap, partySnap] = await Promise.all([
        tx.get(countersRef),
        tx.get(deviceRef),
        tx.get(partyRef),
      ]);
      if (deviceSnap.exists() && deviceSnap.data().status === 'blocked') {
        throw new Error('تم حظر هذا الجهاز من قبل المسؤول ولا يمكن تنفيذ عمليات منه.');
      }

      const seq = countersSnap.exists() ? Number(countersSnap.data().nextVoucherSeq || 1) : 1;
      const currentCash = countersSnap.exists() ? Number(countersSnap.data().cashBalance || 0) : 0;
      voucherNumber = `${input.type === 'receipt' ? 'RCV' : 'PAY'}-${String(seq).padStart(5, '0')}`;

      if (!partySnap.exists()) throw new Error('العميل أو المورد غير موجود.');
      const pData = partySnap.data() as {
        name: string;
        totalPaid: number;
        balanceDue: number;
      };

      const newCashBalance =
        input.type === 'receipt'
          ? roundMoney(currentCash + cleanAmount)
          : roundMoney(currentCash - cleanAmount);

      if (countersSnap.exists()) {
        tx.update(countersRef, {
          nextVoucherSeq: seq + 1,
          cashBalance: newCashBalance,
          updatedAt: serverTimestamp(),
        });
      }

      tx.update(partyRef, {
        totalPaid: roundMoney(pData.totalPaid + cleanAmount),
        balanceDue: roundMoney(pData.balanceDue - cleanAmount),
        updatedAt: serverTimestamp(),
      });

      const voucherData: Record<string, unknown> = {
        voucherNumber,
        type: input.type,
        partyType: input.partyType,
        partyId: input.partyId,
        partyName: truncateText(pData.name, FIELD_LIMITS.partyNameMax),
        amount: cleanAmount,
        employeeId: actor.uid,
        employeeName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
        ...devFields,
        operationId: opId,
        createdAt: serverTimestamp(),
      };
      if (input.notes?.trim()) {
        voucherData.notes = truncateText(input.notes, FIELD_LIMITS.notesMax);
      }

      tx.set(doc(db, 'vouchers', voucherId), voucherData);

      tx.set(doc(db, 'cash_transactions', generateDocId('cash')), {
        type: input.type === 'receipt' ? 'in' : 'out',
        category: input.type === 'receipt' ? 'سند قبض' : 'سند صرف',
        amount: cleanAmount,
        balanceAfter: newCashBalance,
        referenceId: voucherId,
        referenceNumber: voucherNumber,
        description: `${input.type === 'receipt' ? 'قبض من' : 'صرف إلى'} ${pData.name} (${voucherNumber})`,
        employeeId: actor.uid,
        employeeName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
        ...devFields,
        createdAt: serverTimestamp(),
      });

      tx.set(
        doc(db, 'audit_logs', generateDocId('aud')),
        buildAuditEntry(
          actor,
          input.type === 'receipt' ? 'سند قبض' : 'سند صرف',
          'voucher',
          voucherId,
          `${voucherNumber}: ${input.type === 'receipt' ? 'تحصيل من' : 'دفع إلى'} ${pData.name} بمبلغ ${cleanAmount}`
        )
      );

      tx.set(opRef, {
        operationId: opId,
        operationType: 'voucher',
        referenceId: voucherId,
        referenceNumber: voucherNumber,
        employeeId: actor.uid,
        ...devFields,
        createdAt: serverTimestamp(),
      });

      if (deviceSnap.exists() && deviceSnap.data().status === 'active') {
        tx.update(deviceRef, {
          userId: actor.uid,
          userName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
          userRole: actor.role,
          deviceName: devFields.deviceName,
          lastOperationSummary: truncateText(
            `${input.type === 'receipt' ? 'سند قبض' : 'سند صرف'} ${voucherNumber} (${cleanAmount})`,
            240
          ),
          lastActiveAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
    return { voucherNumber, queued: false };
  } catch (err) {
    if (isNetworkOrOfflineError(err) && !input.skipQueue) {
      return enqueueOfflineVoucher();
    }
    if (err instanceof Error && (err.message.includes('غير موجود') || err.message.includes('محظور'))) {
      throw err;
    }
    handleFirestoreError(err, OperationType.CREATE, 'vouchers');
  }
}

// ---------------- PENDING QUEUE FLUSHER ----------------
export async function flushSinglePendingOperation(op: PendingOperation): Promise<void> {
  const actor: ActorInfo = op.actor;
  const p = op.payload;

  if (op.type === 'sale') {
    await executeSale(actor, {
      customer: (p.customer as Pick<Customer, 'id' | 'customerCode' | 'name'> | null) || null,
      items: (p.items as SaleInputItem[]) || [],
      discount: Number(p.discount || 0),
      paymentMethod: (p.paymentMethod as PaymentMethod) || 'cash',
      paidAmount: Number(p.paidAmount || 0),
      notes: typeof p.notes === 'string' ? p.notes : undefined,
      operationId: op.operationId,
      skipQueue: true,
    });
    return;
  }

  if (op.type === 'purchase') {
    await executePurchase(actor, {
      supplier: p.supplier as Pick<Supplier, 'id' | 'supplierCode' | 'name'>,
      items: (p.items as {
        productId: string;
        qty: number;
        costPrice: number;
        updateProductCost: boolean;
      }[]) || [],
      paymentMethod: (p.paymentMethod as PaymentMethod) || 'cash',
      paidAmount: Number(p.paidAmount || 0),
      notes: typeof p.notes === 'string' ? p.notes : undefined,
      operationId: op.operationId,
      skipQueue: true,
    });
    return;
  }

  if (op.type === 'return') {
    const saleId = String(p.saleId || '');
    const saleSnap = await getDoc(doc(db, 'sales', saleId));
    if (!saleSnap.exists()) {
      throw new Error('الفاتورة الأصلية غير موجودة للمرتجع.');
    }
    const sale = { id: saleSnap.id, ...(saleSnap.data() as Omit<SaleInvoice, 'id'>) };
    const existingRetSnaps = await getDocs(
      query(collection(db, 'returns'), where('saleId', '==', saleId))
    );
    const existingReturns: SalesReturn[] = existingRetSnaps.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<SalesReturn, 'id'>),
    }));

    await executeSalesReturn(actor, {
      sale,
      existingReturns,
      itemsToReturn: (p.itemsToReturn as { productId: string; qty: number }[]) || [],
      restockValid: Boolean(p.restockValid),
      refundCash: Boolean(p.refundCash),
      reason: String(p.reason || ''),
      operationId: op.operationId,
      skipQueue: true,
    });
    return;
  }

  if (op.type === 'stock_adjust') {
    await recordStockAdjustment(actor, {
      productId: String(p.productId || ''),
      productName: typeof p.productName === 'string' ? p.productName : undefined,
      mode: (p.mode as 'in' | 'out' | 'stocktake') || 'in',
      quantityOrActual: Number(p.quantityOrActual || 0),
      reason: String(p.reason || ''),
      operationId: op.operationId,
      skipQueue: true,
    });
    return;
  }

  if (op.type === 'expense') {
    await recordExpense(actor, {
      title: String(p.title || ''),
      category: String(p.category || ''),
      amount: Number(p.amount || 0),
      notes: typeof p.notes === 'string' ? p.notes : undefined,
      operationId: op.operationId,
      skipQueue: true,
    });
    return;
  }

  if (op.type === 'voucher') {
    await recordVoucher(actor, {
      type: (p.type as 'receipt' | 'payment') || 'receipt',
      partyType: (p.partyType as 'customer' | 'supplier') || 'customer',
      partyId: String(p.partyId || ''),
      partyName: typeof p.partyName === 'string' ? p.partyName : undefined,
      amount: Number(p.amount || 0),
      notes: typeof p.notes === 'string' ? p.notes : undefined,
      operationId: op.operationId,
      skipQueue: true,
    });
  }
}

// ---------------- STAFF, INVITES & SETTINGS ----------------
export async function createStaffInvite(
  actor: ActorInfo,
  input: {
    email: string;
    name: string;
    role: 'admin' | 'employee';
    permissions: UserPermissions;
  }
): Promise<void> {
  const inviteId = generateDocId('inv');
  try {
    await runTransaction(db, async (tx) => {
      tx.set(doc(db, 'staff_invites', inviteId), {
        email: truncateText(input.email.trim().toLowerCase(), 200),
        name: truncateText(input.name, FIELD_LIMITS.shortNameMax),
        role: input.role,
        status: 'active',
        permissions: input.role === 'admin' ? ADMIN_PERMISSIONS : input.permissions,
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      tx.set(
        doc(db, 'audit_logs', generateDocId('aud')),
        buildAuditEntry(
          actor,
          'إضافة دعوة موظف',
          'staff_invite',
          inviteId,
          `دعوة ${input.name} (${input.email}) بدور ${input.role === 'admin' ? 'مسؤول' : 'بائع'}`
        )
      );
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'staff_invites');
  }
}

export async function deleteStaffInvite(actor: ActorInfo, inviteId: string, email: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'staff_invites', inviteId));
    await setDoc(
      doc(db, 'audit_logs', generateDocId('aud')),
      buildAuditEntry(actor, 'إلغاء دعوة موظف', 'staff_invite', inviteId, `حذف دعوة ${email}`)
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `staff_invites/${inviteId}`);
  }
}

export async function updateUserAccount(
  actor: ActorInfo,
  targetUser: UserProfile,
  updates: {
    displayName: string;
    role: 'admin' | 'employee';
    status: 'active' | 'suspended';
    permissions: UserPermissions;
  }
): Promise<void> {
  try {
    await runTransaction(db, async (tx) => {
      const userRef = doc(db, 'users', targetUser.uid);
      const adminRef = doc(db, 'admins', targetUser.uid);

      tx.update(userRef, {
        displayName: truncateText(updates.displayName, FIELD_LIMITS.shortNameMax),
        role: updates.role,
        status: updates.status,
        permissions: updates.role === 'admin' ? ADMIN_PERMISSIONS : updates.permissions,
        updatedAt: serverTimestamp(),
      });

      if (updates.role === 'admin' && updates.status === 'active') {
        tx.set(adminRef, {
          uid: targetUser.uid,
          email: targetUser.email,
          createdAt: serverTimestamp(),
        });
      } else if (targetUser.uid !== actor.uid) {
        tx.delete(adminRef);
      }

      tx.set(
        doc(db, 'audit_logs', generateDocId('aud')),
        buildAuditEntry(
          actor,
          'تعديل صلاحيات موظف',
          'user',
          targetUser.uid,
          `تحديث حساب ${updates.displayName} (${targetUser.email}) - الدور: ${updates.role} - الحالة: ${updates.status}`
        )
      );
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${targetUser.uid}`);
  }
}

export async function updateStoreSettings(
  actor: ActorInfo,
  settings: Omit<StoreSettings, 'updatedAt'>
): Promise<void> {
  try {
    await setDoc(doc(db, 'settings', 'store'), {
      storeName: truncateText(settings.storeName, FIELD_LIMITS.shortNameMax),
      phone: truncateText(settings.phone, FIELD_LIMITS.phoneMax),
      address: truncateText(settings.address, FIELD_LIMITS.addressMax),
      currency: truncateText(settings.currency, FIELD_LIMITS.currencyMax),
      receiptFooter: truncateText(settings.receiptFooter, FIELD_LIMITS.notesMax),
      updatedAt: serverTimestamp(),
    });
    await setDoc(
      doc(db, 'audit_logs', generateDocId('aud')),
      buildAuditEntry(actor, 'تحديث إعدادات المحل', 'settings', 'store', `تحديث إعدادات ${settings.storeName}`)
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'settings/store');
  }
}

// ---------------- BACKUP & RESTORE ----------------
export async function exportStoreBackup(): Promise<string> {
  const cols = [
    'settings',
    'counters',
    'products',
    'customers',
    'suppliers',
    'sales',
    'purchases',
    'returns',
    'stock_movements',
    'expenses',
    'vouchers',
    'cash_transactions',
  ];
  const snapshotObj: Record<string, unknown[]> = {};
  for (const colName of cols) {
    const snap = await getDocs(collection(db, colName));
    snapshotObj[colName] = snap.docs.map((d) => ({
      __id: d.id,
      ...d.data(),
    }));
  }
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      store: 'بقالة الحسام',
      version: 1,
      collections: snapshotObj,
    },
    null,
    2
  );
}

export async function restoreStoreBackup(
  actor: ActorInfo,
  jsonText: string
): Promise<number> {
  const parsed = JSON.parse(jsonText) as {
    collections?: Record<string, Array<Record<string, unknown>>>;
  };
  if (!parsed || !parsed.collections) {
    throw new Error('ملف النسخة الاحتياطية غير صالح.');
  }

  let restoredCount = 0;
  const allowedCols = [
    'products',
    'customers',
    'suppliers',
    'settings',
    'counters',
  ];

  const batch = writeBatch(db);
  for (const colName of allowedCols) {
    const docs = parsed.collections[colName];
    if (!Array.isArray(docs)) continue;
    for (const raw of docs) {
      const id = String(raw.__id || '');
      if (!id || !CODE_PATTERN.test(id)) continue;
      const { __id: _ignored, ...rest } = raw;
      const sanitized: Record<string, unknown> = { ...rest };
      if ('createdAt' in sanitized) sanitized.createdAt = serverTimestamp();
      sanitized.updatedAt = serverTimestamp();
      if (colName === 'products' && typeof sanitized.code === 'string') {
        batch.set(doc(db, 'product_codes', makeSafeCodeId(sanitized.code)), {
          code: sanitized.code,
          productId: id,
          createdAt: serverTimestamp(),
        });
      }
      batch.set(doc(db, colName, id), sanitized);
      restoredCount++;
    }
  }
  batch.set(
    doc(db, 'audit_logs', generateDocId('aud')),
    buildAuditEntry(
      actor,
      'استعادة نسخة احتياطية',
      'settings',
      'backup_restore',
      `استعادة ${restoredCount} سجل من نسخة احتياطية`
    )
  );
  await batch.commit();
  return restoredCount;
}

export async function adjustCashBoxManual(
  actor: ActorInfo,
  amount: number,
  type: 'in' | 'out',
  description: string
): Promise<void> {
  const cleanAmount = roundMoney(Math.max(0, amount));
  if (cleanAmount <= 0) throw new Error('يرجى إدخال مبلغ صحيح.');
  const countersRef = doc(db, 'counters', 'main');
  const devFields = deviceFieldsFor(actor);

  try {
    await runTransaction(db, async (tx) => {
      const cSnap = await tx.get(countersRef);
      const currentCash = cSnap.exists() ? Number(cSnap.data().cashBalance || 0) : 0;
      const nextCash =
        type === 'in'
          ? roundMoney(currentCash + cleanAmount)
          : roundMoney(currentCash - cleanAmount);
      if (cSnap.exists()) {
        tx.update(countersRef, {
          cashBalance: nextCash,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(countersRef, {
          nextProductSeq: 1001,
          nextCustomerSeq: 1001,
          nextSupplierSeq: 1001,
          nextInvoiceSeq: 1,
          nextPurchaseSeq: 1,
          nextReturnSeq: 1,
          nextVoucherSeq: 1,
          cashBalance: nextCash,
          updatedAt: serverTimestamp(),
        });
      }
      const txId = generateDocId('cash');
      tx.set(doc(db, 'cash_transactions', txId), {
        type,
        category: type === 'in' ? 'إيداع يدوي' : 'سحب يدوي',
        amount: cleanAmount,
        balanceAfter: nextCash,
        description: truncateText(description, 240),
        employeeId: actor.uid,
        employeeName: truncateText(actor.name, FIELD_LIMITS.shortNameMax),
        ...devFields,
        createdAt: serverTimestamp(),
      });
      tx.set(
        doc(db, 'audit_logs', generateDocId('aud')),
        buildAuditEntry(
          actor,
          type === 'in' ? 'إيداع في الصندوق' : 'سحب من الصندوق',
          'counters',
          'main',
          `${type === 'in' ? 'إيداع' : 'سحب'} ${cleanAmount} - ${description}`
        )
      );
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, 'counters/main');
  }
}
