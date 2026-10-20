/*
 *
 * Hand-maintained OpenAPI 3.1 description of the HTTP surface.
 * Kept next to the routers so it can be reviewed in the same pull request as the
 * endpoints. Served at `GET /api/openapi.json` and browsable at `GET /api/docs`
 * (a dependency-free viewer so the offline installer never needs a CDN).
 */

const errorResponse = {
  description: 'Error envelope shared by every endpoint',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: {},
              requestId: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

function listOf(itemProps: Record<string, unknown>, required: string[] = []) {
  return {
    type: 'object',
    required: ['items', 'total', 'page', 'pageSize', 'totalPages'],
    properties: {
      items: {
        type: 'array',
        items: { type: 'object', required, properties: itemProps },
      },
      total: { type: 'integer' },
      page: { type: 'integer' },
      pageSize: { type: 'integer' },
      totalPages: { type: 'integer' },
    },
  };
}

const productProps = {
  id: { type: 'string' },
  sku: { type: 'string' },
  barcode: { type: 'string', nullable: true },
  nameAr: { type: 'string' },
  nameEn: { type: 'string', nullable: true },
  brand: { type: 'string', nullable: true },
  manufacturer: { type: 'string', nullable: true },
  categoryId: { type: 'string', nullable: true },
  dosageForm: { type: 'string' },
  strength: { type: 'string', nullable: true },
  packSize: { type: 'string', nullable: true },
  unit: { type: 'string', nullable: true },
  costPrice: { type: 'string', description: 'Decimal string; 0.00 without cost:view' },
  salePrice: { type: 'string' },
  taxRate: { type: 'string' },
  minStock: { type: 'integer' },
  prescriptionClass: { type: 'string', enum: ['OTC', 'PRESCRIPTION', 'CONTROLLED'] },
  isActive: { type: 'boolean' },
  totalStock: { type: 'integer' },
  nearestExpiry: { type: 'string', nullable: true },
};

export function buildOpenApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Pharmacy Management & POS API',
      version: '0.1.0',
      description:
        'Offline-first pharmacy management API. Authentication uses short-lived JWT access tokens plus rotating refresh tokens stored in the database.',
    },
    servers: [{ url: '/api/v1' }],
    tags: [
      { name: 'health' },
      { name: 'auth' },
      { name: 'products' },
      { name: 'categories' },
      { name: 'suppliers' },
      { name: 'warehouses' },
      { name: 'inventory' },
      { name: 'purchases' },
      { name: 'sales' },
      { name: 'customers' },
      { name: 'debts' },
      { name: 'reports' },
  { name: 'audit' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/healthz': {
        get: {
          tags: ['health'],
          summary: 'Liveness probe',
          security: [],
          responses: { 200: { description: 'Process is running' } },
        },
      },
      '/readyz': {
        get: {
          tags: ['health'],
          summary: 'Readiness probe (checks PostgreSQL)',
          security: [],
          responses: {
            200: { description: 'Ready' },
            503: { ...errorResponse, description: 'Degraded' },
          },
        },
      },
      '/auth/login': {
        post: {
          tags: ['auth'],
          summary: 'Authenticate and open a session',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['username', 'password'],
                  properties: {
                    username: { type: 'string' },
                    password: { type: 'string' },
                    terminalId: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Session issued (access + refresh token)' },
            401: { ...errorResponse, description: 'Invalid credentials' },
            429: { ...errorResponse, description: 'Too many attempts' },
          },
        },
      },
      '/auth/refresh': {
        post: {
          tags: ['auth'],
          summary: 'Rotate a refresh token',
          security: [],
          responses: { 200: { description: 'New session' }, 401: errorResponse },
        },
      },
      '/auth/me': {
        get: { tags: ['auth'], summary: 'Current user + effective permissions', responses: { 200: { description: 'OK' }, 401: errorResponse } },
      },
      '/auth/logout': {
        post: { tags: ['auth'], summary: 'Revoke the current session', responses: { 204: { description: 'Revoked' } } },
      },
      '/products': {
        get: {
          tags: ['products'],
          summary: 'List / search products (name, SKU, barcode, ingredient)',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'categoryId', in: 'query', schema: { type: 'string' } },
            { name: 'prescriptionClass', in: 'query', schema: { type: 'string' } },
            { name: 'lowStock', in: 'query', schema: { type: 'boolean' } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 25, maximum: 200 } },
          ],
          responses: { 200: { description: 'Paginated products', content: { 'application/json': { schema: listOf(productProps) } } } },
        },
        post: {
          tags: ['products'],
          summary: 'Create a product',
          responses: { 201: { description: 'Created' }, 409: errorResponse },
        },
      },
      '/products/{id}': {
        get: { tags: ['products'], summary: 'Get one product', responses: { 200: { description: 'OK' }, 404: errorResponse } },
        patch: { tags: ['products'], summary: 'Update a product', responses: { 200: { description: 'OK' } } },
        delete: { tags: ['products'], summary: 'Delete (or deactivate) a product', responses: { 200: { description: 'OK' } } },
      },
      '/products/{id}/image': {
        get: {
          tags: ['products'],
          summary: 'Product photo as base64 (404 when the product has none)',
          responses: { 200: { description: 'Photo bytes + MIME type' }, 404: errorResponse },
        },
        put: {
          tags: ['products'],
          summary: 'Store / replace the product photo (data URL, PNG/JPEG/WebP, max 1 MB)',
          responses: { 200: { description: 'Stored' }, 400: errorResponse },
        },
        delete: {
          tags: ['products'],
          summary: 'Remove the product photo (idempotent)',
          responses: { 200: { description: 'Removed' } },
        },
      },
      '/products/lookup/{barcode}': {
        get: {
          tags: ['products'],
          summary: 'Barcode / SKU lookup for the POS scanner',
          responses: { 200: { description: 'Product' }, 404: errorResponse },
        },
      },
      '/products/barcodes/assign': {
        post: {
          tags: ['products'],
          summary: 'Assign a unique internal EAN-13 barcode to every product missing one',
          responses: { 200: { description: 'Assignment summary' }, 403: errorResponse },
        },
      },
      '/inventory/batches': {
        get: { tags: ['inventory'], summary: 'Batch list (FEFO order by default)', responses: { 200: { description: 'OK' } } },
      },
      '/inventory/stock': {
        get: { tags: ['inventory'], summary: 'Aggregated stock levels per product', responses: { 200: { description: 'OK' } } },
      },
      '/inventory/alerts': {
        get: {
          tags: ['inventory'],
          summary: 'Low stock / near expiry / expired alerts',
          responses: { 200: { description: 'OK' } },
        },
      },
      '/inventory/movements': {
        get: { tags: ['inventory'], summary: 'Stock ledger', responses: { 200: { description: 'OK' } } },
      },
      '/inventory/receipts': {
        post: {
          tags: ['inventory'],
          summary: 'Atomic goods receipt (creates batches + movements)',
          responses: { 201: { description: 'Received' }, 409: errorResponse },
        },
      },
      '/inventory/adjustments': {
        post: {
          tags: ['inventory'],
          summary: 'Atomic stock adjustment (FEFO when no batch is given)',
          responses: { 201: { description: 'Adjusted' }, 400: errorResponse, 409: errorResponse },
        },
      },
      '/inventory/transfers': {
        post: {
          tags: ['inventory'],
          summary: 'Atomic warehouse-to-warehouse transfer of whole batches',
          responses: {
            201: { description: 'Transferred' },
            400: errorResponse,
            404: errorResponse,
            409: errorResponse,
          },
        },
      },
      '/categories': {
        get: { tags: ['categories'], summary: 'List categories', responses: { 200: { description: 'OK' } } },
        post: { tags: ['categories'], summary: 'Create category', responses: { 201: { description: 'Created' } } },
      },
      '/suppliers': {
        get: { tags: ['suppliers'], summary: 'List suppliers', responses: { 200: { description: 'OK' } } },
        post: { tags: ['suppliers'], summary: 'Create supplier', responses: { 201: { description: 'Created' } } },
      },
      '/warehouses': {
        get: {
          tags: ['warehouses'],
          summary: 'List warehouses (active-only by default) with optional live stock statistics',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string', maxLength: 120 } },
            {
              name: 'includeInactive',
              in: 'query',
              schema: { type: 'boolean', default: false },
              description: 'Include deactivated warehouses',
            },
            {
              name: 'withStats',
              in: 'query',
              schema: { type: 'boolean', default: false },
              description:
                'Add per-warehouse stock counters. `stockValue` is null unless the caller holds cost:view',
            },
          ],
          responses: {
            200: {
              description: 'Array of warehouses (kept as an array for existing dropdowns)',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['id', 'code', 'nameAr', 'isDefault', 'isActive'],
                      properties: {
                        id: { type: 'string' },
                        code: { type: 'string' },
                        nameAr: { type: 'string' },
                        nameEn: { type: 'string', nullable: true },
                        address: { type: 'string', nullable: true },
                        isDefault: { type: 'boolean' },
                        isActive: { type: 'boolean' },
                        createdAt: { type: 'string', format: 'date-time' },
                        updatedAt: { type: 'string', format: 'date-time' },
                        stats: {
                          type: 'object',
                          nullable: true,
                          properties: {
                            skuCount: { type: 'integer' },
                            batchCount: { type: 'integer' },
                            unitCount: { type: 'integer' },
                            stockValue: { type: 'string', nullable: true },
                            expiringSoonCount: { type: 'integer' },
                            expiredCount: { type: 'integer' },
                            openShiftCount: { type: 'integer' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            403: errorResponse,
          },
        },
        post: {
          tags: ['warehouses'],
          summary: 'Create a warehouse (first active warehouse becomes the default)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['code', 'nameAr'],
                  properties: {
                    code: { type: 'string', minLength: 2, maxLength: 20, pattern: '^[A-Za-z0-9_-]+$' },
                    nameAr: { type: 'string', minLength: 2, maxLength: 120 },
                    nameEn: { type: 'string', maxLength: 120, nullable: true },
                    address: { type: 'string', maxLength: 300, nullable: true },
                    isDefault: { type: 'boolean', default: false },
                    isActive: { type: 'boolean', default: true },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Warehouse created' },
            400: errorResponse,
            403: errorResponse,
            409: errorResponse,
          },
        },
      },
      '/warehouses/{id}': {
        patch: {
          tags: ['warehouses'],
          summary: 'Update a warehouse or switch the single default receiving point',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    nameAr: { type: 'string', minLength: 2, maxLength: 120 },
                    nameEn: { type: 'string', maxLength: 120, nullable: true },
                    address: { type: 'string', maxLength: 300, nullable: true },
                    isDefault: { type: 'boolean' },
                    isActive: { type: 'boolean' },
                  },
                  description:
                    'Send an empty string to clear nameEn/address. The code is immutable and rejected by the strict schema.',
                },
              },
            },
          },
          responses: {
            200: { description: 'Updated warehouse' },
            400: errorResponse,
            403: errorResponse,
            404: errorResponse,
            409: errorResponse,
          },
        },
      },
      '/sales': {
        get: {
          tags: ['sales'],
          summary: 'Paginated invoices (status, invoice number, date range)',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['completed', 'suspended', 'voided'] } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 25, maximum: 200 } },
          ],
          responses: { 200: { description: 'Paginated sales' }, 403: errorResponse },
        },
        post: {
          tags: ['sales'],
          summary: 'Complete a checkout (atomic stock deduction + ISSUE movements)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['subtotal', 'taxAmount', 'total', 'items'],
                  properties: {
                    subtotal: { type: 'string' },
                    itemDiscount: { type: 'string' },
                    invoiceDiscount: { type: 'string' },
                    taxAmount: { type: 'string' },
                    total: { type: 'string' },
                    warehouseId: { type: 'string' },
                    customerId: { type: 'string', nullable: true },
                    note: { type: 'string', nullable: true },
                    items: { type: 'array', items: { type: 'object' } },
                    payments: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
          responses: { 201: { description: 'Sale created' }, 400: errorResponse, 409: errorResponse },
        },
      },
      '/sales/suspended': {
        get: { tags: ['sales'], summary: 'Suspended holds for this terminal', responses: { 200: { description: 'OK' } } },
      },
      '/sales/best-sellers': {
        get: {
          tags: ['sales'],
          summary: 'Best-seller widget data (period: day/week/month/all)',
          parameters: [
            { name: 'period', in: 'query', schema: { type: 'string', enum: ['day', 'week', 'month', 'all'], default: 'week' } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } },
          ],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/sales/recent': {
        get: {
          tags: ['sales'],
          summary: 'Recently sold widget data (period: 7d/30d/today)',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } },
            { name: 'period', in: 'query', schema: { type: 'string', default: '7d' } },
          ],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/sales/{id}': {
        get: { tags: ['sales'], summary: 'Sale with its items, batches and payments', responses: { 200: { description: 'OK' }, 404: errorResponse } },
      },
      '/sales/{id}/void': {
        post: {
          tags: ['sales'],
          summary: 'Void a completed sale and restock through RETURN_IN movements',
          responses: { 200: { description: 'Voided' }, 403: errorResponse, 404: errorResponse },
        },
      },
      '/customers': {
        get: {
          tags: ['customers'],
          summary: 'Customer directory (POS search via ?q=)',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20, maximum: 200 } },
          ],
          responses: { 200: { description: 'Paginated customers' }, 403: errorResponse },
        },
        post: {
          tags: ['customers'],
          summary: 'Create a customer',
          responses: { 201: { description: 'Created' }, 400: errorResponse, 409: errorResponse },
        },
      },
      '/customers/{id}': {
        get: { tags: ['customers'], summary: 'Get one customer', responses: { 200: { description: 'OK' }, 404: errorResponse } },
        patch: { tags: ['customers'], summary: 'Update a customer', responses: { 200: { description: 'OK' }, 404: errorResponse } },
      },
      '/debts': {
        get: {
          tags: ['debts'],
          summary: 'Customers with an outstanding balance (receivables) plus totals',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 25, maximum: 200 } },
          ],
          responses: { 200: { description: 'Paginated debtors + summary' }, 403: errorResponse },
        },
      },
      '/debts/{id}': {
        get: {
          tags: ['debts'],
          summary: 'Customer statement: credit invoices and collected payments',
          responses: { 200: { description: 'Debt ledger' }, 404: errorResponse },
        },
      },
      '/debts/{id}/payments': {
        post: {
          tags: ['debts'],
          summary: 'Collect a payment against the outstanding balance',
          responses: { 201: { description: 'Payment recorded' }, 400: errorResponse, 404: errorResponse },
        },
      },
      '/purchases': {
        get: {
          tags: ['purchases'],
          summary: 'Goods receipts (supplier purchases) grouped by reference, with totals',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 25, maximum: 200 } },
          ],
          responses: { 200: { description: 'Paginated receipts + summary' }, 403: errorResponse },
        },
        post: {
          tags: ['purchases'],
          summary: 'Record a goods receipt: stock in, batches and supplier payable in one transaction',
          responses: { 201: { description: 'Receipt recorded' }, 400: errorResponse, 404: errorResponse },
        },
      },
      '/purchases/{reference}': {
        get: {
          tags: ['purchases'],
          summary: 'One goods receipt with its lines',
          responses: { 200: { description: 'Receipt detail' }, 404: errorResponse },
        },
      },
      '/reports/sales': {
        get: {
          tags: ['reports'],
          summary:
            'Dashboard sales analytics: KPIs, previous-period comparison, daily trend, COGS/profit (cost:view), categories, top products, payments',
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Business date YYYY-MM-DD (defaults to today)' },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Business date YYYY-MM-DD (defaults to today)' },
          ],
          responses: { 200: { description: 'Sales report' }, 400: errorResponse, 403: errorResponse },
        },
      },
      '/reports/inventory': {
        get: {
          tags: ['reports'],
          summary:
            'Dashboard inventory analytics: valuation (cost/retail), stock health, reorder list, expiry buckets, fast/slow movers',
          responses: { 200: { description: 'Inventory report' }, 403: errorResponse },
        },
      },
      '/audit': {
        get: {
          tags: ['audit'],
          summary: 'Read the audit trail (newest first)',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'action', in: 'query', schema: { type: 'string' } },
            { name: 'entityType', in: 'query', schema: { type: 'string' } },
            { name: 'userId', in: 'query', schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 25, maximum: 200 } },
          ],
          responses: { 200: { description: 'Paginated audit entries' }, 403: errorResponse },
        },
      },
      '/cashdrawer': {
        get: {
          tags: ['cashdrawer'],
          summary: 'Shift history with filters and aggregate totals',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['OPEN', 'CLOSED'] } },
            { name: 'warehouseId', in: 'query', schema: { type: 'string' } },
            { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 25, maximum: 200 } },
          ],
          responses: { 200: { description: 'Paginated shifts + summary' }, 403: errorResponse },
        },
      },
      '/cashdrawer/open': {
        post: {
          tags: ['cashdrawer'],
          summary: 'Open a shift with opening cash (one open shift per cashier/warehouse and per terminal)',
          parameters: [
            {
              name: 'x-terminal-id',
              in: 'header',
              required: false,
              schema: { type: 'string', maxLength: 64 },
              description: 'Optional terminal identifier; unique among open shifts',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['warehouseId'],
                  properties: {
                    warehouseId: { type: 'string' },
                    openingBalance: { type: 'string', default: '0.00' },
                    notes: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          responses: { 201: { description: 'Shift opened' }, 400: errorResponse, 403: errorResponse, 409: errorResponse },
        },
      },
      '/cashdrawer/{id}': {
        get: {
          tags: ['cashdrawer'],
          summary: 'Shift detail: live reconciliation while open, frozen snapshot after closing',
          responses: { 200: { description: 'Shift detail' }, 403: errorResponse, 404: errorResponse },
        },
      },
      '/cashdrawer/{id}/close': {
        patch: {
          tags: ['cashdrawer'],
          summary: 'Close a shift atomically: expected cash, counted cash, variance and method breakdown are persisted',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['closingBalance'],
                  properties: {
                    closingBalance: { type: 'string', description: 'Physically counted cash; never adjusted to match' },
                    notes: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Shift closed with reconciliation snapshot' },
            400: errorResponse,
            403: errorResponse,
            404: errorResponse,
            409: errorResponse,
          },
        },
      },
      '/cashdrawer/{id}/movements': {
        post: {
          tags: ['cashdrawer'],
          summary: 'Record an explicit paid-in or paid-out cash movement on an open shift',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['type', 'amount', 'reason'],
                  properties: {
                    type: { type: 'string', enum: ['paid_in', 'paid_out'] },
                    amount: { type: 'string' },
                    reason: { type: 'string', minLength: 3, maxLength: 300 },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Movement recorded' },
            400: errorResponse,
            403: errorResponse,
            404: errorResponse,
            409: errorResponse,
          },
        },
      },
    },
  } as const;
}

/** Dependency-free HTML viewer for the OpenAPI document (works fully offline). */
export function renderDocsPage(): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Pharmacy API — OpenAPI</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: "Segoe UI", Tahoma, sans-serif; margin: 0; padding: 24px; background: #0f172a; color: #e2e8f0; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.sub { color: #94a3b8; margin: 0 0 16px; font-size: 13px; }
  a { color: #38bdf8; }
  details { border: 1px solid #1e293b; border-radius: 8px; margin-bottom: 8px; background: #111c33; }
  summary { cursor: pointer; padding: 10px 14px; font-weight: 600; font-size: 14px; }
  .op { padding: 8px 14px 12px; border-top: 1px solid #1e293b; font-size: 13px; }
  .method { display: inline-block; min-width: 62px; font-weight: 700; text-transform: uppercase; }
  .get { color: #4ade80; } .post { color: #60a5fa; } .patch { color: #fbbf24; } .delete { color: #f87171; }
  code { background: #0b1220; padding: 2px 6px; border-radius: 4px; }
</style>
</head>
<body>
  <h1>واجهة برمجة نظام إدارة الصيدلية</h1>
  <p class="sub">Pharmacy Management &amp; POS API — <a href="/api/openapi.json">/api/openapi.json</a></p>
  <div id="doc">جارٍ التحميل…</div>
  <script>
    fetch('/api/openapi.json')
      .then(function (r) { return r.json(); })
      .then(function (spec) {
        var root = document.getElementById('doc');
        root.innerHTML = '';
        Object.keys(spec.paths).forEach(function (path) {
          var item = spec.paths[path];
          var d = document.createElement('details');
          var s = document.createElement('summary');
          s.textContent = path;
          d.appendChild(s);
          Object.keys(item).forEach(function (method) {
            var op = item[method];
            var div = document.createElement('div');
            div.className = 'op';
            var m = document.createElement('span');
            m.className = 'method ' + method;
            m.textContent = method;
            div.appendChild(m);
            div.appendChild(document.createTextNode(' ' + (op.summary || '')));
            if (op.description) {
              var p = document.createElement('div');
              p.textContent = op.description;
              p.style.color = '#94a3b8';
              div.appendChild(p);
            }
            d.appendChild(div);
          });
          root.appendChild(d);
        });
      })
      .catch(function () { document.getElementById('doc').textContent = 'فشل تحميل المستند'; });
  </script>
</body>
</html>`;
}
