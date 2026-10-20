import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProductBarcode } from './ProductBarcode';

describe('ProductBarcode', () => {
  it('draws stripes and the human-readable value', () => {
    const { container } = render(<ProductBarcode value="6221000000010" heightMm={10} />);

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('data-symbology', 'EAN13');
    expect(screen.getByText('6221000000010')).toBeInTheDocument();
  });

  it('falls back to Code 128 for alphanumeric codes', () => {
    const { container } = render(<ProductBarcode value="PH-000123" />);
    expect(container.querySelector('svg')).toHaveAttribute('data-symbology', 'CODE128');
  });

  it('explains a missing or undrawable barcode instead of showing stripes', () => {
    const { rerender } = render(<ProductBarcode value={null} />);
    expect(screen.getByText('بدون باركود')).toBeInTheDocument();

    rerender(<ProductBarcode value="صنف" />);
    expect(screen.getByText('باركود غير قابل للطباعة')).toBeInTheDocument();
  });
});
