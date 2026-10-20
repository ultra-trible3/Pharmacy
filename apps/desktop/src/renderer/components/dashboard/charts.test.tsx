import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BarList, DonutChart, TrendChart } from './charts';

describe('dashboard chart primitives', () => {
  it('renders trend labels, axis ticks and one polyline per series', () => {
    const { container } = render(
      <TrendChart
        labels={['14/10/2026', '15/10/2026', '16/10/2026']}
        series={[
          { name: 'الحالية', color: 'hsl(var(--primary))', values: [10, 20, 30], area: true },
          {
            name: 'السابقة',
            color: 'hsl(var(--muted-foreground))',
            values: [5, 8, 13],
            dashed: true,
          },
        ]}
        formatValue={(value) => `${value} ج.م`}
        formatAxis={(value) => String(value)}
      />,
    );

    expect(screen.getByText('14/10/2026')).toBeInTheDocument();
    expect(screen.getByText('16/10/2026')).toBeInTheDocument();
    // Nice maximum of 30 → top y-axis tick.
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
    // The first series paints an area under its line.
    expect(container.querySelectorAll('path')).toHaveLength(1);
  });

  it('renders bar list values and falls back to the empty state', () => {
    render(
      <BarList
        items={[
          { label: 'مسكنات', value: 120, display: '١٢٠٫٠٠ ج.م' },
          { label: 'فيتامينات', value: 60, display: '٦٠٫٠٠ ج.م', tone: 'warning' },
        ]}
        emptyMessage="لا توجد بيانات"
      />,
    );
    expect(screen.getByText('مسكنات')).toBeInTheDocument();
    expect(screen.getByText('١٢٠٫٠٠ ج.م')).toBeInTheDocument();

    render(<BarList items={[]} emptyMessage="لا توجد بيانات" />);
    expect(screen.getByText('لا توجد بيانات')).toBeInTheDocument();
  });

  it('renders donut segments with a legend and centre value', () => {
    render(
      <DonutChart
        segments={[
          { label: 'نقدي', value: 80, display: '٨٠٫٠٠ ج.م', color: 'hsl(var(--primary))' },
          { label: 'بطاقة', value: 20, display: '٢٠٫٠٠ ج.م', color: 'hsl(var(--success))' },
        ]}
        centerLabel="الإجمالي"
        centerValue="١٠٠"
        emptyMessage="لا توجد بيانات"
      />,
    );

    expect(screen.getByText('نقدي')).toBeInTheDocument();
    expect(screen.getByText('بطاقة')).toBeInTheDocument();
    expect(screen.getByText('١٠٠')).toBeInTheDocument();
    expect(screen.getByText('الإجمالي')).toBeInTheDocument();
  });
});
