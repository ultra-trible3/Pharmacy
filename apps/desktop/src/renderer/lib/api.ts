import type {
  AuthUser,
  CashDrawerDto,
  CashDrawerSummaryDto,
  CashMovementInput,
  ExpenseDto,
  ExpenseSummaryDto,
  InventoryBatchRow,
  Paginated,
  PaymentMethodCode,
  ProductListItem,
  ShiftCashMovementDto,
  ShiftDetailDto,
  StockLevelRow,
  SALE_STATUSES,
  SaleStatusCode,
} from '@pharmacy/shared';
import type {
  ApiRequestPayload,
  ApiResponse,
  PrintOptions,
  PrintResult,
  ServerHealth,
} from '../../shared/ipc';
import { getBridge } from './bridge';

export { SALE_STATUSES, SaleStatusCode };

/** Normalised error thrown by every helper in this module. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function unwrap<T>(response: ApiResponse<T>): T {
  if (response.ok) return response.data;
  throw new ApiError(
    response.error.message,
    response.error.code,
    response.status,
    response.error.details,
  );
}

async function call<T>(payload: ApiRequestPayload): Promise<T> {
  return unwrap(await getBridge().api.request<T>(payload));
}

export interface ListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface CategoryDto {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  productCount: number;
  isActive: boolean;
}

export interface SupplierDto {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxNumber: string | null;
  balance: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Live counters returned by `GET /warehouses?withStats=true`. */
export interface WarehouseStatsDto {
  skuCount: number;
  batchCount: number;
  unitCount: number;
  /** Decimal string, or `null` when the caller lacks `cost:view`. */
  stockValue: string | null;
  expiringSoonCount: number;
  expiredCount: number;
  openShiftCount: number;
}

export interface WarehouseDto {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  address: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  stats?: WarehouseStatsDto;
}

export type WarehouseListParams = {
  q?: string;
  includeInactive?: boolean;
  withStats?: boolean;
};

export interface WarehouseCreateBody {
  code: string;
  nameAr: string;
  nameEn?: string;
  address?: string;
  isDefault?: boolean;
  isActive?: boolean;
}

/** PATCH body: `''` clears a text column, omitted keys stay unchanged. */
export interface WarehouseUpdateBody {
  nameAr?: string;
  nameEn?: string | null;
  address?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface MovementDto {
  id: string;
  sku: string;
  productNameAr: string;
  warehouseNameAr: string;
  type: string;
  quantity: number;
  unitCost: string;
  reason: string | null;
  reference: string | null;
  userName: string | null;
  createdAt: string;
}

/** One line of a warehouse transfer: a whole batch and the units to move. */
export interface TransferItemBody {
  batchId: string;
  quantity: number;
}

/** Warehouse transfer document (`POST /inventory/transfers`). */
export interface TransferBody {
  fromWarehouseId: string;
  toWarehouseId: string;
  reference?: string;
  notes?: string;
  items: TransferItemBody[];
}

export interface TransferResultDto {
  reference: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  linesTransferred: number;
  unitsTransferred: number;
  items: Array<{
    productId: string;
    nameAr: string;
    lotNumber: string;
    expiryDate: string;
    quantity: number;
    fromBatchId: string;
    toBatchId: string;
    remainingQuantity: number;
  }>;
}

export interface AlertsDto {
  generatedAt: string;
  nearExpiryDays: number;
  summary: {
    lowStockCount: number;
    nearExpiryCount: number;
    expiredCount: number;
    totalStockUnits: number;
  };
  lowStock: StockLevelRow[];
  nearExpiry: InventoryBatchRow[];
  expired: InventoryBatchRow[];
}

export interface AssignBarcodesResult {
  assigned: number;
  remaining: number;
}

export interface CustomerDto {
  id: string;
  name: string;
  phone: string | null;
  creditLimit: string;
  currentBalance: string;
  loyaltyPoints: number;
  notes?: string;
}

export interface DebtorDto extends CustomerDto {
  isOverLimit: boolean;
  availableCredit: string;
}

export interface DebtSummaryDto {
  totalOutstanding: string;
  debtorsTotal: number;
  overLimitCount: number;
}

export interface DebtEntryDto {
  id: string;
  type: 'sale' | 'payment';
  amount: string;
  createdAt: string;
  method?: string;
  reference?: string | null;
  note?: string | null;
  userName?: string | null;
  saleId?: string;
  invoiceNumber?: string;
}

export interface DebtLedgerDto {
  customer: DebtorDto;
  entries: DebtEntryDto[];
}

export type DebtPaymentMethod = 'cash' | 'card' | 'wallet';

export interface DebtPaymentBody {
  amount: string;
  method: DebtPaymentMethod;
  reference?: string;
  note?: string;
}

export interface DebtPaymentDto {
  id: string;
  amount: string;
  method: string;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

export interface PurchaseReceiptRowDto {
  reference: string;
  createdAt: string;
  warehouseId: string;
  warehouseNameAr: string | null;
  supplierId: string | null;
  supplierNameAr: string | null;
  linesCount: number;
  unitsCount: number;
  totalCost: string;
  userName: string | null;
}

export interface PurchaseSummaryDto {
  totalCost: string;
  receiptsTotal: number;
  unitsTotal: number;
}

export interface PurchaseReceiptLineDto {
  id: string;
  productId: string;
  sku: string;
  productNameAr: string;
  batchId: string | null;
  lotNumber: string | null;
  expiryDate: string | null;
  quantity: number;
  unitCost: string;
  lineTotal: string;
}

export interface PurchaseReceiptDetailDto {
  reference: string;
  createdAt: string;
  warehouseId: string;
  warehouseNameAr: string | null;
  supplierId: string | null;
  supplierNameAr: string | null;
  userName: string | null;
  linesCount: number;
  unitsCount: number;
  totalCost: string;
  lines: PurchaseReceiptLineDto[];
}

export interface PurchaseReceiptItemBody {
  productId: string;
  lotNumber: string;
  expiryDate: string;
  manufactureDate?: string;
  quantity: number;
  costPrice: string;
  salePrice?: string;
}

export interface PurchaseReceiptBody {
  warehouseId: string;
  supplierId?: string;
  reference?: string;
  notes?: string;
  items: PurchaseReceiptItemBody[];
}

export interface SalesReportPointDto {
  date: string;
  revenue: string;
  transactions: number;
  units: number;
}

export interface SalesReportProfitDto {
  cogs: string;
  netRevenue: string;
  grossProfit: string;
  marginPct: number | null;
}

/** Dashboard sales analytics (`GET /reports/sales`), mirrors the server DTO. */
export interface SalesReportDto {
  range: { from: string; to: string; days: number; previousFrom: string; previousTo: string };
  revenue: string;
  transactions: number;
  itemsSold: number;
  avgTicket: string;
  previous: { revenue: string; transactions: number; itemsSold: number; avgTicket: string };
  growth: { revenuePct: number | null; transactionsPct: number | null };
  /** `null` unless the role holds `cost:view`. */
  profit: (SalesReportProfitDto & { previous: SalesReportProfitDto }) | null;
  daily: SalesReportPointDto[];
  dailyPrevious: Array<{ date: string; revenue: string }>;
  byCategory: Array<{ categoryId: string | null; nameAr: string | null; revenue: string; units: number }>;
  topProducts: Array<{
    productId: string;
    sku: string;
    nameAr: string;
    units: number;
    revenue: string;
    invoices: number;
  }>;
  payments: Array<{ method: PaymentMethodCode; amount: string; count: number }>;
}

export type ExpiryBucketKey = 'expired' | 'd30' | 'd60' | 'd90';

/** Dashboard inventory analytics (`GET /reports/inventory`), mirrors the server DTO. */
export interface InventoryReportDto {
  generatedAt: string;
  nearExpiryDays: number;
  stock: { units: number; costValue: string | null; retailValue: string | null };
  health: { healthy: number; low: number; out: number; total: number };
  reorder: Array<{ productId: string; sku: string; nameAr: string; totalQuantity: number; minStock: number }>;
  expiryBuckets: Array<{ bucket: ExpiryBucketKey; batches: number; units: number; value: string | null }>;
  upcomingExpiries: Array<{
    batchId: string;
    productId: string;
    sku: string;
    nameAr: string;
    lotNumber: string;
    expiryDate: string;
    daysToExpiry: number;
    quantity: number;
    value: string | null;
  }>;
  valueByCategory: Array<{ categoryId: string | null; nameAr: string | null; units: number; value: string | null }>;
  fastMoving: Array<{ productId: string; sku: string; nameAr: string; units: number; invoices: number }>;
  slowMoving: Array<{
    productId: string;
    sku: string;
    nameAr: string;
    totalQuantity: number;
    units30d: number;
    lastSoldAt: string | null;
  }>;
}

export interface SaleDto {
  id: string;
  invoiceNumber: string;
  customerId: string | null;
  userId: string;
  warehouseId: string;
  subtotal: string;
  itemDiscount: string;
  invoiceDiscount: string;
  taxAmount: string;
  total: string;
  /** Loyalty points redeemed for this sale. */
  pointsUsed: number;
  status: 'completed' | 'suspended' | 'voided';
  note: string | null;
  createdAt: string;
  updatedAt: string;
  items: SaleItemDto[];
  payments: PaymentDto[];
  customer?: CustomerDto;
  user?: { id: string; fullName: string };
  warehouse?: { id: string; nameAr: string };
}

/** Batch snapshot attached to a sale line (matches the POS cart batch shape). */
export interface SaleBatchInfo {
  id: string;
  lotNumber: string;
  expiryDate: string;
  quantity: number;
  costPrice: string;
  salePrice: string;
  warehouseId: string;
  warehouseNameAr: string;
  manufactureDate: string | null;
  daysToExpiry: number;
  isExpired: boolean;
  isNearExpiry: boolean;
  stockValue: string;
}

export interface SaleItemDto {
  id: string;
  saleId: string;
  productId: string;
  batchId: string | null;
  quantity: number;
  unitPrice: string;
  discount: string;
  lineTotal: string;
  product?: ProductListItem;
  batch?: SaleBatchInfo;
}

export interface PaymentDto {
  id: string;
  saleId: string;
  method: PaymentMethodCode;
  amount: string;
  reference: string | null;
  createdAt: string;
}

export interface SaleCreateBody {
  /** Server generates the invoice number when omitted. */
  invoiceNumber?: string;
  customerId?: string | null;
  warehouseId?: string;
  subtotal: string;
  itemDiscount?: string;
  invoiceDiscount?: string;
  taxAmount: string;
  total: string;
  /** Loyalty points redeemed for discount (100 points = 1 currency unit). */
  pointsUsed?: number;
  note?: string;
  items: Array<{
    productId: string;
    batchId?: string | null;
    quantity: number;
    unitPrice: string;
    discount?: string;
    lineTotal?: string;
  }>;
  payments: Array<{
    method: PaymentMethodCode;
    amount: string;
    reference?: string | null;
  }>;
}

export interface CustomerCreateBody {
  name: string;
  phone?: string;
  notes?: string;
  loyaltyPoints?: number;
  creditLimit?: string;
  currentBalance?: string;
}

export interface CategoryCreateBody {
  code: string;
  nameAr: string;
  nameEn?: string;
  isActive?: boolean;
}

export interface SupplierCreateBody {
  code: string;
  nameAr: string;
  nameEn?: string;
  phone?: string;
  email?: string;
  address?: string;
  taxNumber?: string;
  openingBalance?: string | number;
  isActive?: boolean;
}

/** PATCH body: `''` clears a text column, omitted keys stay unchanged. */
export interface SupplierUpdateBody {
  nameAr?: string;
  nameEn?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  taxNumber?: string | null;
  isActive?: boolean;
}

/** A row of the server-side audit trail (GET /audit). */
export interface AuditEntryDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  userId: string | null;
  ip: string | null;
  userAgent: string | null;
  terminalId: string | null;
  createdAt: string;
  user: { id: string; fullName: string; username: string } | null;
}

/** User DTO returned by /api/v1/users endpoints. */
export interface UserDto {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** POST /users body. */
export interface UserCreateBody {
  username: string;
  fullName: string;
  email?: string;
  role: string;
  password: string;
}

/** PATCH /users/:id body. */
export interface UserUpdateBody {
  fullName?: string;
  email?: string | null;
  role?: string;
  isActive?: boolean;
}

/** POST /users/:id/reset-password body. */
export interface UserResetPasswordBody {
  newPassword: string;
  mustChangePassword?: boolean;
}

export interface ProductCreateBody {
  sku: string;
  nameAr: string;
  nameEn?: string;
  barcode?: string;
  brand?: string;
  manufacturer?: string;
  activeIngredient?: string;
  categoryId?: string;
  dosageForm?: string;
  strength?: string;
  packSize?: string;
  unit?: string;
  costPrice: string;
  salePrice: string;
  taxRate?: string;
  minStock?: number;
  prescriptionClass?: string;
  isActive?: boolean;
}

/** Photo payload returned by `GET /products/:id/image`. */
export interface ProductImagePayload {
  mimeType: string;
  dataBase64: string;
  updatedAt: string;
}

export const api = {
  health: (): Promise<ServerHealth> => getBridge().health(),

  appInfo: () => getBridge().appInfo(),

  session: () => getBridge().auth.session(),

  login: async (username: string, password: string) =>
    unwrap(await getBridge().auth.login({ username, password })),

  logout: (): Promise<void> => getBridge().auth.logout(),

  print: (options?: PrintOptions): Promise<PrintResult> => getBridge().print(options),

  products: {
    list: (params: ListParams) =>
      call<Paginated<ProductListItem>>({ method: 'GET', path: '/products', query: params }),
    /** POS product lookup by name/barcode/SKK text (`q` + optional `categoryId`). */
    search: (params: ListParams) =>
      call<Paginated<ProductListItem>>({ method: 'GET', path: '/products', query: params }),
    get: (id: string) => call<ProductListItem>({ method: 'GET', path: `/products/${id}` }),
    lookup: (barcode: string) =>
      call<ProductListItem>({
        method: 'GET',
        path: `/products/lookup/${encodeURIComponent(barcode)}`,
      }),
    create: (body: ProductCreateBody) =>
      call<ProductListItem>({ method: 'POST', path: '/products', body }),
    update: (id: string, body: Partial<ProductCreateBody>) =>
      call<ProductListItem>({ method: 'PATCH', path: `/products/${id}`, body }),
    remove: (id: string) =>
      call<{ deleted: boolean; deactivated: boolean; reason?: string }>({
        method: 'DELETE',
        path: `/products/${id}`,
      }),
    assignBarcodes: () =>
      call<AssignBarcodesResult>({ method: 'POST', path: '/products/barcodes/assign' }),
    /** Product photo bytes for a card/list row; 404 when the product has none. */
    image: (id: string) =>
      call<ProductImagePayload>({ method: 'GET', path: `/products/${id}/image` }),
    setImage: (id: string, dataUrl: string) =>
      call<{ hasImage: boolean; updatedAt: string }>({
        method: 'PUT',
        path: `/products/${id}/image`,
        body: { dataUrl },
      }),
    removeImage: (id: string) =>
      call<{ hasImage: boolean }>({ method: 'DELETE', path: `/products/${id}/image` }),
  },

  categories: {
    list: (params: ListParams = { pageSize: 200 }) =>
      call<Paginated<CategoryDto>>({ method: 'GET', path: '/categories', query: params }),
    create: (body: CategoryCreateBody) =>
      call<CategoryDto>({ method: 'POST', path: '/categories', body }),
    update: (id: string, body: Partial<CategoryCreateBody>) =>
      call<CategoryDto>({ method: 'PATCH', path: `/categories/${id}`, body }),
    remove: (id: string) =>
      call<{ deleted: boolean; deactivated: boolean; reason?: string }>({
        method: 'DELETE',
        path: `/categories/${id}`,
      }),
  },

  suppliers: {
    list: (params: ListParams = { pageSize: 200 }) =>
      call<Paginated<SupplierDto>>({ method: 'GET', path: '/suppliers', query: params }),
    create: (body: SupplierCreateBody) =>
      call<SupplierDto>({ method: 'POST', path: '/suppliers', body }),
    update: (id: string, body: SupplierUpdateBody) =>
      call<SupplierDto>({ method: 'PATCH', path: `/suppliers/${id}`, body }),
    remove: (id: string) =>
      call<{ deleted: boolean; deactivated: boolean; reason?: string }>({
        method: 'DELETE',
        path: `/suppliers/${id}`,
      }),
  },

  warehouses: {
    list: (params: WarehouseListParams = {}) =>
      call<WarehouseDto[]>({ method: 'GET', path: '/warehouses', query: params }),
    create: (body: WarehouseCreateBody) =>
      call<WarehouseDto>({ method: 'POST', path: '/warehouses', body }),
    update: (id: string, body: WarehouseUpdateBody) =>
      call<WarehouseDto>({ method: 'PATCH', path: `/warehouses/${encodeURIComponent(id)}`, body }),
  },

  inventory: {
    batches: (params: ListParams) =>
      call<Paginated<InventoryBatchRow>>({ method: 'GET', path: '/inventory/batches', query: params }),
    stock: (params: ListParams) =>
      call<Paginated<StockLevelRow>>({ method: 'GET', path: '/inventory/stock', query: params }),
    alerts: (warehouseId?: string) =>
      call<AlertsDto>({ method: 'GET', path: '/inventory/alerts', query: { warehouseId } }),
    movements: (params: ListParams) =>
      call<Paginated<MovementDto>>({ method: 'GET', path: '/inventory/movements', query: params }),
    receive: (body: unknown) =>
      call<{ reference: string; unitsReceived: number; totalCost: string }>({
        method: 'POST',
        path: '/inventory/receipts',
        body,
      }),
    adjust: (body: unknown) =>
      call<{ quantity: number }>({ method: 'POST', path: '/inventory/adjustments', body }),
    transfer: (body: TransferBody) =>
      call<TransferResultDto>({ method: 'POST', path: '/inventory/transfers', body }),
    createBatch: (body: unknown) =>
      call<{ id: string; quantity: number }>({
        method: 'POST',
        path: '/inventory/batches',
        body,
      }),
    updateBatch: (id: string, body: unknown) =>
      call<{ id: string; quantity: number }>({
        method: 'PATCH',
        path: `/inventory/batches/${id}`,
        body,
      }),
    deleteBatch: (id: string) =>
      call<{ id: string; deleted: boolean; deactivated: boolean; reason?: string }>({
        method: 'DELETE',
        path: `/inventory/batches/${id}`,
      }),
  },

  sales: {
    list: (params: ListParams) =>
      call<Paginated<SaleDto>>({ method: 'GET', path: '/sales', query: params }),
    get: (id: string) =>
      call<SaleDto>({ method: 'GET', path: `/sales/${id}` }),
    create: (body: SaleCreateBody) =>
      call<SaleDto>({ method: 'POST', path: '/sales', body }),
    suspend: (body: SaleCreateBody) =>
      call<SaleDto>({ method: 'POST', path: '/sales/suspend', body }),
    resume: (id: string) =>
      call<SaleDto>({ method: 'POST', path: `/sales/${id}/resume` }),
    void: (id: string, reason: string) =>
      call<SaleDto>({ method: 'POST', path: `/sales/${id}/void`, body: { reason } }),
    listSuspended: () =>
      call<SaleDto[]>({ method: 'GET', path: '/sales/suspended' }),
    getBestSellers: (params: { period: string; limit: number; page: number; categoryId?: string }) =>
      call<{ items: ProductListItem[]; total: number; page: number; pageSize: number }>({
        method: 'GET',
        path: '/sales/best-sellers',
        query: params,
      }),
    getRecentSales: (params: { limit: number; period: string }) =>
      call<{ items: ProductListItem[] }>({
        method: 'GET',
        path: '/sales/recent',
        query: params,
      }),
  },

  customers: {
    list: (params: ListParams) =>
      call<Paginated<CustomerDto>>({ method: 'GET', path: '/customers', query: params }),
    get: (id: string) =>
      call<CustomerDto>({ method: 'GET', path: `/customers/${id}` }),
    create: (body: CustomerCreateBody) =>
      call<CustomerDto>({ method: 'POST', path: '/customers', body }),
    update: (id: string, body: Partial<CustomerCreateBody>) =>
      call<CustomerDto>({ method: 'PATCH', path: `/customers/${id}`, body }),
    delete: (id: string) =>
      call<{ ok: boolean }>({ method: 'DELETE', path: `/customers/${id}` }),
  },

  debts: {
    list: (params: ListParams) =>
      call<Paginated<DebtorDto> & { summary: DebtSummaryDto }>({
        method: 'GET',
        path: '/debts',
        query: params,
      }),
    ledger: (customerId: string) =>
      call<DebtLedgerDto>({ method: 'GET', path: `/debts/${customerId}` }),
    pay: (customerId: string, body: DebtPaymentBody) =>
      call<{ customer: DebtorDto; payment: DebtPaymentDto }>({
        method: 'POST',
        path: `/debts/${customerId}/payments`,
        body,
      }),
  },

  expenses: {
    list: (params: ListParams) =>
      call<Paginated<ExpenseDto> & { summary: ExpenseSummaryDto }>({
        method: 'GET',
        path: '/expenses',
        query: params,
      }),
    get: (id: string) =>
      call<ExpenseDto>({ method: 'GET', path: `/expenses/${encodeURIComponent(id)}` }),
    create: (body: unknown) =>
      call<ExpenseDto>({ method: 'POST', path: '/expenses', body }),
    update: (id: string, body: unknown) =>
      call<ExpenseDto>({ method: 'PATCH', path: `/expenses/${encodeURIComponent(id)}`, body }),
    remove: (id: string) =>
      call<{ id: string; deleted: boolean }>({
        method: 'DELETE',
        path: `/expenses/${encodeURIComponent(id)}`,
      }),
  },

  purchases: {
    list: (params: ListParams) =>
      call<Paginated<PurchaseReceiptRowDto> & { summary: PurchaseSummaryDto }>({
        method: 'GET',
        path: '/purchases',
        query: params,
      }),
    get: (reference: string) =>
      call<PurchaseReceiptDetailDto>({
        method: 'GET',
        path: `/purchases/${encodeURIComponent(reference)}`,
      }),
    create: (body: PurchaseReceiptBody) =>
      call<{ reference: string; linesReceived: number; unitsReceived: number; totalCost: string }>({
        method: 'POST',
        path: '/purchases',
        body,
      }),
    update: (reference: string, body: PurchaseReceiptBody) =>
      call<{ reference: string; linesReceived: number; unitsReceived: number; totalCost: string }>({
        method: 'PATCH',
        path: `/purchases/${encodeURIComponent(reference)}`,
        body,
      }),
    remove: (reference: string) =>
      call<{ reference: string; reversed: boolean; unitsReversed: number }>({
        method: 'DELETE',
        path: `/purchases/${encodeURIComponent(reference)}`,
      }),
  },

  reports: {
    sales: (params: { from: string; to: string }) =>
      call<SalesReportDto>({ method: 'GET', path: '/reports/sales', query: params }),
    inventory: () =>
      call<InventoryReportDto>({ method: 'GET', path: '/reports/inventory' }),
  },

  audit: {
    list: (params: ListParams) =>
      call<Paginated<AuditEntryDto>>({ method: 'GET', path: '/audit', query: params }),
  },

  cashdrawer: {
    list: (params: ListParams) =>
      call<Paginated<CashDrawerDto> & { summary: CashDrawerSummaryDto }>({
        method: 'GET',
        path: '/cashdrawer',
        query: params,
      }),
    detail: (id: string) =>
      call<ShiftDetailDto>({
        method: 'GET',
        path: `/cashdrawer/${encodeURIComponent(id)}`,
      }),
    open: (body: unknown) =>
      call<CashDrawerDto>({ method: 'POST', path: '/cashdrawer/open', body }),
    close: (id: string, body: unknown) =>
      call<ShiftDetailDto>({
        method: 'PATCH',
        path: `/cashdrawer/${encodeURIComponent(id)}/close`,
        body,
      }),
    addMovement: (id: string, body: CashMovementInput) =>
      call<ShiftCashMovementDto>({
        method: 'POST',
        path: `/cashdrawer/${encodeURIComponent(id)}/movements`,
        body,
      }),
  },

  users: {
    list: (params: ListParams & { search?: string; role?: string; isActive?: boolean; sortBy?: string; sortOrder?: 'asc' | 'desc' }) =>
      call<Paginated<UserDto> & { items: UserDto[] }>({ method: 'GET', path: '/users', query: params }),
    get: (id: string) =>
      call<UserDto>({ method: 'GET', path: `/users/${encodeURIComponent(id)}` }),
    create: (body: UserCreateBody) =>
      call<UserDto>({ method: 'POST', path: '/users', body }),
    update: (id: string, body: UserUpdateBody) =>
      call<UserDto>({ method: 'PATCH', path: `/users/${encodeURIComponent(id)}`, body }),
    resetPassword: (id: string, body: UserResetPasswordBody) =>
      call<void>({ method: 'POST', path: `/users/${encodeURIComponent(id)}/reset-password`, body }),
    deactivate: (id: string) =>
      call<void>({ method: 'DELETE', path: `/users/${encodeURIComponent(id)}` }),
  },
};

export type { AuthUser };
