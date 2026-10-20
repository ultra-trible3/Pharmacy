import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ApiRequestPayload, ApiResponse } from '../../../shared/ipc';
import { setBridge } from '../../lib/bridge';
import { createFakeBridge } from '../../test/fake-bridge';
import { ProductThumb } from './ProductThumb';

function renderThumb(hasImage: boolean): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <ProductThumb
        productId="p1"
        hasImage={hasImage}
        alt="صورة الصنف"
        placeholderClassName="placeholder-icon"
        imageClassName="thumb"
      />
    </QueryClientProvider>,
  );
}

/** Serves the photo bytes `GET /products/p1/image` would return. */
function imageRequest(onCall?: () => void) {
  return (payload: ApiRequestPayload): ApiResponse<unknown> | undefined => {
    if (payload.method === 'GET' && payload.path === '/products/p1/image') {
      onCall?.();
      return {
        ok: true,
        status: 200,
        data: { mimeType: 'image/webp', dataBase64: 'AAAA', updatedAt: '2026-10-18T09:00:00.000Z' },
      };
    }
    return undefined;
  };
}

describe('ProductThumb', () => {
  it('keeps the pill placeholder and fetches nothing when the product has no photo', () => {
    let imageCalls = 0;
    setBridge(createFakeBridge({ request: imageRequest(() => { imageCalls += 1; }) }));

    renderThumb(false);

    expect(screen.queryByAltText('صورة الصنف')).not.toBeInTheDocument();
    expect(document.querySelector('.placeholder-icon svg')).not.toBeNull();
    expect(imageCalls).toBe(0);
  });

  it('renders the photo fetched through the bridge as a data URL', async () => {
    setBridge(createFakeBridge({ request: imageRequest() }));

    renderThumb(true);

    await waitFor(() =>
      expect(screen.getByAltText('صورة الصنف')).toHaveAttribute(
        'src',
        'data:image/webp;base64,AAAA',
      ),
    );
    expect(document.querySelector('.placeholder-icon')).toBeNull();
  });
});
