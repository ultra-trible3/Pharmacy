import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { POSPage } from './POSPage';
import { setBridge } from '../lib/bridge';
import { createFakeBridge } from '../test/fake-bridge';
import { dictionaries } from '../i18n/dictionaries';
import { useAuthStore } from '../store/auth';
import type { ApiResponse } from '../../shared/ipc';

const ar = dictionaries.ar;

const PRODUCT = {
  id: 'prd_paracetamol',
  sku: 'SKU-0001',
  barcode: '6221234567890',
  nameAr: 'باراسيتامول 500 مجم',
  nameEn: 'Paracetamol 500mg',
  brand: 'الدلتا',
  manufacturer: 'Delta Pharma',
  categoryId: 'cat_analgesic',
  categoryNameAr: 'مسكنات الألم',
  dosageForm: 'TABLET',
  strength: '500 مجم',
  packSize: '20 قرص',
  unit: 'علبة',
  costPrice: '10.00',
  salePrice: '25.00',
  taxRate: '0.00',
  minStock: 5,
  prescriptionClass: 'OTC',
  isActive: true,
  totalStock: 120,
  nearestExpiry: '2027-06-01',
};

const BATCH = {
  batchId: 'bat_001',
  productId: PRODUCT.id,
  sku: PRODUCT.sku,
  productNameAr: PRODUCT.nameAr,
  productNameEn: PRODUCT.nameEn,
  barcode: PRODUCT.barcode,
  warehouseId: 'wh_main',
  warehouseNameAr: 'المخزن الرئيسي',
  lotNumber: 'L-2026-001',
  expiryDate: '2027-06-01',
  manufactureDate: null,
  quantity: 50,
  costPrice: '10.00',
  salePrice: '25.00',
  daysToExpiry: 210,
  isExpired: false,
  isNearExpiry: false,
  stockValue: '500.00',
};

function ok(data: unknown): ApiResponse<unknown> {
  return { ok: true, status: 200, data };
}

function renderPOS() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <POSPage />
    </QueryClientProvider>,
  );
}

/** Bridge whose product search answers with a single product + batch. */
function catalogueBridge() {
  return createFakeBridge({
    request: (payload) => {
      if (payload.method === 'GET' && payload.path.startsWith('/inventory/batches')) {
        return ok({ items: [BATCH], total: 1, page: 1, pageSize: 50, totalPages: 1 });
      }
      if (payload.method === 'GET' && payload.path === '/products') {
        // Only the free-text search returns the product; the quick-products
        // list (no `q`) stays empty so the assertions stay unambiguous.
        if (payload.query?.q) {
          return ok({ items: [PRODUCT], total: 1, page: 1, pageSize: 20, totalPages: 1 });
        }
        return ok({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
      }
      return undefined;
    },
  });
}

describe('POS page', () => {
  beforeEach(() => {
    setBridge(createFakeBridge());
    useAuthStore.setState({ status: 'anonymous', user: null, permissions: [], error: null });
  });

  it('renders the cashier screen without crashing', async () => {
    renderPOS();

    expect(await screen.findByRole('heading', { name: ar['pos.cart.title'] })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: ar['pos.totals.title'] })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(ar['pos.search.placeholder'])).toBeInTheDocument();
  });

  it('keeps the receipt preview closed until an invoice exists', async () => {
    renderPOS();

    await screen.findByRole('heading', { name: ar['pos.cart.title'] });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('searches the catalogue and adds the selected product to the cart', async () => {
    setBridge(catalogueBridge());
    renderPOS();

    const input = screen.getByPlaceholderText(ar['pos.search.placeholder']);
    fireEvent.change(input, { target: { value: 'باراسيتامول' } });

    // Debounced search renders the matching product row.
    const addButton = await screen.findByRole(
      'button',
      { name: ar['pos.search.add'] },
      { timeout: 4000 },
    );
    expect(screen.getByText(PRODUCT.nameAr)).toBeInTheDocument();

    fireEvent.click(addButton);

    // The dropdown closes and the line lands in the cart.
    await waitFor(
      () => expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(screen.getAllByText(PRODUCT.nameAr)).toHaveLength(1);
    expect(screen.getAllByDisplayValue('1').length).toBeGreaterThan(0);
  });

  /** Types the product search, waits for the debounced row and adds it. */
  async function addParacetamolToCart() {
    fireEvent.change(screen.getByPlaceholderText(ar['pos.search.placeholder']), {
      target: { value: 'باراسيتامول' },
    });
    const addButton = await screen.findByRole('button', { name: ar['pos.search.add'] }, { timeout: 4000 });
    fireEvent.click(addButton);
    await waitFor(
      () => expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(screen.getAllByText(PRODUCT.nameAr)).toHaveLength(1);
  }

  it('suspends the invoice through the in-app note dialog and empties the cart', async () => {
    setBridge(catalogueBridge());
    renderPOS();
    await addParacetamolToCart();

    // Electron does not implement window.prompt (electron#472, wontfix), so
    // the old prompt-based flow silently did nothing — the note now comes
    // from an in-app dialog.
    fireEvent.click(screen.getByRole('button', { name: ar['pos.cart.suspend'] }));
    const dialog = await screen.findByRole('dialog', { name: ar['pos.confirm.suspendInvoice'] });

    fireEvent.change(screen.getByLabelText(ar['pos.confirm.suspendNote']), {
      target: { value: 'العميل يعود بعد قليل' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: ar['pos.cart.suspend'] }));

    // The hold is stored (server or offline-first local copy), the cart is
    // emptied without any extra confirmation, and the hold is resumable.
    expect(await screen.findByRole('button', { name: `${ar['pos.cart.resume']} (1)` })).toBeInTheDocument();
    expect(screen.queryByText(PRODUCT.nameAr)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('suspends the current invoice directly when F5 is pressed', async () => {
    setBridge(catalogueBridge());
    renderPOS();
    await addParacetamolToCart();

    // Plain F5 must reach the POS action: the old matcher demanded a
    // modifier for every shortcut, so F5 never fired at all.
    fireEvent.keyDown(window, { key: 'F5' });

    expect(await screen.findByRole('button', { name: `${ar['pos.cart.resume']} (1)` })).toBeInTheDocument();
    expect(screen.queryByText(PRODUCT.nameAr)).not.toBeInTheDocument();
  });

  it('keeps best-sellers and recently-sold folded behind a suggestions toggle', async () => {
    renderPOS();

    await screen.findByRole('heading', { name: ar['pos.cart.title'] });

    // Discovery lists and the old search tabs stay out of the cashier's way.
    expect(screen.queryByRole('heading', { name: ar['pos.bestsellers.title'] })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: new RegExp(ar['pos.suggestions.title']) });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);

    // Expanding mounts the lists (their fetches only start now).
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('heading', { name: ar['pos.bestsellers.title'] })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: ar['pos.recentlySold.title'] })).toBeInTheDocument();
  });
});
