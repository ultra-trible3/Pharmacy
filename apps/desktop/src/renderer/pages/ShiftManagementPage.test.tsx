import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ShiftManagementPage } from './ShiftManagementPage';
import { setBridge } from '../lib/bridge';
import { createFakeBridge } from '../test/fake-bridge';
import type { ApiRequestPayload, ApiResponse } from '../../shared/ipc';
import { useAuthStore } from '../store/auth';
import { formatMoney } from '../lib/format';

const WAREHOUSES = [
  {
    id: 'w1',
    code: 'WH1',
    nameAr: 'المخزن الرئيسي',
    nameEn: 'Main warehouse',
    isDefault: true,
    isActive: true,
  },
  {
    id: 'w2',
    code: 'WH2',
    nameAr: 'صالة البيع',
    nameEn: 'Sales hall',
    isDefault: false,
    isActive: true,
  },
];

const OPEN_SHIFT = {
  id: 'shift1',
  userId: 'u1',
  userName: 'زياد محمد',
  warehouseId: 'w1',
  warehouseNameAr: 'المخزن الرئيسي',
  terminalId: 'TERM-1',
  openedAt: '2026-10-20T08:00:00.000Z',
  closedAt: null,
  openingBalance: '100.00',
  expectedBalance: '100.00',
  closingBalance: null,
  variance: null,
  status: 'OPEN',
  notes: null,
  createdAt: '2026-10-20T08:00:00.000Z',
};

const SHIFTS_RESPONSE = {
  items: [OPEN_SHIFT],
  total: 1,
  page: 1,
  pageSize: 25,
  totalPages: 1,
  summary: {
    totalShifts: 1,
    openShifts: 1,
    closedShifts: 0,
    totalOpeningBalance: '100.00',
    totalClosingBalance: '0.00',
    netCash: '0.00',
  },
};

const RECONCILIATION = {
  openingBalance: '100.00',
  cashSales: '60.00',
  cardSales: '20.00',
  walletSales: '10.00',
  creditSales: '25.00',
  totalSales: '115.00',
  customerCashTotal: '10.00',
  cashRefunds: '5.00',
  expensesTotal: '15.00',
  paidInTotal: '10.00',
  paidOutTotal: '5.00',
  expectedCash: '155.00',
  countedCash: null,
  variance: null,
  salesCount: 5,
  voidedSalesCount: 1,
  refundsCount: 1,
  expensesCount: 1,
  customerPaymentsCount: 1,
  paidInCount: 1,
  paidOutCount: 1,
  transactionCount: 7,
  status: 'OPEN',
};

const DETAIL_RESPONSE = {
  ...OPEN_SHIFT,
  closedByName: null,
  warehouseNameEn: 'Main warehouse',
  reconciliation: RECONCILIATION,
  movements: [
    {
      id: 'movement1',
      shiftId: 'shift1',
      type: 'paid_in',
      amount: '10.00',
      reason: 'إيداع من الخزنة',
      userId: 'u1',
      userName: 'زياد محمد',
      createdAt: '2026-10-20T09:00:00.000Z',
    },
  ],
  recentSales: [
    {
      id: 'sale1',
      invoiceNumber: 'INV-20261020-00001',
      total: '11.50',
      status: 'completed',
      paymentMethods: ['cash'],
      cashAmount: '11.50',
      cardAmount: '0.00',
      walletAmount: '0.00',
      creditAmount: '0.00',
      createdAt: '2026-10-20T09:10:00.000Z',
    },
  ],
};

function signIn() {
  useAuthStore.setState({
    status: 'authenticated',
    user: { id: 'u1', username: 'ziad', fullName: 'زياد محمد', role: 'OWNER', isActive: true },
    permissions: [],
    error: null,
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ShiftManagementPage />
    </QueryClientProvider>,
  );
}

function withShiftData(
  onOpen: (payload: ApiRequestPayload) => void,
  options: {
    onClose?: (payload: ApiRequestPayload) => void;
    onMovement?: (payload: ApiRequestPayload) => void;
  } = {},
) {
  return (request: ApiRequestPayload): ApiResponse<unknown> | undefined => {
    if (request.path === '/cashdrawer' && request.method === 'GET') {
      return { ok: true, status: 200, data: SHIFTS_RESPONSE };
    }
    if (request.path === '/warehouses') {
      return { ok: true, status: 200, data: WAREHOUSES };
    }
    if (request.path === '/cashdrawer/shift1' && request.method === 'GET') {
      return { ok: true, status: 200, data: DETAIL_RESPONSE };
    }
    if (request.path === '/cashdrawer/open' && request.method === 'POST') {
      onOpen(request);
      return {
        ok: true,
        status: 200,
        data: {
          ...OPEN_SHIFT,
          id: 'shift-new',
          warehouseId: 'w1',
        },
      };
    }
    if (request.path === '/cashdrawer/shift1/close' && request.method === 'PATCH') {
      options.onClose?.(request);
      return {
        ok: true,
        status: 200,
        data: {
          ...DETAIL_RESPONSE,
          status: 'CLOSED',
          closedAt: '2026-10-20T18:00:00.000Z',
          closingBalance: '150.00',
          variance: '-5.00',
          reconciliation: {
            ...RECONCILIATION,
            status: 'CLOSED',
            countedCash: '150.00',
            variance: '-5.00',
          },
        },
      };
    }
    if (request.path === '/cashdrawer/shift1/movements' && request.method === 'POST') {
      options.onMovement?.(request);
      return {
        ok: true,
        status: 201,
        data: {
          id: 'movement-new',
          shiftId: 'shift1',
          type: 'paid_in',
          amount: '15.00',
          reason: 'إيداع إضافي',
          userId: 'u1',
          userName: 'زياد محمد',
          createdAt: '2026-10-20T10:00:00.000Z',
        },
      };
    }
    return undefined;
  };
}

describe('shift management page', () => {
  it('opens a shift with the warehouse picked from the select', async () => {
    const user = userEvent.setup();
    const opened: ApiRequestPayload[] = [];
    signIn();
    setBridge(createFakeBridge({ request: withShiftData((payload) => opened.push(payload)) }));
    renderPage();

    const openButton = await screen.findByRole('button', { name: /افتتاح وردية/ });
    expect(openButton).toBeEnabled();

    await user.click(openButton);

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'صالة البيع' }));

    await user.click(within(dialog).getByRole('button', { name: 'افتتاح وردية' }));

    expect(opened).toHaveLength(1);
    expect(opened[0]?.body).toMatchObject({ warehouseId: 'w2' });
  });

  it('blocks opening a shift until a warehouse is selected', async () => {
    const user = userEvent.setup();
    const opened: ApiRequestPayload[] = [];
    signIn();
    setBridge(createFakeBridge({ request: withShiftData((payload) => opened.push(payload)) }));
    renderPage();

    await user.click(await screen.findByRole('button', { name: /افتتاح وردية/ }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'افتتاح وردية' }));

    expect(opened).toHaveLength(0);
    expect(await screen.findByText('يرجى اختيار مخزن')).toBeInTheDocument();
  });

  it('shows the reconciliation breakdown and movement history for a shift', async () => {
    const user = userEvent.setup();
    signIn();
    setBridge(createFakeBridge({ request: withShiftData(() => undefined) }));
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'التفاصيل' }));

    const dialog = await screen.findByRole('dialog');
    const expected = await within(dialog).findByTestId('expected-cash');
    expect(expected).toHaveTextContent(formatMoney('155.00', 'ar-EG'));
    expect(within(dialog).getByText('مبيعات نقدية')).toBeInTheDocument();
    expect(within(dialog).getByText(formatMoney('60.00', 'ar-EG'))).toBeInTheDocument();
    expect(
      within(dialog).getAllByText(formatMoney('5.00', 'ar-EG')).length,
    ).toBeGreaterThan(0);
    expect(within(dialog).getByText('إيداع من الخزنة')).toBeInTheDocument();
    expect(within(dialog).getByText('INV-20261020-00001')).toBeInTheDocument();
    expect(dialog.textContent).toContain('TERM-1');
  });

  it('previews the variance and submits the physically counted cash', async () => {
    const user = userEvent.setup();
    const closed: ApiRequestPayload[] = [];
    signIn();
    setBridge(
      createFakeBridge({
        request: withShiftData(() => undefined, { onClose: (payload) => closed.push(payload) }),
      }),
    );
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'إغلاق الوردة' }));

    const dialog = await screen.findByRole('dialog');
    const expected = await within(dialog).findByTestId('expected-cash');
    expect(expected).toHaveTextContent(formatMoney('155.00', 'ar-EG'));

    const counted = within(dialog).getByLabelText('النقدية المعدودة فعليًا *');
    // The expected amount must never be pre-filled as the counted amount.
    expect((counted as HTMLInputElement).value).toBe('');

    await user.type(counted, '150.00');
    const variance = within(dialog).getByTestId('variance-value');
    expect(variance).toHaveTextContent('عجز');
    expect(variance).toHaveTextContent(formatMoney('-5.00', 'ar-EG'));

    await user.type(within(dialog).getByLabelText('ملاحظات الإغلاق'), 'نهاية اليوم');
    await user.click(within(dialog).getByRole('button', { name: 'إغلاق الوردة' }));

    expect(closed).toHaveLength(1);
    expect(closed[0]?.path).toBe('/cashdrawer/shift1/close');
    expect(closed[0]?.body).toMatchObject({
      closingBalance: '150.00',
      notes: 'نهاية اليوم',
    });
  });

  it('records an explicit cash movement on an open shift', async () => {
    const user = userEvent.setup();
    const movements: ApiRequestPayload[] = [];
    signIn();
    setBridge(
      createFakeBridge({
        request: withShiftData(() => undefined, {
          onMovement: (payload) => movements.push(payload),
        }),
      }),
    );
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'التفاصيل' }));
    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByLabelText('المبلغ'), '15.00');
    await user.type(within(dialog).getByLabelText('السبب'), 'إيداع إضافي');
    await user.click(within(dialog).getByRole('button', { name: 'تسجيل حركة نقدية' }));

    expect(movements).toHaveLength(1);
    expect(movements[0]?.path).toBe('/cashdrawer/shift1/movements');
    expect(movements[0]?.body).toMatchObject({
      type: 'paid_in',
      amount: '15.00',
      reason: 'إيداع إضافي',
    });
  });
});
