import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';
import { formatNumber } from '../../lib/format';
import { cn } from '../../lib/utils';

export type KpiTone = 'default' | 'warning' | 'destructive' | 'success';

interface KpiCardProps {
  title: string;
  /** Pre-formatted value (`—` while loading). */
  value: string;
  icon: LucideIcon;
  tone?: KpiTone;
  /** Small line under the value (comparison period, sub-counts…). */
  hint?: string;
  /** Period-over-period change in percent; `null`/omitted renders no badge. */
  delta?: number | null;
  /** Tooltip for the delta badge (normally "vs previous period"). */
  deltaTitle?: string;
  /** Locale for number formatting (defaults to the app's Arabic locale). */
  locale?: string;
}

const TONE_CLASSES: Record<KpiTone, string> = {
  default: 'text-primary bg-primary/10',
  warning: 'text-warning bg-warning/10',
  destructive: 'text-destructive bg-destructive/10',
  success: 'text-success bg-success/10',
};

/**
 * KPI summary card — same visual language as the original dashboard stat
 * cards, extended with an optional period-comparison badge and hint line.
 */
export function KpiCard({
  title,
  value,
  icon: Icon,
  tone = 'default',
  hint,
  delta,
  deltaTitle,
  locale = 'ar-EG',
}: KpiCardProps): ReactElement {
  const hasDelta = delta !== undefined && delta !== null && Number.isFinite(delta);

  return (
    <Card className="h-full">
      <CardContent className="flex items-start gap-4 p-4">
        <span
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
            TONE_CLASSES[tone],
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs text-muted-foreground" title={title}>
              {title}
            </p>
            {hasDelta ? (
              <Badge
                variant={delta >= 0 ? 'success' : 'destructive'}
                className="shrink-0 gap-0.5 px-1.5"
                title={deltaTitle}
              >
                {delta >= 0 ? (
                  <ArrowUpRight className="h-3 w-3" />
                ) : (
                  <ArrowDownRight className="h-3 w-3" />
                )}
                <span className="numeric">{formatNumber(Math.abs(delta), locale)}%</span>
              </Badge>
            ) : null}
          </div>
          <p className="numeric mt-0.5 text-xl font-bold">{value}</p>
          {hint ? (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={hint}>
              {hint}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
