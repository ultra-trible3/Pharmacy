import { useState, type MouseEvent, type ReactElement } from 'react';
import { EmptyState } from '../ui/badge';
import { cn } from '../../lib/utils';

/**
 * Small dependency-free chart primitives used by the dashboard.
 *
 * The project ships no charting library (offline-first install), so these
 * render plain SVG/HTML styled with the existing theme tokens
 * (`hsl(var(--primary))` etc.), staying crisp at any width:
 *  - strokes use `vector-effect: non-scaling-stroke` so the stretched viewBox
 *    never distorts line weights or dots;
 *  - text (axis labels, tooltips, legends) is rendered as HTML next to the
 *    SVG, so it scales with the app font instead of the viewBox.
 */

export interface TrendSeries {
  name: string;
  /** Any CSS color; theme tokens keep charts light/dark aware. */
  color: string;
  values: number[];
  dashed?: boolean;
  area?: boolean;
}

interface TrendChartProps {
  /** One pre-formatted label per data index (e.g. `16/10/2026`). */
  labels: string[];
  series: TrendSeries[];
  height?: number;
  /** Tooltip value formatter (normally money or units). */
  formatValue?: (value: number) => string;
  /** Y-axis tick formatter (normally a compact number). */
  formatAxis?: (value: number) => string;
}

/** Rounds a maximum up to a readable 1/1.5/2/3/5/10 × 10ⁿ scale. */
function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const fraction = value / base;
  const step = [1, 1.5, 2, 3, 5, 10].find((candidate) => fraction <= candidate) ?? 10;
  return step * base;
}

export function TrendChart({
  labels,
  series,
  height = 200,
  formatValue,
  formatAxis,
}: TrendChartProps): ReactElement {
  const [hover, setHover] = useState<number | null>(null);
  const count = labels.length;

  const values = series.flatMap((entry) => entry.values);
  const max = niceMax(Math.max(0, ...values));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => max * ratio);
  const xAt = (index: number): number => (count <= 1 ? 50 : (index / (count - 1)) * 100);
  const yAt = (value: number): number =>
    100 - Math.min(100, Math.max(0, (value / max) * 100));

  // At most ~7 x labels, always keeping the first and last date visible.
  const labelStep = Math.max(1, Math.ceil(count / 7));
  const labelIndices: number[] = [];
  for (let index = 0; index < count; index += labelStep) labelIndices.push(index);
  const lastShown = labelIndices[labelIndices.length - 1];
  if (count > 0 && lastShown !== count - 1) {
    if (count - 1 - (lastShown as number) >= labelStep / 2) labelIndices.push(count - 1);
    else labelIndices[labelIndices.length - 1] = count - 1;
  }

  const onMove = (event: MouseEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || count === 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    setHover(Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1)))));
  };

  const axis = formatAxis ?? ((value: number) => String(Math.round(value)));
  const tooltip = formatValue ?? ((value: number) => String(value));

  return (
    <div className="relative select-none" dir="ltr">
      <div className="pl-12">
        <div
          className="relative"
          style={{ height }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="h-full w-full"
            aria-hidden="true"
          >
            {ticks.map((tick, index) => (
              <line
                key={`grid-${index}`}
                x1={0}
                x2={100}
                y1={yAt(tick)}
                y2={yAt(tick)}
                stroke="hsl(var(--border))"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {series
              .filter((entry) => entry.area && count > 0)
              .map((entry) => (
                <path
                  key={`area-${entry.name}`}
                  d={`M${xAt(0)},100 ${entry.values
                    .map((value, index) => `L${xAt(index)},${yAt(value)}`)
                    .join(' ')} L${xAt(count - 1)},100 Z`}
                  fill={entry.color}
                  opacity={0.08}
                />
              ))}
            {series.map((entry) => (
              <polyline
                key={entry.name}
                points={entry.values.map((value, index) => `${xAt(index)},${yAt(value)}`).join(' ')}
                fill="none"
                stroke={entry.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={entry.dashed ? '4 4' : undefined}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>

          {hover !== null ? (
            <>
              <div
                className="pointer-events-none absolute inset-y-0 border-l border-dashed border-muted-foreground/50"
                style={{ left: `${xAt(hover)}%` }}
              />
              {series.map((entry) => (
                <span
                  key={`dot-${entry.name}`}
                  className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card"
                  style={{
                    left: `${xAt(hover)}%`,
                    top: `${yAt(entry.values[hover] ?? 0)}%`,
                    backgroundColor: entry.color,
                  }}
                />
              ))}
              <div
                dir="auto"
                className="pointer-events-none absolute top-1 z-10 min-w-36 -translate-x-1/2 rounded-md border border-border bg-card p-2 text-xs shadow-md"
                style={{ left: `${Math.min(80, Math.max(20, xAt(hover)))}%` }}
              >
                <p className="numeric mb-1 font-semibold">{labels[hover]}</p>
                {series.map((entry) => (
                  <p key={`tip-${entry.name}`} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: entry.color }}
                      />
                      {entry.name}
                    </span>
                    <span className="numeric font-semibold">{tooltip(entry.values[hover] ?? 0)}</span>
                  </p>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="relative mt-1 h-4">
          {labelIndices.map((index) => (
            <span
              key={index}
              className="numeric absolute -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground"
              style={{ left: `${xAt(index)}%` }}
            >
              {labels[index]}
            </span>
          ))}
        </div>
      </div>

      <div
        className="absolute left-0 top-0 flex w-11 flex-col justify-between text-[10px]"
        style={{ height }}
      >
        {[...ticks].reverse().map((tick, index) => (
          <span key={`ytick-${index}`} className="numeric text-muted-foreground">
            {axis(tick)}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface DonutSegment {
  label: string;
  value: number;
  display: string;
  color: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  centerLabel?: string;
  centerValue?: string;
  size?: number;
  emptyMessage: string;
}

export function DonutChart({
  segments,
  centerLabel,
  centerValue,
  size = 148,
  emptyMessage,
}: DonutChartProps): ReactElement {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (segments.length === 0 || total <= 0) {
    return <EmptyState message={emptyMessage} />;
  }

  // r = 15.9155 makes the circumference exactly 100, so percentages map 1:1
  // onto stroke-dasharray. Each arc starts where the previous one ended.
  const CIRCUMFERENCE_RADIUS = 15.9155;
  let consumed = 0;
  const arcs = segments.map((segment) => {
    const percent = (segment.value / total) * 100;
    const arc = { ...segment, percent, offset: 25 - consumed };
    consumed += percent;
    return arc;
  });

  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 42 42" width={size} height={size} className="shrink-0" role="img">
        <circle
          cx={21}
          cy={21}
          r={CIRCUMFERENCE_RADIUS}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={5.5}
        />
        {arcs.map((arc) => (
          <circle
            key={arc.label}
            cx={21}
            cy={21}
            r={CIRCUMFERENCE_RADIUS}
            fill="none"
            stroke={arc.color}
            strokeWidth={5.5}
            strokeDasharray={`${arc.percent} ${100 - arc.percent}`}
            strokeDashoffset={arc.offset}
          >
            <title>{`${arc.label}: ${arc.display}`}</title>
          </circle>
        ))}
        {centerValue ? (
          <text
            x={21}
            y={20}
            textAnchor="middle"
            fontSize={3.6}
            fontWeight={700}
            fill="hsl(var(--foreground))"
          >
            {centerValue}
          </text>
        ) : null}
        {centerLabel ? (
          <text x={21} y={25.3} textAnchor="middle" fontSize={2.9} fill="hsl(var(--muted-foreground))">
            {centerLabel}
          </text>
        ) : null}
      </svg>
      <ul className="min-w-0 flex-1 space-y-2">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center gap-2 text-sm">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: segment.color }}
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{segment.label}</span>
            <span className="numeric shrink-0 font-semibold">{segment.display}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface BarListItem {
  label: string;
  value: number;
  display: string;
  sublabel?: string;
  tone?: 'primary' | 'success' | 'warning' | 'destructive' | 'muted';
}

interface BarListProps {
  items: BarListItem[];
  emptyMessage: string;
}

const BAR_TONES: Record<NonNullable<BarListItem['tone']>, string> = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  muted: 'bg-muted-foreground/60',
};

/** Horizontal bar list — bars fill from the logical start, so they mirror correctly in RTL. */
export function BarList({ items, emptyMessage }: BarListProps): ReactElement {
  if (items.length === 0) return <EmptyState message={emptyMessage} />;
  const max = Math.max(1, ...items.map((item) => item.value));

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 flex-1 truncate text-sm" title={item.label}>
              {item.label}
            </p>
            <span className="numeric shrink-0 text-sm font-semibold">{item.display}</span>
          </div>
          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', BAR_TONES[item.tone ?? 'primary'])}
              style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
            />
          </div>
          {item.sublabel ? (
            <p className="numeric text-[11px] text-muted-foreground">{item.sublabel}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Inline legend used next to chart card titles. */
export function ChartLegend({
  items,
}: {
  items: Array<{ name: string; color: string; dashed?: boolean }>;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {items.map((item) => (
        <span key={item.name} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={cn('h-0.5 w-4 rounded-full', item.dashed && 'opacity-60')}
            style={{ backgroundColor: item.color }}
          />
          {item.name}
        </span>
      ))}
    </div>
  );
}
