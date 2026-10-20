import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryBatchRow } from '@pharmacy/shared';
import type { ApiRequestPayload, ApiResponse } from '../../../shared/ipc';
import { dictionaries } from '../../i18n/dictionaries';
import { setBridge } from '../../lib/bridge';
import { useAuthStore } from '../../store/auth';
import { createFakeBridge, DEMO_USER } from '../../test/fake-bridge';
import { Toaster } from '../ui/toast';
import { TransferDialog } from './TransferDialog';
import { InventoryPage } from '../../pages/InventoryPage';

const ar = dictionaries.ar;

const WAREHOUSES = [
  {
    id: 'wh_main',
    code: 'MAIN',
    nameAr: 'المخزن الرئيسي',
    nameEn: null,
    isDefault: true,
    isActive: true,
  },
  {
    id: 'wh_shop',
    code: 'SHOP',
    nameAr: 'مخزن الصيدلية',
    nameEn: null,
    isDefault: false,
    isActive: true,
  },
];

const BATCH_ROWS: InventoryBatchRow[] = [
  {
    batchId: 'bat_1',
    productId: 'prd_1',
    sku: 'SKU-1',
    productNameAr: 'باراسيتامول 500',
    productNameEn: null,
    barcode: null,
    warehouseId: 'wh_main',
    warehouseNameAr: 'المخزن الرئيسي',
    lotNumber: 'LOT-A',
    expiryDate: '2027-01-31',
    manufactureDate: null,
    quantity: 30,
    costPrice: '5.00',
    salePrice: '9.00',
    daysToExpiry: 180,
    isExpired: false,
    isNearExpiry: false,
    stockValue: '150.00',
  },
  {
    batchId: 'bat_2',
    productId: 'prd_2',
    sku: 'SKU-2',
    productNameAr: 'أموكسيسيلين 250',
    productNameEn: null,
    barcode: null,
    warehouseId: 'wh_main',
    warehouseNameAr: 'المخزن الرئيسي',
    lotNumber: 'LOT-B',
    expiryDate: '2026-12-31',
    manufactureDate: null,
    quantity: 8,
    costPrice: '7.00',
    salePrice: '12.00',
    daysToExpiry: 60,
    isExpired: false,
    isNearExpiry: true,
    stockValue: '56.00',
  },
];

interface BridgeLog {
  transfers: Array<Record<string, unknown>>;
}

/** Fake bridge that serves warehouses + batches and records transfer posts. */
function setupBridge(): BridgeLog {
  const log: BridgeLog = { transfers: [] };
  setBridge(
    createFakeBridge({
      request: (payload: ApiRequestPayload): ApiResponse<unknown> | undefined => {
        if (payload.method === 'GET' && payload.path === '/warehouses') {
          return { ok: true, status: 200, data: WAREHOUSES };
        }
        if (payload.method === 'GET' && payload.path === '/inventory/batches') {
          return {
            ok: true,
            status: 200,
            data: { items: BATCH_ROWS, total: BATCH_ROWS.length, page: 1, pageSize: 25, totalPages: 1 },
          };
        }
        if (payload.method === 'POST' && payload.path === '/inventory/transfers') {
          const body = (payload.body ?? {}) as Record<string, unknown>;
          log.transfers.push(body);
          return {
            ok: true,
            status: 201,
            data: {
              reference: 'TRF-TEST01',
              fromWarehouseId: body.fromWarehouseId,
              toWarehouseId: body.toWarehouseId,
              linesTransferred: 1,
              unitsTransferred: 1,
              items: [],
            },
          };
        }
        return undefined;
      },
    }),
  );
  return log;
}

function renderDialog(target: InventoryBatchRow | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 0 } },
  });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <TransferDialog open onOpenChange={onOpenChange} initialBatch={target} />
      <Toaster />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <InventoryPage />
      <Toaster />
    </QueryClientProvider>,
  );
}

function selectValue(label: string): string {
  return (screen.getByLabelText(label) as HTMLSelectElement).value;
}

async function waitForBatchOptions(): Promise<void> {
  await waitFor(() => {
    const select = screen.getByLabelText(`${ar['inventory.transferBatch']} 1`) as HTMLSelectElement;
    expect(select.options.length).toBeGreaterThan(1);
  });
}

describe('TransferDialog', () => {
  beforeEach(() => {
    useAuthStore.setState({
      status: 'authenticated',
      user: DEMO_USER,
      permissions: ['inventory:read', 'inventory:adjust'],
      error: null,
    });
  });

  it('moves a picked batch into the destination warehouse', async () => {
    const user = userEvent.setup();
    const log = setupBridge();
    const onOpenChange = renderDialog(null);

    // The default warehouse is preselected as the source once they load.
    await waitFor(() => expect(selectValue(ar['inventory.transferFrom'])).toBe('wh_main'));
    await waitForBatchOptions();

    await user.selectOptions(screen.getByLabelText(ar['inventory.transferTo']), 'wh_shop');
    await user.selectOptions(screen.getByLabelText(`${ar['inventory.transferBatch']} 1`), 'bat_2');
    await user.clear(screen.getByLabelText(`${ar['inventory.quantity']} 1`));
    await user.type(screen.getByLabelText(`${ar['inventory.quantity']} 1`), '5');

    await user.click(screen.getByRole('button', { name: ar['common.save'] }));

    await waitFor(() => expect(log.transfers).toHaveLength(1));
    expect(log.transfers[0]).toMatchObject({
      fromWarehouseId: 'wh_main',
      toWarehouseId: 'wh_shop',
      items: [{ batchId: 'bat_2', quantity: 5 }],
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('refuses to submit without a destination warehouse and picked batch', async () => {
    const user = userEvent.setup();
    const log = setupBridge();
    renderDialog(null);

    await waitFor(() => expect(selectValue(ar['inventory.transferFrom'])).toBe('wh_main'));

    await user.click(screen.getByRole('button', { name: ar['common.save'] }));

    await screen.findByText(ar['inventory.transferIncomplete']);
    expect(log.transfers).toHaveLength(0);
  });

  it('blocks a quantity above the batch available on the client', async () => {
    const user = userEvent.setup();
    const log = setupBridge();
    renderDialog(null);

    await waitFor(() => expect(selectValue(ar['inventory.transferFrom'])).toBe('wh_main'));
    await waitForBatchOptions();

    await user.selectOptions(screen.getByLabelText(ar['inventory.transferTo']), 'wh_shop');
    await user.selectOptions(screen.getByLabelText(`${ar['inventory.transferBatch']} 1`), 'bat_2');
    await user.clear(screen.getByLabelText(`${ar['inventory.quantity']} 1`));
    await user.type(screen.getByLabelText(`${ar['inventory.quantity']} 1`), '9');

    await user.click(screen.getByRole('button', { name: ar['common.save'] }));

    await screen.findByText(ar['inventory.transferInsufficient']);
    expect(log.transfers).toHaveLength(0);
  });

  it('preselects the batch the dialog was opened from', async () => {
    const log = setupBridge();
    const user = userEvent.setup();
    const onOpenChange = renderDialog(BATCH_ROWS[0]);

    await waitFor(() => expect(selectValue(ar['inventory.transferFrom'])).toBe('wh_main'));
    await waitFor(() => expect(selectValue(`${ar['inventory.transferBatch']} 1`)).toBe('bat_1'));

    await user.selectOptions(screen.getByLabelText(ar['inventory.transferTo']), 'wh_shop');
    await user.click(screen.getByRole('button', { name: ar['common.save'] }));

    await waitFor(() => expect(log.transfers).toHaveLength(1));
    expect(log.transfers[0]).toMatchObject({
      fromWarehouseId: 'wh_main',
      toWarehouseId: 'wh_shop',
      items: [{ batchId: 'bat_1', quantity: 1 }],
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('InventoryPage transfer entry points', () => {
  it('hides the transfer action from roles without inventory:adjust', async () => {
    setupBridge();
    useAuthStore.setState({
      status: 'authenticated',
      user: { ...DEMO_USER, role: 'CASHIER' },
      permissions: ['inventory:read'],
      error: null,
    });

    renderPage();

    await screen.findByText(ar['inventory.batches']);
    expect(screen.queryAllByRole('button', { name: ar['inventory.transfer'] })).toHaveLength(0);
  });

  it('opens the transfer dialog from the header and from a batch row', async () => {
    const user = userEvent.setup();
    setupBridge();
    useAuthStore.setState({
      status: 'authenticated',
      user: { ...DEMO_USER, role: 'INVENTORY_CLERK' },
      permissions: ['inventory:read', 'inventory:adjust'],
      error: null,
    });

    renderPage();

    // Header entry point: one button in the toolbar plus one per batch row.
    await screen.findByText('SKU-1');
    const buttons = screen.getAllByRole('button', { name: ar['inventory.transfer'] });
    expect(buttons.length).toBeGreaterThanOrEqual(2);

    await user.click(buttons[0]!);
    expect(await screen.findByText(ar['inventory.transferTitle'])).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: ar['common.cancel'] }));

    // Row entry point preselects that batch (rows render in list order).
    const rowButtons = await screen.findAllByRole('button', { name: ar['inventory.transfer'] });
    await user.click(rowButtons[rowButtons.length - 1]!);
    await screen.findByText(ar['inventory.transferTitle']);
    await waitFor(() => expect(selectValue(`${ar['inventory.transferBatch']} 1`)).toBe('bat_2'));
    expect(selectValue(ar['inventory.transferFrom'])).toBe('wh_main');
  });
});
