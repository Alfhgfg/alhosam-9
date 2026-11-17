import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { CheckCircle2, FileSpreadsheet, Printer } from 'lucide-react';
import { useStoreData } from '../contexts/StoreDataContext';
import {
  appendRtlSheet,
  exportToExcel,
  writeWorkbookCrossPlatform,
  type ExcelSheetData,
} from '../utils/exportExcel';
import {
  formatDateOnly,
  formatDateTime,
  formatMoney,
  formatNumber,
  movementTypeLabel,
  paymentMethodLabel,
  saleStatusLabel,
  toDate,
} from '../utils/format';

type ReportType =
  | 'sales'
  | 'pnl'
  | 'finance_ledger'
  | 'purchases'
  | 'customers'
  | 'employees'
  | 'inventory'
  | 'debts'
  | 'item_movements';

export const ReportsView: React.FC = () => {
  const {
    products,
    customers,
    suppliers,
    sales,
    purchases,
    returns,
    expenses,
    vouchers,
    cashTransactions,
    stockMovements,
    counters,
    settings,
  } = useStoreData();

  const [reportType, setReportType] = useState<ReportType>('sales');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [codeFilter, setCodeFilter] = useState('');
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const inRange = (ts: typeof sales[number]['createdAt']) => {
    if (!dateFrom && !dateTo) return true;
    const d = toDate(ts) || new Date();
    if (dateFrom) {
      const from = new Date(`${dateFrom}T00:00:00`);
      if (d < from) return false;
    }
    if (dateTo) {
      const to = new Date(`${dateTo}T23:59:59`);
      if (d > to) return false;
    }
    return true;
  };

  const filteredSales = useMemo(
    () => sales.filter((s) => s.status !== 'cancelled' && inRange(s.createdAt)),
    [sales, dateFrom, dateTo]
  );

  const filteredPurchases = useMemo(
    () => purchases.filter((p) => p.status !== 'cancelled' && inRange(p.createdAt)),
    [purchases, dateFrom, dateTo]
  );

  const filteredReturns = useMemo(
    () => returns.filter((r) => inRange(r.createdAt)),
    [returns, dateFrom, dateTo]
  );

  const filteredExpenses = useMemo(
    () => expenses.filter((e) => inRange(e.createdAt)),
    [expenses, dateFrom, dateTo]
  );

  const filteredVouchers = useMemo(
    () => vouchers.filter((v) => inRange(v.createdAt)),
    [vouchers, dateFrom, dateTo]
  );

  const filteredCashTx = useMemo(
    () => cashTransactions.filter((c) => inRange(c.createdAt)),
    [cashTransactions, dateFrom, dateTo]
  );

  const employeeStats = useMemo(() => {
    const map = new Map<
      string,
      { name: string; count: number; total: number; paid: number; discount: number }
    >();
    for (const s of filteredSales) {
      const cur = map.get(s.employeeId) || {
        name: s.employeeName,
        count: 0,
        total: 0,
        paid: 0,
        discount: 0,
      };
      cur.count += 1;
      cur.total += s.total;
      cur.paid += s.paidAmount;
      cur.discount += s.discount;
      map.set(s.employeeId, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredSales]);

  const filteredMovements = useMemo(() => {
    const q = codeFilter.trim().toLowerCase();
    return stockMovements.filter(
      (m) =>
        inRange(m.createdAt) &&
        (!q ||
          m.productCode.toLowerCase().includes(q) ||
          m.productName.toLowerCase().includes(q))
    );
  }, [stockMovements, codeFilter, dateFrom, dateTo]);

  const salesTotals = useMemo(() => {
    return filteredSales.reduce(
      (acc, s) => {
        acc.total += s.total;
        acc.paid += s.paidAmount;
        acc.remaining += s.remainingAmount;
        acc.profit += s.netProfit;
        acc.discount += s.discount;
        return acc;
      },
      { total: 0, paid: 0, remaining: 0, profit: 0, discount: 0 }
    );
  }, [filteredSales]);

  const purchaseTotals = useMemo(() => {
    return filteredPurchases.reduce(
      (acc, p) => {
        acc.total += p.total;
        acc.paid += p.paidAmount;
        acc.remaining += p.remainingAmount;
        return acc;
      },
      { total: 0, paid: 0, remaining: 0 }
    );
  }, [filteredPurchases]);

  const financeTotals = useMemo(() => {
    const totalExpenses = filteredExpenses.reduce((a, e) => a + e.amount, 0);
    const cashIn = filteredCashTx
      .filter((t) => t.type === 'in')
      .reduce((a, t) => a + t.amount, 0);
    const cashOut = filteredCashTx
      .filter((t) => t.type === 'out')
      .reduce((a, t) => a + t.amount, 0);
    const receiptsTotal = filteredVouchers
      .filter((v) => v.type === 'receipt')
      .reduce((a, v) => a + v.amount, 0);
    const paymentsTotal = filteredVouchers
      .filter((v) => v.type === 'payment')
      .reduce((a, v) => a + v.amount, 0);
    return {
      totalExpenses,
      cashIn,
      cashOut,
      netCashFlow: cashIn - cashOut,
      receiptsTotal,
      paymentsTotal,
    };
  }, [filteredExpenses, filteredCashTx, filteredVouchers]);

  const pnlSummary = useMemo(() => {
    const gross = filteredSales.reduce((a, s) => a + s.subtotal, 0);
    const discounts = filteredSales.reduce((a, s) => a + s.discount, 0);
    const retAmt = filteredReturns.reduce((a, r) => a + r.refundAmount, 0);
    const netRev = gross - discounts - retAmt;
    const cogs =
      filteredSales.reduce((a, s) => a + s.totalCost, 0) -
      filteredReturns.reduce((a, r) => a + r.returnedCost, 0);
    const exp = filteredExpenses.reduce((a, e) => a + e.amount, 0);
    return {
      gross,
      discounts,
      retAmt,
      netRev,
      cogs,
      grossProfit: netRev - cogs,
      exp,
      netProfit: netRev - cogs - exp,
    };
  }, [filteredSales, filteredReturns, filteredExpenses]);

  const inventoryTotals = useMemo(() => {
    return products.reduce(
      (acc, p) => {
        acc.stock += p.stock;
        acc.costValue += p.stock * p.costPrice;
        acc.sellValue += p.stock * p.sellPrice;
        return acc;
      },
      { stock: 0, costValue: 0, sellValue: 0 }
    );
  }, [products]);

  const buildSalesSheets = (): ExcelSheetData[] => {
    const itemRows: (string | number)[][] = [];
    let totalItemQty = 0;
    let totalItemSales = 0;
    let totalItemCost = 0;
    let totalItemProfit = 0;

    for (const s of filteredSales) {
      const dStr = formatDateOnly(s.createdAt);
      for (const item of s.items) {
        const lineCost = item.qty * item.costPrice;
        const lineProfit = item.lineTotal - lineCost;
        totalItemQty += item.qty;
        totalItemSales += item.lineTotal;
        totalItemCost += lineCost;
        totalItemProfit += lineProfit;
        itemRows.push([
          s.invoiceNumber,
          dStr,
          s.employeeName,
          s.deviceName || '—',
          s.customerName,
          item.code,
          item.name,
          item.unit,
          item.qty,
          item.unitPrice,
          item.costPrice,
          item.lineTotal,
          lineProfit,
        ]);
      }
    }

    return [
      {
        sheetName: 'ملخص المبيعات',
        headers: [
          'رقم الفاتورة',
          'التاريخ والوقت',
          'الموظف',
          'الجهاز',
          'العميل',
          'طريقة الدفع',
          'الإجمالي قبل الخصم',
          'الخصم',
          'صافي الفاتورة',
          'المدفوع',
          'المتبقي',
          'تكلفة الأصناف',
          'صافي الربح',
          'الحالة',
        ],
        rows: filteredSales.map((s) => [
          s.invoiceNumber,
          formatDateTime(s.createdAt),
          s.employeeName,
          s.deviceName || '—',
          s.customerName,
          paymentMethodLabel(s.paymentMethod),
          s.subtotal,
          s.discount,
          s.total,
          s.paidAmount,
          s.remainingAmount,
          s.totalCost,
          s.netProfit,
          saleStatusLabel(s.status),
        ]),
        footerRows: [
          [
            'الإجمالي',
            `${filteredSales.length} فاتورة`,
            '',
            '',
            '',
            '',
            filteredSales.reduce((a, s) => a + s.subtotal, 0),
            salesTotals.discount,
            salesTotals.total,
            salesTotals.paid,
            salesTotals.remaining,
            filteredSales.reduce((a, s) => a + s.totalCost, 0),
            salesTotals.profit,
            '',
          ],
        ],
      },
      {
        sheetName: 'تفاصيل أصناف المبيعات',
        headers: [
          'رقم الفاتورة',
          'التاريخ',
          'الموظف',
          'الجهاز',
          'العميل',
          'كود الصنف',
          'اسم الصنف',
          'الوحدة',
          'الكمية',
          'سعر الوحدة',
          'تكلفة الوحدة',
          'إجمالي الصنف',
          'ربح الصنف',
        ],
        rows: itemRows,
        footerRows: [
          [
            'الإجمالي',
            '',
            '',
            '',
            '',
            '',
            `${itemRows.length} سطر`,
            '',
            totalItemQty,
            '',
            '',
            totalItemSales,
            totalItemProfit,
          ],
          ['إجمالي التكلفة', '', '', '', '', '', '', '', '', '', totalItemCost, '', ''],
        ],
      },
    ];
  };

  const buildPnlSheet = (): ExcelSheetData => ({
    sheetName: 'الأرباح والخسائر',
    headers: ['البند المحاسبي', `المبلغ (${settings.currency})`],
    rows: [
      ['إجمالي المبيعات قبل الخصم', pnlSummary.gross],
      ['إجمالي الخصومات الممنوحة', pnlSummary.discounts],
      ['إجمالي المرتجعات', pnlSummary.retAmt],
      ['صافي الإيرادات (المبيعات)', pnlSummary.netRev],
      ['تكلفة البضاعة المباعة', pnlSummary.cogs],
      ['مجمل الربح', pnlSummary.grossProfit],
      ['المصروفات التشغيلية', pnlSummary.exp],
      ['صافي الربح النهائي', pnlSummary.netProfit],
    ],
  });

  const buildFinanceLedgerSheets = (): ExcelSheetData[] => [
    {
      sheetName: 'المصروفات',
      headers: ['التاريخ', 'العنوان', 'التصنيف', 'المبلغ', 'الموظف', 'الجهاز', 'ملاحظات'],
      rows: filteredExpenses.map((e) => [
        formatDateTime(e.createdAt),
        e.title,
        e.category,
        e.amount,
        e.employeeName,
        e.deviceName || '—',
        e.notes || '',
      ]),
      footerRows: [
        ['الإجمالي', `${filteredExpenses.length} بند`, '', financeTotals.totalExpenses, '', '', ''],
      ],
    },
    {
      sheetName: 'حركة الصندوق',
      headers: [
        'التاريخ',
        'النوع',
        'التصنيف',
        'البيان',
        'المرجع',
        'المبلغ',
        'الرصيد بعد الحركة',
        'الموظف',
        'الجهاز',
      ],
      rows: filteredCashTx.map((t) => [
        formatDateTime(t.createdAt),
        t.type === 'in' ? 'وارد' : 'منصرف',
        t.category,
        t.description,
        t.referenceNumber || '',
        t.type === 'in' ? t.amount : -t.amount,
        t.balanceAfter,
        t.employeeName,
        t.deviceName || '—',
      ]),
      footerRows: [
        [
          'ملخص الصندوق',
          `وارد: ${financeTotals.cashIn}`,
          `منصرف: ${financeTotals.cashOut}`,
          'صافي الحركة للفترة',
          '',
          financeTotals.netCashFlow,
          counters.cashBalance,
          'الرصيد الحالي',
          '',
        ],
      ],
    },
    {
      sheetName: 'السندات',
      headers: ['رقم السند', 'التاريخ', 'النوع', 'الطرف', 'الاسم', 'المبلغ', 'الموظف', 'الجهاز', 'ملاحظات'],
      rows: filteredVouchers.map((v) => [
        v.voucherNumber,
        formatDateTime(v.createdAt),
        v.type === 'receipt' ? 'سند قبض' : 'سند صرف',
        v.partyType === 'customer' ? 'عميل' : 'مورد',
        v.partyName,
        v.amount,
        v.employeeName,
        v.deviceName || '—',
        v.notes || '',
      ]),
      footerRows: [
        [
          'الإجمالي',
          '',
          `قبض: ${financeTotals.receiptsTotal}`,
          `صرف: ${financeTotals.paymentsTotal}`,
          '',
          financeTotals.receiptsTotal - financeTotals.paymentsTotal,
          '',
          '',
          '',
        ],
      ],
    },
  ];

  const buildPurchasesSheet = (): ExcelSheetData => ({
    sheetName: 'المشتريات',
    headers: [
      'رقم الفاتورة',
      'التاريخ',
      'المورد',
      'كود المورد',
      'طريقة الدفع',
      'الإجمالي',
      'المدفوع',
      'المتبقي',
      'الموظف',
      'الجهاز',
    ],
    rows: filteredPurchases.map((p) => [
      p.purchaseNumber,
      formatDateTime(p.createdAt),
      p.supplierName,
      p.supplierCode || '',
      paymentMethodLabel(p.paymentMethod),
      p.total,
      p.paidAmount,
      p.remainingAmount,
      p.employeeName,
      p.deviceName || '—',
    ]),
    footerRows: [
      [
        'الإجمالي',
        `${filteredPurchases.length} فاتورة`,
        '',
        '',
        '',
        purchaseTotals.total,
        purchaseTotals.paid,
        purchaseTotals.remaining,
        '',
        '',
      ],
    ],
  });

  const buildInventorySheet = (): ExcelSheetData => ({
    sheetName: 'المخزون',
    headers: [
      'الكود',
      'الباركود',
      'الصنف',
      'التصنيف',
      'الوحدة',
      'الكمية',
      'الحد الأدنى',
      'سعر الشراء',
      'سعر البيع',
      'قيمة المخزون بالتكلفة',
      'قيمة المخزون بسعر البيع',
    ],
    rows: products.map((p) => [
      p.code,
      p.barcode || '',
      p.name,
      p.category,
      p.unit,
      p.stock,
      p.minStock,
      p.costPrice,
      p.sellPrice,
      p.stock * p.costPrice,
      p.stock * p.sellPrice,
    ]),
    footerRows: [
      [
        'الإجمالي',
        '',
        `${products.length} صنف`,
        '',
        '',
        inventoryTotals.stock,
        '',
        '',
        '',
        inventoryTotals.costValue,
        inventoryTotals.sellValue,
      ],
    ],
  });

  const buildDebtsSheets = (): ExcelSheetData[] => {
    const customerDebts = customers.filter((c) => c.balanceDue !== 0);
    const supplierDebts = suppliers.filter((s) => s.balanceDue !== 0);
    return [
      {
        sheetName: 'ديون العملاء',
        headers: ['الكود', 'العميل', 'الهاتف', 'إجمالي المشتريات', 'المدفوع', 'المبلغ المستحق'],
        rows: customerDebts.map((c) => [
          c.customerCode,
          c.name,
          c.phone || '',
          c.totalPurchases,
          c.totalPaid,
          c.balanceDue,
        ]),
        footerRows: [
          [
            'الإجمالي',
            `${customerDebts.length} عميل`,
            '',
            customerDebts.reduce((a, c) => a + c.totalPurchases, 0),
            customerDebts.reduce((a, c) => a + c.totalPaid, 0),
            customerDebts.reduce((a, c) => a + c.balanceDue, 0),
          ],
        ],
      },
      {
        sheetName: 'مستحقات الموردين',
        headers: ['الكود', 'المورد', 'الهاتف', 'إجمالي المشتريات', 'المدفوع', 'المبلغ المستحق'],
        rows: supplierDebts.map((s) => [
          s.supplierCode,
          s.name,
          s.phone || '',
          s.totalPurchases,
          s.totalPaid,
          s.balanceDue,
        ]),
        footerRows: [
          [
            'الإجمالي',
            `${supplierDebts.length} مورد`,
            '',
            supplierDebts.reduce((a, s) => a + s.totalPurchases, 0),
            supplierDebts.reduce((a, s) => a + s.totalPaid, 0),
            supplierDebts.reduce((a, s) => a + s.balanceDue, 0),
          ],
        ],
      },
    ];
  };

  const notifyExport = (fileLabel: string) => {
    setExportNotice(`تم تصدير ملف ${fileLabel} بصيغة Excel بنجاح.`);
    window.setTimeout(() => setExportNotice(null), 5000);
  };

  const handleExportExcel = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (reportType === 'sales') {
      const fileName = `تقرير_المبيعات_${stamp}`;
      exportToExcel(fileName, buildSalesSheets());
      notifyExport(fileName);
    } else if (reportType === 'pnl') {
      const fileName = `تقرير_الأرباح_والخسائر_${stamp}`;
      exportToExcel(fileName, [buildPnlSheet()]);
      notifyExport(fileName);
    } else if (reportType === 'finance_ledger') {
      const fileName = `تقرير_المصروفات_والصندوق_${stamp}`;
      exportToExcel(fileName, buildFinanceLedgerSheets());
      notifyExport(fileName);
    } else if (reportType === 'purchases') {
      const fileName = `تقرير_المشتريات_${stamp}`;
      exportToExcel(fileName, [buildPurchasesSheet()]);
      notifyExport(fileName);
    } else if (reportType === 'customers') {
      const fileName = `تقرير_العملاء_${stamp}`;
      exportToExcel(fileName, [
        {
          sheetName: 'مشتريات العملاء',
          headers: ['الكود', 'الاسم', 'الهاتف', 'إجمالي المشتريات', 'المدفوع', 'الدين المتبقي'],
          rows: customers.map((c) => [
            c.customerCode,
            c.name,
            c.phone || '',
            c.totalPurchases,
            c.totalPaid,
            c.balanceDue,
          ]),
          footerRows: [
            [
              'الإجمالي',
              `${customers.length} عميل`,
              '',
              customers.reduce((a, c) => a + c.totalPurchases, 0),
              customers.reduce((a, c) => a + c.totalPaid, 0),
              customers.reduce((a, c) => a + c.balanceDue, 0),
            ],
          ],
        },
      ]);
      notifyExport(fileName);
    } else if (reportType === 'employees') {
      const fileName = `تقرير_مبيعات_الموظفين_${stamp}`;
      exportToExcel(fileName, [
        {
          sheetName: 'مبيعات الموظفين',
          headers: ['الموظف', 'عدد الفواتير', 'إجمالي المبيعات', 'التحصيل النقدي', 'الخصومات'],
          rows: employeeStats.map((e) => [
            e.name,
            e.count,
            e.total,
            e.paid,
            e.discount,
          ]),
          footerRows: [
            [
              'الإجمالي',
              employeeStats.reduce((a, e) => a + e.count, 0),
              employeeStats.reduce((a, e) => a + e.total, 0),
              employeeStats.reduce((a, e) => a + e.paid, 0),
              employeeStats.reduce((a, e) => a + e.discount, 0),
            ],
          ],
        },
      ]);
      notifyExport(fileName);
    } else if (reportType === 'inventory') {
      const fileName = `تقرير_المخزون_${stamp}`;
      exportToExcel(fileName, [buildInventorySheet()]);
      notifyExport(fileName);
    } else if (reportType === 'debts') {
      const fileName = `تقرير_الديون_والمستحقات_${stamp}`;
      exportToExcel(fileName, buildDebtsSheets());
      notifyExport(fileName);
    } else {
      const fileName = `تقرير_حركة_الأصناف_${stamp}`;
      exportToExcel(fileName, [
        {
          sheetName: 'حركة الأصناف',
          headers: [
            'التاريخ',
            'الكود',
            'الصنف',
            'الحركة',
            'التغير',
            'قبل',
            'بعد',
            'السبب',
            'الموظف',
            'الجهاز',
          ],
          rows: filteredMovements.map((m) => [
            formatDateTime(m.createdAt),
            m.productCode,
            m.productName,
            movementTypeLabel(m.type),
            m.qtyChange,
            m.previousStock,
            m.newStock,
            m.reason,
            m.employeeName,
            m.deviceName || '—',
          ]),
        },
      ]);
      notifyExport(fileName);
    }
  };

  const handleExportFullWorkbook = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const fileName = `الحسابات_المالية_الشاملة_${stamp}`;
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };

    const allSheets: ExcelSheetData[] = [
      buildPnlSheet(),
      ...buildSalesSheets(),
      buildPurchasesSheet(),
      ...buildFinanceLedgerSheets(),
      ...buildDebtsSheets(),
      buildInventorySheet(),
    ];

    for (const sheet of allSheets) {
      appendRtlSheet(wb, sheet);
    }

    writeWorkbookCrossPlatform(wb, `${fileName}.xlsx`);
    notifyExport(fileName);
  };

  const reportTabs: { id: ReportType; label: string }[] = [
    { id: 'sales', label: 'المبيعات اليومية والشهرية' },
    { id: 'pnl', label: 'الأرباح والخسائر' },
    { id: 'finance_ledger', label: 'المصروفات والصندوق' },
    { id: 'purchases', label: 'المشتريات' },
    { id: 'customers', label: 'مشتريات العملاء' },
    { id: 'employees', label: 'مبيعات الموظفين' },
    { id: 'inventory', label: 'المخزون' },
    { id: 'debts', label: 'الديون والمستحقات' },
    { id: 'item_movements', label: 'حركة الصنف بالكود' },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div>
          <h1 className="text-xl font-bold text-slate-900">التقارير والتصدير</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            تقارير تفصيلية وجداول مالية قابلة للتصفية والتصدير إلى Excel و PDF والطباعة المباشرة
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportFullWorkbook}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-semibold rounded-xl cursor-pointer whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>تصدير الكتاب المالي الشامل (Excel)</span>
          </button>
          <button
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl cursor-pointer whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>تصدير التقرير الحالي (Excel)</span>
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl cursor-pointer whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة / PDF</span>
          </button>
        </div>
      </div>

      {exportNotice && (
        <div className="no-print flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-800">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{exportNotice}</span>
        </div>
      )}

      {/* Report Selector & Date Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4 no-print">
        <div className="flex flex-wrap gap-1.5">
          {reportTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setReportType(t.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                reportType === t.id
                  ? 'bg-emerald-700 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 text-xs">
          <div className="flex items-center gap-2">
            <label className="text-slate-600">من تاريخ:</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-200 rounded-lg font-mono-num"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-slate-600">إلى تاريخ:</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-200 rounded-lg font-mono-num"
            />
          </div>
          {reportType === 'item_movements' && (
            <input
              type="text"
              value={codeFilter}
              onChange={(e) => setCodeFilter(e.target.value)}
              placeholder="تصفية بكود الصنف أو اسمه..."
              className="px-3 py-1.5 border border-slate-200 rounded-lg min-w-[220px]"
            />
          )}
          {(dateFrom || dateTo || codeFilter) && (
            <button
              onClick={() => {
                setDateFrom('');
                setDateTo('');
                setCodeFilter('');
              }}
              className="text-red-600 hover:underline cursor-pointer"
            >
              مسح التصفية
            </button>
          )}
        </div>
      </div>

      {/* Printable Report Sheet */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 print-container">
        <div className="border-b border-slate-200 pb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {settings.storeName} ·{' '}
              {reportTabs.find((x) => x.id === reportType)?.label}
            </h2>
            <p className="text-xs text-slate-500">
              تاريخ التقرير: {new Date().toLocaleDateString('ar-EG')}
              {dateFrom || dateTo ? ` · الفترة: ${dateFrom || '...'} إلى ${dateTo || '...'}` : ''}
            </p>
          </div>
        </div>

        {reportType === 'sales' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="text-right py-2.5 px-3">الفاتورة</th>
                  <th className="text-right py-2.5 px-3">التاريخ</th>
                  <th className="text-right py-2.5 px-3">الموظف</th>
                  <th className="text-right py-2.5 px-3">الجهاز</th>
                  <th className="text-right py-2.5 px-3">العميل</th>
                  <th className="text-left py-2.5 px-3">الإجمالي</th>
                  <th className="text-left py-2.5 px-3">المدفوع</th>
                  <th className="text-left py-2.5 px-3">المتبقي</th>
                  <th className="text-left py-2.5 px-3">الربح</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSales.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2 px-3 font-mono-num font-semibold">{s.invoiceNumber}</td>
                    <td className="py-2 px-3">{formatDateTime(s.createdAt)}</td>
                    <td className="py-2 px-3">{s.employeeName}</td>
                    <td className="py-2 px-3 text-slate-500">{s.deviceName || '—'}</td>
                    <td className="py-2 px-3">{s.customerName}</td>
                    <td className="py-2 px-3 text-left font-mono-num font-bold">
                      {formatMoney(s.total, settings.currency)}
                    </td>
                    <td className="py-2 px-3 text-left font-mono-num text-emerald-700">
                      {formatMoney(s.paidAmount, settings.currency)}
                    </td>
                    <td className="py-2 px-3 text-left font-mono-num text-red-700">
                      {formatMoney(s.remainingAmount, settings.currency)}
                    </td>
                    <td className="py-2 px-3 text-left font-mono-num">
                      {formatMoney(s.netProfit, settings.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200 font-bold text-slate-900">
                <tr>
                  <td className="py-2.5 px-3" colSpan={5}>
                    الإجمالي ({filteredSales.length} فاتورة)
                  </td>
                  <td className="py-2.5 px-3 text-left font-mono-num">
                    {formatMoney(salesTotals.total, settings.currency)}
                  </td>
                  <td className="py-2.5 px-3 text-left font-mono-num text-emerald-700">
                    {formatMoney(salesTotals.paid, settings.currency)}
                  </td>
                  <td className="py-2.5 px-3 text-left font-mono-num text-red-700">
                    {formatMoney(salesTotals.remaining, settings.currency)}
                  </td>
                  <td className="py-2.5 px-3 text-left font-mono-num">
                    {formatMoney(salesTotals.profit, settings.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {reportType === 'pnl' && (
          <div className="max-w-lg divide-y divide-slate-100 text-sm">
            <div className="py-2.5 flex justify-between">
              <span>إجمالي المبيعات</span>
              <span className="font-mono-num font-semibold">
                {formatMoney(pnlSummary.gross, settings.currency)}
              </span>
            </div>
            <div className="py-2.5 flex justify-between text-amber-700">
              <span>الخصومات</span>
              <span className="font-mono-num">
                - {formatMoney(pnlSummary.discounts, settings.currency)}
              </span>
            </div>
            <div className="py-2.5 flex justify-between text-red-700">
              <span>المرتجعات</span>
              <span className="font-mono-num">
                - {formatMoney(pnlSummary.retAmt, settings.currency)}
              </span>
            </div>
            <div className="py-2.5 flex justify-between font-bold">
              <span>صافي الإيرادات</span>
              <span className="font-mono-num">
                {formatMoney(pnlSummary.netRev, settings.currency)}
              </span>
            </div>
            <div className="py-2.5 flex justify-between text-slate-600">
              <span>تكلفة البضاعة المباعة</span>
              <span className="font-mono-num">
                - {formatMoney(pnlSummary.cogs, settings.currency)}
              </span>
            </div>
            <div className="py-2.5 flex justify-between text-red-700">
              <span>المصروفات التشغيلية</span>
              <span className="font-mono-num">
                - {formatMoney(pnlSummary.exp, settings.currency)}
              </span>
            </div>
            <div className="py-3 flex justify-between text-base font-bold text-emerald-800 bg-emerald-50 px-3 rounded-lg">
              <span>صافي الربح</span>
              <span className="font-mono-num">
                {formatMoney(pnlSummary.netProfit, settings.currency)}
              </span>
            </div>
          </div>
        )}

        {reportType === 'finance_ledger' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="border border-slate-200 rounded-xl p-3">
                <div className="text-slate-500">رصيد الصندوق الحالي</div>
                <div className="text-base font-bold text-slate-900 font-mono-num mt-1">
                  {formatMoney(counters.cashBalance, settings.currency)}
                </div>
              </div>
              <div className="border border-slate-200 rounded-xl p-3">
                <div className="text-slate-500">وارد الصندوق (الفترة)</div>
                <div className="text-base font-bold text-emerald-700 font-mono-num mt-1">
                  {formatMoney(financeTotals.cashIn, settings.currency)}
                </div>
              </div>
              <div className="border border-slate-200 rounded-xl p-3">
                <div className="text-slate-500">منصرف الصندوق (الفترة)</div>
                <div className="text-base font-bold text-red-700 font-mono-num mt-1">
                  {formatMoney(financeTotals.cashOut, settings.currency)}
                </div>
              </div>
              <div className="border border-slate-200 rounded-xl p-3">
                <div className="text-slate-500">إجمالي المصروفات</div>
                <div className="text-base font-bold text-amber-700 font-mono-num mt-1">
                  {formatMoney(financeTotals.totalExpenses, settings.currency)}
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-2">سجل المصروفات</h3>
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="text-right py-2.5 px-3">التاريخ</th>
                      <th className="text-right py-2.5 px-3">البند</th>
                      <th className="text-right py-2.5 px-3">التصنيف</th>
                      <th className="text-right py-2.5 px-3">الموظف</th>
                      <th className="text-left py-2.5 px-3">المبلغ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredExpenses.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-4 text-center text-slate-400">
                          لا توجد مصروفات ضمن الفترة المحددة
                        </td>
                      </tr>
                    ) : (
                      filteredExpenses.map((e) => (
                        <tr key={e.id}>
                          <td className="py-2 px-3">{formatDateTime(e.createdAt)}</td>
                          <td className="py-2 px-3 font-semibold">{e.title}</td>
                          <td className="py-2 px-3">{e.category}</td>
                          <td className="py-2 px-3">{e.employeeName}</td>
                          <td className="py-2 px-3 text-left font-mono-num font-bold text-red-700">
                            {formatMoney(e.amount, settings.currency)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-2">حركة الصندوق النقدي</h3>
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="text-right py-2.5 px-3">التاريخ</th>
                      <th className="text-right py-2.5 px-3">البيان</th>
                      <th className="text-right py-2.5 px-3">النوع</th>
                      <th className="text-left py-2.5 px-3">المبلغ</th>
                      <th className="text-left py-2.5 px-3">الرصيد بعد الحركة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredCashTx.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-4 text-center text-slate-400">
                          لا توجد حركات صندوق ضمن الفترة المحددة
                        </td>
                      </tr>
                    ) : (
                      filteredCashTx.map((t) => (
                        <tr key={t.id}>
                          <td className="py-2 px-3">{formatDateTime(t.createdAt)}</td>
                          <td className="py-2 px-3">{t.description}</td>
                          <td className="py-2 px-3 font-semibold">
                            {t.type === 'in' ? 'وارد' : 'منصرف'}
                          </td>
                          <td
                            className={`py-2 px-3 text-left font-mono-num font-bold ${
                              t.type === 'in' ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {t.type === 'in' ? '+' : '-'}
                            {formatMoney(t.amount, settings.currency)}
                          </td>
                          <td className="py-2 px-3 text-left font-mono-num">
                            {formatMoney(t.balanceAfter, settings.currency)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {reportType === 'purchases' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="text-right py-2.5 px-3">رقم الفاتورة</th>
                  <th className="text-right py-2.5 px-3">التاريخ</th>
                  <th className="text-right py-2.5 px-3">المورد</th>
                  <th className="text-right py-2.5 px-3">الجهاز</th>
                  <th className="text-right py-2.5 px-3">الدفع</th>
                  <th className="text-left py-2.5 px-3">الإجمالي</th>
                  <th className="text-left py-2.5 px-3">المدفوع</th>
                  <th className="text-left py-2.5 px-3">المتبقي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPurchases.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 px-3 font-mono-num font-semibold">{p.purchaseNumber}</td>
                    <td className="py-2 px-3">{formatDateTime(p.createdAt)}</td>
                    <td className="py-2 px-3 font-semibold">{p.supplierName}</td>
                    <td className="py-2 px-3 text-slate-500">{p.deviceName || '—'}</td>
                    <td className="py-2 px-3">{paymentMethodLabel(p.paymentMethod)}</td>
                    <td className="py-2 px-3 text-left font-mono-num font-bold">
                      {formatMoney(p.total, settings.currency)}
                    </td>
                    <td className="py-2 px-3 text-left font-mono-num text-emerald-700">
                      {formatMoney(p.paidAmount, settings.currency)}
                    </td>
                    <td className="py-2 px-3 text-left font-mono-num text-amber-700">
                      {formatMoney(p.remainingAmount, settings.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200 font-bold text-slate-900">
                <tr>
                  <td className="py-2.5 px-3" colSpan={5}>
                    الإجمالي ({filteredPurchases.length} فاتورة)
                  </td>
                  <td className="py-2.5 px-3 text-left font-mono-num">
                    {formatMoney(purchaseTotals.total, settings.currency)}
                  </td>
                  <td className="py-2.5 px-3 text-left font-mono-num text-emerald-700">
                    {formatMoney(purchaseTotals.paid, settings.currency)}
                  </td>
                  <td className="py-2.5 px-3 text-left font-mono-num text-amber-700">
                    {formatMoney(purchaseTotals.remaining, settings.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {reportType === 'customers' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="text-right py-2.5 px-3">الكود</th>
                  <th className="text-right py-2.5 px-3">العميل</th>
                  <th className="text-right py-2.5 px-3">الهاتف</th>
                  <th className="text-left py-2.5 px-3">المشتريات</th>
                  <th className="text-left py-2.5 px-3">المدفوع</th>
                  <th className="text-left py-2.5 px-3">المتبقي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 px-3 font-mono-num">{c.customerCode}</td>
                    <td className="py-2 px-3 font-semibold">{c.name}</td>
                    <td className="py-2 px-3 font-mono-num">{c.phone || '—'}</td>
                    <td className="py-2 px-3 text-left font-mono-num">
                      {formatMoney(c.totalPurchases, settings.currency)}
                    </td>
                    <td className="py-2 px-3 text-left font-mono-num text-emerald-700">
                      {formatMoney(c.totalPaid, settings.currency)}
                    </td>
                    <td className="py-2 px-3 text-left font-mono-num text-red-700 font-bold">
                      {formatMoney(c.balanceDue, settings.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {reportType === 'employees' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="text-right py-2.5 px-3">الموظف</th>
                  <th className="text-center py-2.5 px-3">عدد الفواتير</th>
                  <th className="text-left py-2.5 px-3">إجمالي المبيعات</th>
                  <th className="text-left py-2.5 px-3">المبالغ المحصلة</th>
                  <th className="text-left py-2.5 px-3">إجمالي الخصومات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employeeStats.map((e) => (
                  <tr key={e.name}>
                    <td className="py-2.5 px-3 font-semibold">{e.name}</td>
                    <td className="py-2.5 px-3 text-center font-mono-num">{e.count}</td>
                    <td className="py-2.5 px-3 text-left font-mono-num font-bold text-emerald-700">
                      {formatMoney(e.total, settings.currency)}
                    </td>
                    <td className="py-2.5 px-3 text-left font-mono-num">
                      {formatMoney(e.paid, settings.currency)}
                    </td>
                    <td className="py-2.5 px-3 text-left font-mono-num text-amber-700">
                      {formatMoney(e.discount, settings.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {reportType === 'inventory' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="text-right py-2.5 px-3">الكود</th>
                  <th className="text-right py-2.5 px-3">الصنف</th>
                  <th className="text-center py-2.5 px-3">الكمية</th>
                  <th className="text-center py-2.5 px-3">الحد الأدنى</th>
                  <th className="text-left py-2.5 px-3">التكلفة</th>
                  <th className="text-left py-2.5 px-3">البيع</th>
                  <th className="text-left py-2.5 px-3">قيمة المخزون</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 px-3 font-mono-num">{p.code}</td>
                    <td className="py-2 px-3 font-semibold">{p.name}</td>
                    <td className="py-2 px-3 text-center font-mono-num font-bold">
                      {formatNumber(p.stock)}
                    </td>
                    <td className="py-2 px-3 text-center font-mono-num">{p.minStock}</td>
                    <td className="py-2 px-3 text-left font-mono-num">
                      {formatMoney(p.costPrice, settings.currency)}
                    </td>
                    <td className="py-2 px-3 text-left font-mono-num">
                      {formatMoney(p.sellPrice, settings.currency)}
                    </td>
                    <td className="py-2 px-3 text-left font-mono-num font-semibold">
                      {formatMoney(p.stock * p.costPrice, settings.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200 font-bold text-slate-900">
                <tr>
                  <td className="py-2.5 px-3" colSpan={2}>
                    الإجمالي ({products.length} صنف)
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono-num">
                    {formatNumber(inventoryTotals.stock)}
                  </td>
                  <td colSpan={3} />
                  <td className="py-2.5 px-3 text-left font-mono-num">
                    {formatMoney(inventoryTotals.costValue, settings.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {reportType === 'debts' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-2">
                ديون العملاء المستحقة للمحل
              </h3>
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs">
                {customers
                  .filter((c) => c.balanceDue > 0)
                  .map((c) => (
                    <div key={c.id} className="p-3 flex justify-between">
                      <span>
                        {c.name} ({c.customerCode})
                      </span>
                      <span className="font-mono-num font-bold text-red-700">
                        {formatMoney(c.balanceDue, settings.currency)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-2">
                مستحقات الموردين على المحل
              </h3>
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs">
                {suppliers
                  .filter((s) => s.balanceDue > 0)
                  .map((s) => (
                    <div key={s.id} className="p-3 flex justify-between">
                      <span>
                        {s.name} ({s.supplierCode})
                      </span>
                      <span className="font-mono-num font-bold text-amber-700">
                        {formatMoney(s.balanceDue, settings.currency)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {reportType === 'item_movements' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="text-right py-2.5 px-3">التاريخ</th>
                  <th className="text-right py-2.5 px-3">الكود / الصنف</th>
                  <th className="text-right py-2.5 px-3">الحركة</th>
                  <th className="text-center py-2.5 px-3">التغير</th>
                  <th className="text-center py-2.5 px-3">الرصيد بعد</th>
                  <th className="text-right py-2.5 px-3">السبب</th>
                  <th className="text-right py-2.5 px-3">الموظف</th>
                  <th className="text-right py-2.5 px-3">الجهاز</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMovements.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2 px-3">{formatDateTime(m.createdAt)}</td>
                    <td className="py-2 px-3">
                      <span className="font-mono-num">{m.productCode}</span> · {m.productName}
                    </td>
                    <td className="py-2 px-3">{movementTypeLabel(m.type)}</td>
                    <td className="py-2 px-3 text-center font-mono-num font-bold">
                      {m.qtyChange > 0 ? `+${m.qtyChange}` : m.qtyChange}
                    </td>
                    <td className="py-2 px-3 text-center font-mono-num">{m.newStock}</td>
                    <td className="py-2 px-3">{m.reason}</td>
                    <td className="py-2 px-3">{m.employeeName}</td>
                    <td className="py-2 px-3 text-slate-500">{m.deviceName || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
