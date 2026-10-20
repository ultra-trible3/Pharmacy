import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { ProductSearch, type ProductSearchHandle } from '../components/pos/ProductSearch';
import { ProductCategories } from '../components/pos/ProductCategories';
import { QuickProducts } from '../components/pos/QuickProducts';
import { BestSellers } from '../components/pos/BestSellers';
import { RecentlySold } from '../components/pos/RecentlySold';
import { ShoppingCart } from '../components/pos/ShoppingCart';
import { InventoryPanel } from '../components/pos/InventoryPanel';
import { InvoiceTotals } from '../components/pos/InvoiceTotals';
import { CheckoutActions } from '../components/pos/CheckoutActions';
import { PaymentModal } from '../components/pos/PaymentModal';
import { ReceiptPreview } from '../components/pos/ReceiptPreview';
import { KeyboardShortcuts, useKeyboardShortcuts, DEFAULT_SHORTCUTS } from '../components/pos/KeyboardShortcuts';
import { useI18n } from '../i18n/useI18n';
import { api, ApiError, type SaleCreateBody, type SaleDto } from '../lib/api';
import { toast } from '../components/ui/toast';
import { useAuthStore } from '../store/auth';
import { sumCurrency, roundCurrency, multiplyCurrency } from '@pharmacy/shared';
import type { InventoryBatchRow } from '@pharmacy/shared';
import type { TranslationKey } from '../i18n/dictionaries';
import '../components/pos/pos.css';

interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  nameAr: string;
  nameEn: string | null;
  brand: string | null;
  manufacturer: string | null;
  categoryId: string | null;
  categoryNameAr: string | null;
  dosageForm: string;
  strength: string | null;
  packSize: string | null;
  unit: string | null;
  salePrice: string;
  costPrice: string;
  taxRate: string;
  minStock: number;
  prescriptionClass: string;
  totalStock: number;
  nearestExpiry: string | null;
  hasImage: boolean;
  isActive: boolean;
  isFavorite?: boolean;
  /** Populated by detail lookups; the list/search endpoints omit it. */
  batches?: Batch[];
}

interface Batch {
  id: string;
  lotNumber: string;
  expiryDate: string;
  quantity: number;
  costPrice: string;
  salePrice: string | null;
  warehouseId: string;
  warehouseNameAr: string;
  manufactureDate: string | null;
  daysToExpiry: number;
  isExpired: boolean;
  isNearExpiry: boolean;
  stockValue: string;
}

interface CartItem {
  id: string;
  product: Product;
  batch: Batch;
  quantity: number;
  unitPrice: string;
  discount: string;
  lineTotal: string;
  addedAt: string;
}

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  creditLimit: string;
  currentBalance: string;
  loyaltyPoints: number;
}

interface SuspendedInvoice {
  id: string;
  invoiceNumber: string;
  items: CartItem[];
  customer?: Customer;
  subtotal: string;
  itemDiscount: string;
  invoiceDiscount: string;
  taxAmount: string;
  total: string;
  status: 'suspended';
  note?: string;
  createdAt: string;
  cashierId: string;
  warehouseId: string;
}

interface PaymentAllocation {
  method: string;
  amount: string;
  reference?: string;
}

/** Adapts an inventory batch row (`batchId`) to the cart batch shape (`id`). */
function toCartBatch(row: InventoryBatchRow): Batch {
  return {
    id: row.batchId,
    lotNumber: row.lotNumber,
    expiryDate: row.expiryDate,
    quantity: row.quantity,
    costPrice: row.costPrice,
    salePrice: row.salePrice,
    warehouseId: row.warehouseId,
    warehouseNameAr: row.warehouseNameAr,
    manufactureDate: row.manufactureDate,
    daysToExpiry: row.daysToExpiry,
    isExpired: row.isExpired,
    isNearExpiry: row.isNearExpiry,
    stockValue: row.stockValue,
  };
}

/** Maps a server suspended sale back into the cart model the POS renders. */
function saleToSuspended(sale: SaleDto): SuspendedInvoice {
  const items: CartItem[] = [];
  for (const item of sale.items) {
    if (!item.product || !item.batch) {
      console.warn('Suspended sale line without product/batch, skipping:', item.id);
      continue;
    }
    items.push({
      id: item.id,
      product: { ...item.product, isFavorite: false },
      batch: item.batch,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      lineTotal: item.lineTotal,
      addedAt: sale.createdAt,
    });
  }
  return {
    id: sale.id,
    invoiceNumber: sale.invoiceNumber,
    items,
    customer: sale.customer ?? undefined,
    subtotal: sale.subtotal,
    itemDiscount: sale.itemDiscount,
    invoiceDiscount: sale.invoiceDiscount,
    taxAmount: sale.taxAmount,
    total: sale.total,
    status: 'suspended',
    note: sale.note ?? undefined,
    createdAt: sale.createdAt,
    cashierId: sale.userId,
    warehouseId: sale.warehouseId,
  };
}

export function POSPage(): React.ReactElement {
  const { t, locale } = useI18n();
  const isRTL = locale === 'ar';
  const { user } = useAuthStore();
  const cashierName = user?.fullName || user?.username || '';

  const searchInputRef = useRef<ProductSearchHandle>(null);

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [categories, setCategories] = useState<{ id: string; code: string; nameAr: string; nameEn: string | null; productCount: number; isActive: boolean }[]>([]);
  const [quickProducts, setQuickProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCartItemId, setSelectedCartItemId] = useState<string | null>(null);
  const [selectedProductForInventory, setSelectedProductForInventory] = useState<Product | null>(null);
  const [productBatches, setProductBatches] = useState<Batch[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [invoiceDiscount, setInvoiceDiscount] = useState('0.00');
  const [paymentMethods, setPaymentMethods] = useState<string[]>(['cash']);
  const [paymentAllocations, setPaymentAllocations] = useState<PaymentAllocation[]>([{ method: 'cash', amount: '0.00' }]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [lastInvoice, setLastInvoice] = useState<{
    id: string;
    invoiceNumber: string;
    items: CartItem[];
    customer?: Customer;
    subtotal: string;
    itemDiscount: string;
    invoiceDiscount: string;
    taxAmount: string;
    total: string;
    pointsUsed: number;
    paymentMethods: string[];
    payments?: PaymentAllocation[];
    status: 'completed' | 'suspended' | 'voided';
    createdAt: string;
    cashierId: string;
    cashierName?: string;
    warehouseId: string;
    warehouseNameAr?: string;
    note?: string;
  } | null>(null);
  const [suspendedInvoices, setSuspendedInvoices] = useState<SuspendedInvoice[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [barcodeBuffer, setBarcodeBuffer] = useState('');
  const [barcodeTimer, setBarcodeTimer] = useState<NodeJS.Timeout | null>(null);
  const [warehouse, setWarehouse] = useState<{ id: string; nameAr: string } | null>(null);

  // Computed values
  const subtotal = useMemo(() =>
    cart.reduce((sum, item) => sumCurrency([sum, multiplyCurrency(item.unitPrice, item.quantity)]), '0.00'),
    [cart]
  );

  const itemDiscountTotal = useMemo(() =>
    cart.reduce((sum, item) => sumCurrency([sum, item.discount]), '0.00'),
    [cart]
  );

  const taxableAmount = useMemo(() =>
    roundCurrency(Number(subtotal) - Number(itemDiscountTotal) - Number(invoiceDiscount)),
    [subtotal, itemDiscountTotal, invoiceDiscount]
  );

  const taxAmount = useMemo(() =>
    roundCurrency(Number(taxableAmount) * 0.15),
    [taxableAmount]
  );

  const total = useMemo(() =>
    roundCurrency(Number(taxableAmount) + Number(taxAmount)),
    [taxableAmount, taxAmount]
  );

  const paidTotal = useMemo(() =>
    paymentAllocations.reduce((sum, p) => sumCurrency([sum, p.amount]), '0.00'),
    [paymentAllocations]
  );

  const remaining = useMemo(() =>
    roundCurrency(Number(total) - Number(paidTotal)),
    [total, paidTotal]
  );

  // const changeDue = useMemo(() => {
  //   const cashAlloc = paymentAllocations.find(p => p.method === 'cash');
  //   if (!cashAlloc) return '0.00';
  //   return roundCurrency(Number(cashAlloc.amount) - Number(total));
  // }, [paymentAllocations, total]);

  // const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  // const totalUnits = cart.length;

  // Load initial data
  useEffect(() => {
    loadCategories();
    loadQuickProducts();
    loadSuspendedInvoices();
    loadWarehouse();
  }, []);

  const loadWarehouse = async () => {
    try {
      const list = await api.warehouses.list();
      const active = (list ?? []).filter((w) => w.isActive);
      const selected = active.find((w) => w.isDefault) ?? active[0];
      if (selected) setWarehouse({ id: selected.id, nameAr: selected.nameAr });
    } catch (e) {
      console.error('Failed to load warehouses:', e);
    }
  };

  const loadCategories = async () => {
    try {
      const result = await api.categories.list({ pageSize: 50 });
      setCategories(result.items ?? []);
    } catch (e) {
      console.error('Failed to load categories:', e);
    }
  };

  const loadQuickProducts = async () => {
    try {
      const result = await api.products.list({ q: '', pageSize: 20, sortBy: 'nameAr', sortOrder: 'asc' });
      const productsWithFavorites = (result.items ?? []).map((p, i) => ({
        ...p,
        isFavorite: i < 8, // First 8 as favorites for demo
      }));
      setQuickProducts(productsWithFavorites);
    } catch (e) {
      console.error('Failed to load quick products:', e);
    }
  };

  const loadSuspendedInvoices = async () => {
    try {
      const sales = await api.sales.listSuspended();
      const list = Array.isArray(sales) ? sales : ((sales as { items?: SaleDto[] } | null)?.items ?? []);
      setSuspendedInvoices(list.map(saleToSuspended));
    } catch (e) {
      console.error('Failed to load suspended invoices:', e);
    }
  };

  // Search handler
  const runSearch = useCallback(async (query: string, categoryId: string | null) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const result = await api.products.search({
        q: query,
        pageSize: 20,
        sortBy: 'nameAr',
        sortOrder: 'asc',
        ...(categoryId ? { categoryId } : {}),
      });
      setSearchResults((result.items ?? []) as Product[]);
    } catch (e) {
      console.error('Product search failed:', e);
      setSearchResults([]);
    }
  }, []);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    void runSearch(query, selectedCategoryId);
  }, [runSearch, selectedCategoryId]);

  /** Category dropdown handler: applies the filter and refreshes an active search. */
  const handleCategoryChange = useCallback((categoryId: string | null) => {
    setSelectedCategoryId(categoryId);
    if (searchQuery.trim()) void runSearch(searchQuery, categoryId);
  }, [runSearch, searchQuery]);

  /**
   * Resolves the batch a line is served from. Product payloads from
   * list/search endpoints carry no batches, so the inventory endpoint is the
   * source of truth (FEFO: earliest non-expiring batch with stock).
   */
  const resolveBatch = useCallback(
    async (product: Product, explicit?: Batch): Promise<Batch | null> => {
      if (explicit) return explicit;

      const embedded = product.batches ?? [];
      if (embedded.length > 0) {
        return embedded.find((b) => b.quantity > 0 && new Date(b.expiryDate) > new Date()) ?? null;
      }

      const rows = await api.inventory.batches({
        productId: product.id,
        inStockOnly: 'true',
        includeExpired: 'false',
        pageSize: 50,
        sortBy: 'expiryDate',
        sortOrder: 'asc',
      });
      const batches = (rows.items ?? []).map(toCartBatch);
      return batches.find((b) => b.quantity > 0 && new Date(b.expiryDate) > new Date()) ?? null;
    },
    [],
  );

  // Add product to cart
  const addToCart = useCallback(async (product: Product, batch?: Batch, qty = 1) => {
    let targetBatch: Batch | null = null;
    try {
      targetBatch = await resolveBatch(product, batch);
    } catch (e) {
      console.error('Batch lookup failed:', e);
      targetBatch = null;
    }
    if (!targetBatch || targetBatch.quantity <= 0) {
      toast.error(t('pos.errors.outOfStock'));
      return;
    }
    if (new Date(targetBatch.expiryDate) <= new Date()) {
      toast.error(t('pos.errors.expiredBatch'));
      return;
    }

    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id && item.batch.id === targetBatch.id);
      if (existing) {
        if (existing.quantity + qty > targetBatch.quantity) {
          toast.error(t('pos.errors.insufficientStock'));
          return prev;
        }
        return prev.map(item =>
          item.product.id === product.id && item.batch.id === targetBatch.id
            ? { ...item, quantity: item.quantity + qty, lineTotal: multiplyCurrency(item.unitPrice, item.quantity + qty) }
            : item
        );
      }
      return [...prev, {
        id: `cart-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        product,
        batch: targetBatch,
        quantity: qty,
        unitPrice: product.salePrice,
        discount: '0.00',
        lineTotal: multiplyCurrency(product.salePrice, qty),
        addedAt: new Date().toISOString(),
      }];
    });
    setSelectedProductForInventory(null);
    toast.success(t('pos.success.addedToCart', { name: product.nameAr }));
  }, [resolveBatch, t]);

  // Barcode scanning
  const handleBarcodeScan = useCallback(async (barcode: string) => {
    try {
      const product = (await api.products.lookup(barcode)) as Product | null;
      if (!product) {
        toast.error(t('pos.errors.productNotFound', { barcode }));
        return;
      }
      const rows = await api.inventory.batches({
        productId: product.id,
        inStockOnly: 'true',
        pageSize: 50,
        sortBy: 'expiryDate',
        sortOrder: 'asc',
      });
      const batches = (rows.items ?? []).map(toCartBatch);
      if (batches.length > 1) {
        // Several live batches: let the cashier pick one in the inventory panel.
        setSelectedProductForInventory(product);
        setProductBatches(batches);
      } else {
        await addToCart(product, batches[0]);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        toast.error(t('pos.errors.productNotFound', { barcode }));
      } else {
        console.error('Barcode scan failed:', e);
        toast.error(t('pos.errors.barcodeScanFailed'));
      }
    }
  }, [addToCart, t]);

  // Handle keyboard input for barcode scanning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key.length === 1 && /[\d]/.test(e.key)) {
        setBarcodeBuffer(prev => prev + e.key);
        if (barcodeTimer) clearTimeout(barcodeTimer);
        const timer = setTimeout(() => {
          const code = barcodeBuffer + e.key;
          if (code.length >= 8) {
            handleBarcodeScan(code);
            setBarcodeBuffer('');
          }
        }, 50);
        setBarcodeTimer(timer);
      } else if (e.key === 'Enter' && barcodeBuffer.length >= 8) {
        e.preventDefault();
        handleBarcodeScan(barcodeBuffer);
        setBarcodeBuffer('');
        if (barcodeTimer) clearTimeout(barcodeTimer);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [barcodeBuffer, barcodeTimer, handleBarcodeScan]);

  // Update cart item quantity
  const updateQuantity = useCallback((itemId: string, newQty: number) => {
    const item = cart.find(i => i.id === itemId);
    if (!item) return;
    if (newQty <= 0) {
      removeFromCart(itemId);
      return;
    }
    if (newQty > item.batch.quantity) {
      toast.error(t('pos.errors.insufficientStock'));
      return;
    }
    setCart(prev => prev.map(item =>
      item.id === itemId ? { ...item, quantity: newQty, lineTotal: multiplyCurrency(item.unitPrice, newQty) } : item
    ));
  }, [cart]);

  // Update cart item discount
  const updateDiscount = useCallback((itemId: string, discount: string) => {
    const item = cart.find(i => i.id === itemId);
    if (!item) return;
    const maxDiscount = multiplyCurrency(item.unitPrice, item.quantity);
    if (Number(discount) > Number(maxDiscount)) {
      toast.error(t('pos.errors.discountExceedsTotal'));
      return;
    }
    setCart(prev => prev.map(item =>
      item.id === itemId ? { ...item, discount, lineTotal: roundCurrency(Number(multiplyCurrency(item.unitPrice, item.quantity)) - Number(discount)) } : item
    ));
  }, [cart]);

  const removeFromCart = useCallback((itemId: string) => {
    setCart(prev => prev.filter(item => item.id !== itemId));
  }, []);

  /** Empties the sale-in-progress: cart, customer, discount and payments. */
  const resetSaleState = useCallback(() => {
    setCart([]);
    setCustomer(null);
    setInvoiceDiscount('0.00');
    setPaymentMethods(['cash']);
    // Reset to zero, not to the previous total: keeping the old total here
    // made the empty cart show phantom paid/change amounts afterwards.
    setPaymentAllocations([{ method: 'cash', amount: '0.00' }]);
  }, []);

  const suspendInvoice = useCallback(async (note?: string) => {
    if (cart.length === 0) return;

    const payload: SaleCreateBody = {
      customerId: customer?.id ?? null,
      ...(warehouse ? { warehouseId: warehouse.id } : {}),
      subtotal,
      itemDiscount: itemDiscountTotal,
      invoiceDiscount,
      taxAmount,
      total,
      note,
      items: cart.map(item => ({
        productId: item.product.id,
        batchId: item.batch.id,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        lineTotal: item.lineTotal,
      })),
      payments: [],
    };

    let invoice: SuspendedInvoice;
    try {
      const created = await api.sales.suspend(payload);
      invoice = saleToSuspended(created);
    } catch (e) {
      // Offline-first: keep the hold locally so the shift is never lost.
      console.error('Suspending on the server failed, keeping a local copy:', e);
      invoice = {
        id: `susp-${Date.now()}`,
        invoiceNumber: `SUSP-${Date.now()}`,
        items: [...cart],
        customer: customer ?? undefined,
        subtotal,
        itemDiscount: itemDiscountTotal,
        invoiceDiscount,
        taxAmount,
        total,
        status: 'suspended',
        note,
        createdAt: new Date().toISOString(),
        cashierId: user?.id ?? 'current-user',
        warehouseId: warehouse?.id ?? 'main',
      };
    }

    setSuspendedInvoices(prev => [invoice, ...prev.filter(i => i.id !== invoice.id)]);
    resetSaleState();
    toast.success(t('pos.success.invoiceSuspended'));
  }, [cart, customer, subtotal, itemDiscountTotal, invoiceDiscount, taxAmount, total, warehouse, user, resetSaleState, t]);

  const resumeInvoice = useCallback((invoice: SuspendedInvoice) => {
    setCart(invoice.items);
    setCustomer(invoice.customer ?? null);
    setInvoiceDiscount(invoice.invoiceDiscount);
    setSuspendedInvoices(prev => prev.filter(i => i.id !== invoice.id));
    toast.success(t('pos.success.invoiceResumed'));
  }, []);

  const handleBatchSelect = useCallback((itemId: string, batch: Batch) => {
    setCart(prev => prev.map(item =>
      item.id === itemId ? { ...item, batch, lineTotal: multiplyCurrency(item.unitPrice, item.quantity) } : item
    ));
    toast.success(t('pos.success.batchSelected', { batch: batch.lotNumber }));
  }, []);

  const handlePaymentComplete = useCallback(async (allocations: PaymentAllocation[], pointsUsedParam?: number) => {
    setIsProcessing(true);
    const pointsUsedValue = Number(pointsUsedParam ?? 0);
    try {
      if (cart.length === 0) return;

      // Align the allocations with the invoice total: each method pays what it
      // was given, cash covers any remainder, and an empty allocation list
      // defaults to a full cash payment. Points discount reduces the amount
      // that needs to be paid in cash/card/credit.
      const pointsDiscount = roundCurrency(Number(pointsUsedValue) / 100);
      const payableTotal = roundCurrency(Number(total) - Number(pointsDiscount));
      const payments: SaleCreateBody['payments'] = (() => {
        let remaining = Number(payableTotal);
        const out: SaleCreateBody['payments'] = [];
        for (const allocation of allocations) {
          if (remaining <= 0.01) break;
          const raw = Number(allocation.amount);
          const applied = Math.min(raw > 0 ? raw : remaining, remaining);
          out.push({
            method: allocation.method as SaleCreateBody['payments'][number]['method'],
            amount: roundCurrency(applied),
            reference: allocation.reference,
          });
          remaining = Number(roundCurrency(remaining - applied));
        }
        if (remaining > 0.01) {
          out.push({ method: 'cash', amount: roundCurrency(remaining) });
        }
        if (out.length === 0) out.push({ method: 'cash', amount: payableTotal });
        return out;
      })();

      const created = await api.sales.create({
        customerId: customer?.id ?? null,
        ...(warehouse ? { warehouseId: warehouse.id } : {}),
        subtotal,
        itemDiscount: itemDiscountTotal,
        invoiceDiscount,
        taxAmount,
        total: payableTotal,
        pointsUsed: pointsUsedValue,
        items: cart.map(item => ({
          productId: item.product.id,
          batchId: item.batch.id,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          lineTotal: item.lineTotal,
        })),
        payments,
      });

      // Deduct redeemed points from the customer balance.
      if (customer?.id && pointsUsedValue > 0) {
        const updated = await api.customers.update(customer.id, { loyaltyPoints: Math.max(0, customer.loyaltyPoints - pointsUsedValue) });
        setCustomer(prev => prev ? { ...prev, loyaltyPoints: updated.loyaltyPoints } : null);
      }

      setLastInvoice({
        id: created.id,
        invoiceNumber: created.invoiceNumber,
        items: [...cart],
        customer: customer ?? undefined,
        subtotal: created.subtotal,
        itemDiscount: created.itemDiscount,
        invoiceDiscount: created.invoiceDiscount,
        taxAmount: created.taxAmount,
        total: created.total,
        pointsUsed: pointsUsedValue,
        paymentMethods: created.payments.map(p => p.method),
        payments: created.payments.map(p => ({ method: p.method, amount: p.amount })),
        status: 'completed',
        createdAt: created.createdAt,
        cashierId: created.userId,
        cashierName,
        warehouseId: created.warehouseId,
        warehouseNameAr: warehouse?.nameAr,
      });
      setShowPaymentModal(false);
      setShowReceiptPreview(true);
      resetSaleState();
      toast.success(t('pos.success.saleCompleted'));
    } catch (e) {
      console.error('Sale failed:', e);
      const message = e instanceof ApiError ? e.message : t('pos.errors.saleFailed');
      toast.error(message);
    } finally {
      setIsProcessing(false);
    }
  }, [cart, customer, warehouse, cashierName, subtotal, itemDiscountTotal, invoiceDiscount, taxAmount, total, resetSaleState, t]);

  const printReceipt = useCallback(async (format: 'thermal' | 'pdf' | 'a4') => {
    if (!lastInvoice) return;
    try {
      // The receipt markup is the only thing print CSS leaves visible.
      const result = await api.print({ silent: false, printBackground: true });
      void format;
      if (result.ok) {
        toast.success(t('pos.success.receiptPrinted'));
      } else if (!result.cancelled) {
        toast.error(result.error || t('pos.errors.printFailed'));
      }
    } catch (e) {
      console.error('Print failed:', e);
      toast.error(t('pos.errors.printFailed'));
    }
  }, [lastInvoice, t]);

  // const reprintReceipt = useCallback(async (invoiceId: string) => {
  //   try {
  //     const result = await api.print({ silent: false, printBackground: true });
  //     void invoiceId;
  //     if (result.ok) {
  //       toast.success(t('pos.success.receiptPrinted'));
  //     } else if (!result.cancelled) {
  //       toast.error(result.error || t('pos.errors.printFailed'));
  //     }
  //   } catch (e) {
  //     console.error('Reprint failed:', e);
  //     toast.error(t('pos.errors.printFailed'));
  //   }
  // }, []);

  // Keyboard shortcuts
  const shortcuts = useMemo(() => DEFAULT_SHORTCUTS.map(s => ({
    key: s.key,
    description: t(s.description as TranslationKey),
    action: () => {
      switch (s.key) {
        case 'F1': setShowShortcuts(true); break;
        case 'F2': searchInputRef.current?.focus(); break;
        case 'F3': break; // customers
        case 'F4': if (cart.length > 0) setShowPaymentModal(true); break;
        case 'F5': void suspendInvoice(); break;
        case 'F6': break; // resume
        case 'F7': break; // returns
        case 'F8': break; // history
        case 'F9': break; // calculator
        case 'F10': break; // close shift
        case 'F11': break; // printer settings
        case 'Escape': setShowShortcuts(false); break;
      }
    },
    global: s.global,
  })), [cart.length, suspendInvoice]);

  useKeyboardShortcuts(shortcuts);

  return (
    <div className={`pos-screen ${isRTL ? 'rtl' : 'ltr'}`} dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="pos-main-grid">
        {/* SEARCH STRIP: full-width top band (edge to edge, up to the invoice
            totals) — search input on top, category filter buttons under it. */}
        <div className="pos-search-strip">
          {/* Product Search */}
          <ProductSearch
            ref={searchInputRef}
            query={searchQuery}
            onSearch={handleSearch}
            results={searchResults}
            onSelect={(product) => addToCart(product)}
            selectedCategoryId={selectedCategoryId}
            onCategoryChange={handleCategoryChange}
            categories={categories}
          />

          {/* Category Filter Buttons */}
          <ProductCategories
            categories={categories}
            selectedCategoryId={selectedCategoryId}
            onCategoryChange={handleCategoryChange}
          />
        </div>

        {/* PICKER: Favorites + the collapsed suggestions section at the bottom
            (search and filters live in the full-width strip above). */}
        <div className="pos-left-panel">
          {/* Quick Products (Favorites) */}
          <QuickProducts
            products={quickProducts}
            onAddToCart={addToCart}
            onToggleFavorite={async (id, fav) => {
              setQuickProducts(prev => prev.map(p => p.id === id ? { ...p, isFavorite: fav } : p));
            }}
            canManageFavorites
          />

          {/* Suggestions: best sellers + recently sold, hidden until opened */}
          <section className="suggestions-block">
            <button
              type="button"
              className="suggestions-toggle"
              aria-expanded={showSuggestions}
              aria-controls="pos-suggestions"
              onClick={() => setShowSuggestions(prev => !prev)}
            >
              <Sparkles className="toggle-icon" size={16} />
              <span className="toggle-title">{t('pos.suggestions.title')}</span>
              <span className="suggestions-hint">{t('pos.suggestions.hint')}</span>
              <ChevronDown className={`chevron ${showSuggestions ? 'open' : ''}`} size={16} />
            </button>
            {showSuggestions && (
              <div className="suggestions-content" id="pos-suggestions">
                <BestSellers
                  onAddToCart={addToCart}
                  selectedCategoryId={selectedCategoryId}
                />
                <RecentlySold
                  onAddToCart={addToCart}
                  limit={8}
                />
              </div>
            )}
          </section>
        </div>

        {/* CART COLUMN: own sticky column so the cart never scrolls out of view */}
        <div className="pos-cart-panel">
          <ShoppingCart
            items={cart}
            selectedItemId={selectedCartItemId}
            onSelectItem={setSelectedCartItemId}
            onUpdateQuantity={updateQuantity}
            onUpdateDiscount={updateDiscount}
            onRemove={removeFromCart}
            onClear={resetSaleState}
            onSuspend={suspendInvoice}
            onCustomerChange={setCustomer}
            customer={customer}
            suspendedInvoices={suspendedInvoices}
            onResumeInvoice={resumeInvoice}
            onBatchSelect={handleBatchSelect}
            onRestoreCart={setCart}
          />
        </div>

        {/* RIGHT PANEL: Inventory + Totals + Checkout */}
        <div className="pos-right-panel">
          {/* Inventory Panel */}
          <InventoryPanel
            product={selectedProductForInventory || (selectedCartItemId ? cart.find(i => i.id === selectedCartItemId)?.product || null : null)}
            batches={productBatches.length > 0 ? productBatches : (selectedCartItemId ? cart.find(i => i.id === selectedCartItemId)?.batch ? [cart.find(i => i.id === selectedCartItemId)!.batch] : [] : [])}
          />

          {/* Invoice Totals */}
          <InvoiceTotals
            items={cart}
            invoiceDiscount={invoiceDiscount}
            onInvoiceDiscountChange={setInvoiceDiscount}
            customer={customer}
            paymentMethods={paymentMethods}
            onAddPaymentMethod={(method) => {
              if (!paymentMethods.includes(method)) setPaymentMethods(prev => [...prev, method]);
              setPaymentAllocations(prev => [...prev, { method, amount: remaining }]);
            }}
            onRemovePaymentMethod={(method) => {
              setPaymentMethods(prev => prev.filter(m => m !== method));
              setPaymentAllocations(prev => prev.filter(p => p.method !== method));
            }}
            paymentAllocations={paymentAllocations}
            onUpdatePaymentAllocation={(index: number, field: 'amount' | 'reference', value: string) => setPaymentAllocations(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p))}
          />

          {/* Checkout Actions */}
          <CheckoutActions
            total={Number(total)}
            cartCount={cart.length}
            isProcessing={isProcessing}
            onCheckout={() => setShowPaymentModal(true)}
            onPrintPreview={() => setShowReceiptPreview(true)}
            onReprint={() => {}}
            onCompleteWithoutPrint={() => handlePaymentComplete(paymentAllocations)}
          />
        </div>
      </div>

      {/* Modals */}
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        total={total}
        paymentMethods={paymentMethods}
        paymentAllocations={paymentAllocations}
        onUpdateAllocations={setPaymentAllocations}
        onComplete={handlePaymentComplete}
        customer={customer}
        isProcessing={isProcessing}
      />

      <ReceiptPreview
        isOpen={showReceiptPreview}
        onClose={() => setShowReceiptPreview(false)}
        invoice={lastInvoice}
        onPrint={printReceipt}
      />

      <KeyboardShortcuts
        shortcuts={shortcuts}
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
    </div>
  );
}