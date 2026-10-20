import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  Boxes,
  CalendarClock,
  Check,
  CircleCheck,
  LogOut,
  Monitor,
  Moon,
  PackageX,
  Pill,
  Settings,
  Sun,
  User,
} from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { api } from '../../lib/api';
import { formatDate, formatNumber } from '../../lib/format';
import { useI18n } from '../../i18n/useI18n';
import { useAuthStore } from '../../store/auth';
import { THEME_MODES, useUiStore, type ThemeMode } from '../../store/ui';
import { useNotificationsStore } from '../../store/notifications';
import { useDismiss } from '../../hooks/useDismiss';
import type { TranslationKey } from '../../i18n/dictionaries';
import type { PageKey } from './AppShell';

const PHARMACY_NAME = 'صيدلية';

/** How many notifications the dropdown renders before deferring to the list. */
const MAX_VISIBLE = 25;

type NotificationKind = 'expired' | 'nearExpiry' | 'lowStock';

interface HeaderNotification {
  id: string;
  kind: NotificationKind;
  message: string;
  /** Secondary line: SKU, batch/lot and expiry — or stock vs minimum. */
  detail: string;
  /** Where clicking the notification takes the user. */
  page: PageKey;
}

const KIND_ICONS = {
  expired: PackageX,
  nearExpiry: CalendarClock,
  lowStock: AlertTriangle,
} as const;

const KIND_STYLES: Record<NotificationKind, string> = {
  expired: 'bg-destructive/10 text-destructive',
  nearExpiry: 'bg-warning/10 text-warning',
  lowStock: 'bg-warning/10 text-warning',
};

const THEME_ICONS: Record<ThemeMode, typeof Monitor> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

const THEME_LABEL_KEYS: Record<ThemeMode, TranslationKey> = {
  system: 'pos.header.themeSystem',
  light: 'pos.header.themeLight',
  dark: 'pos.header.themeDark',
};

interface AppHeaderProps {
  page: PageKey;
  title: string;
  onNavigate: (page: PageKey) => void;
}

/**
 * Application-wide header: pharmacy brand, shift badge, page title + clock,
 * the notification centre (unread state persisted locally, every notification
 * navigates to the screen that fixes it), signed-in user, appearance menu
 * (system/light/dark), settings/logout and the locale toggle. Rendered by
 * {@link AppShell} on every page, including the POS.
 */
export function AppHeader({ page, title, onNavigate }: AppHeaderProps): ReactElement {
  const { t, locale, tag, toggleLocale } = useI18n();
  const { user, logout } = useAuthStore();
  const themeMode = useUiStore((state) => state.themeMode);
  const setThemeMode = useUiStore((state) => state.setThemeMode);
  const readIds = useNotificationsStore((state) => state.readIds);
  const markRead = useNotificationsStore((state) => state.markRead);
  const markManyRead = useNotificationsStore((state) => state.markManyRead);
  const prune = useNotificationsStore((state) => state.prune);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [shiftStatus] = useState<'open' | 'closed'>('open');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);

  const notificationsRef = useDismiss<HTMLDivElement>(notificationsOpen, () =>
    setNotificationsOpen(false),
  );
  const themeRef = useDismiss<HTMLDivElement>(themeOpen, () => setThemeOpen(false));

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const alerts = useQuery({
    queryKey: ['inventory-alerts'],
    queryFn: () => api.inventory.alerts(),
    refetchInterval: 60_000,
    retry: false,
  });

  const notifications = useMemo<HeaderNotification[]>(() => {
    const data = alerts.data;
    if (!data) return [];
    const productName = (nameAr: string, nameEn: string | null): string =>
      locale === 'ar' ? nameAr : nameEn ?? nameAr;

    const expired = [...data.expired]
      .sort((a, b) => a.daysToExpiry - b.daysToExpiry)
      .map((batch) => ({
        id: `expired-${batch.batchId}`,
        kind: 'expired' as const,
        message: t('pos.notifications.expired', {
          name: productName(batch.productNameAr, batch.productNameEn),
        }),
        detail: `${batch.sku} • ${batch.lotNumber} • ${formatDate(batch.expiryDate, tag)}`,
        page: 'inventory' as const,
      }));

    const nearExpiry = [...data.nearExpiry]
      .sort((a, b) => a.daysToExpiry - b.daysToExpiry)
      .map((batch) => ({
        id: `near-${batch.batchId}`,
        kind: 'nearExpiry' as const,
        message: t('pos.notifications.expiring', {
          name: productName(batch.productNameAr, batch.productNameEn),
          days: batch.daysToExpiry,
        }),
        detail: `${batch.sku} • ${batch.lotNumber} • ${formatDate(batch.expiryDate, tag)}`,
        page: 'inventory' as const,
      }));

    const lowStock = [...data.lowStock]
      .sort((a, b) => a.totalQuantity - b.totalQuantity)
      .map((level) => ({
        id: `low-${level.productId}`,
        kind: 'lowStock' as const,
        message: t('pos.notifications.lowStock', {
          name: productName(level.nameAr, level.nameEn),
          stock: level.totalQuantity,
        }),
        detail: `${level.sku} • ${t('pos.header.stockShort', {
          stock: formatNumber(level.totalQuantity, tag),
          min: formatNumber(level.minStock, tag),
        })}`,
        page: 'inventory' as const,
      }));

    return [...expired, ...nearExpiry, ...lowStock];
  }, [alerts.data, t, locale, tag]);

  // Forget read flags for alerts that are gone (resolved / expired-removed),
  // so the persisted list cannot grow forever.
  useEffect(() => {
    if (!alerts.data) return;
    prune(notifications.map((notification) => notification.id));
  }, [alerts.data, notifications, prune]);

  const readSet = useMemo(() => new Set(readIds), [readIds]);
  const unreadCount = useMemo(
    () => notifications.filter((notification) => !readSet.has(notification.id)).length,
    [notifications, readSet],
  );
  const visibleNotifications = notifications.slice(0, MAX_VISIBLE);
  const hiddenCount = notifications.length - visibleNotifications.length;
  const notificationIds = useMemo(
    () => notifications.map((notification) => notification.id),
    [notifications],
  );

  const openNotification = (notification: HeaderNotification): void => {
    markRead(notification.id);
    setNotificationsOpen(false);
    onNavigate(notification.page);
  };

  const ThemeIcon = THEME_ICONS[themeMode];
  const cashierName = user?.fullName || user?.username || '';
  const date = currentTime.toLocaleDateString(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const time = currentTime.toLocaleTimeString(locale);

  return (
    <header className="relative z-30 flex items-center justify-between gap-4 border-b border-border bg-card px-6 py-3">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Pill className="h-5 w-5" />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-bold">{PHARMACY_NAME}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {t('pos.header.pharmacyTagline')}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold',
            shiftStatus === 'open'
              ? 'bg-success/10 text-success'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {shiftStatus === 'open' ? t('pos.header.shiftOpen') : t('pos.header.shiftClosed')}
        </span>
      </div>

      <div className="flex flex-col items-center leading-tight">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="numeric text-[11px] text-muted-foreground">
          {date} • {time}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {/* Notification centre ------------------------------------------- */}
        <div className="relative" ref={notificationsRef}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('pos.header.notifications')}
            aria-expanded={notificationsOpen}
            onClick={() => {
              setThemeOpen(false);
              setNotificationsOpen((open) => !open);
            }}
          >
            <Bell className={cn('h-4 w-4', unreadCount > 0 && 'text-warning')} />
            {unreadCount > 0 && (
              <span className="numeric absolute end-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </Button>

          {notificationsOpen && (
            <div className="absolute end-0 top-full z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-lg border border-border bg-card shadow-lg">
              <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold">{t('pos.header.notifications')}</h4>
                  {unreadCount > 0 && (
                    <span className="numeric rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold leading-4 text-destructive-foreground">
                      {unreadCount}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={unreadCount === 0}
                  onClick={() => markManyRead(notificationIds)}
                >
                  {t('pos.header.markAllRead')}
                </Button>
              </div>

              {visibleNotifications.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <CircleCheck className="h-6 w-6 text-success" />
                  <p className="text-xs text-muted-foreground">
                    {t('pos.header.noNotifications')}
                  </p>
                </div>
              ) : (
                <ul className="max-h-80 overflow-y-auto p-1.5">
                  {visibleNotifications.map((notification) => {
                    const unread = !readSet.has(notification.id);
                    const Icon = KIND_ICONS[notification.kind];
                    return (
                      <li
                        key={notification.id}
                        className="flex items-stretch rounded-md transition-colors hover:bg-muted/60"
                      >
                        <button
                          type="button"
                          onClick={() => openNotification(notification)}
                          className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md px-2 py-2 text-start focus-ring"
                        >
                          <span
                            className={cn(
                              'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                              KIND_STYLES[notification.kind],
                            )}
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                'block truncate text-xs',
                                unread ? 'font-semibold' : 'text-muted-foreground',
                              )}
                            >
                              {notification.message}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                              {notification.detail}
                            </span>
                          </span>
                          {unread && (
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          )}
                        </button>
                        {unread && (
                          <span className="flex items-center pe-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground"
                              title={t('pos.header.markAsRead')}
                              aria-label={t('pos.header.markAsRead')}
                              onClick={() => markRead(notification.id)}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="border-t border-border p-1.5">
                {hiddenCount > 0 && (
                  <p className="px-2 py-1 text-center text-[10px] text-muted-foreground">
                    {t('pos.header.moreAlerts', { count: hiddenCount })}
                  </p>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-center text-xs"
                  onClick={() => {
                    setNotificationsOpen(false);
                    onNavigate('inventory');
                  }}
                >
                  <Boxes className="h-3.5 w-3.5" />
                  {t('pos.header.viewInventory')}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Appearance (system / light / dark) ---------------------------- */}
        <div className="relative" ref={themeRef}>
          <Button
            variant="ghost"
            size="icon"
            title={t('pos.header.theme')}
            aria-label={t('pos.header.theme')}
            aria-expanded={themeOpen}
            onClick={() => {
              setNotificationsOpen(false);
              setThemeOpen((open) => !open);
            }}
          >
            <ThemeIcon className="h-4 w-4" />
          </Button>

          {themeOpen && (
            <div className="absolute end-0 top-full z-50 mt-2 w-44 rounded-lg border border-border bg-card p-1.5 shadow-lg">
              {THEME_MODES.map((mode) => {
                const Icon = THEME_ICONS[mode];
                const active = mode === themeMode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setThemeMode(mode);
                      setThemeOpen(false);
                    }}
                    aria-pressed={active}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors focus-ring',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{t(THEME_LABEL_KEYS[mode])}</span>
                    {active && <Check className="ms-auto h-3.5 w-3.5" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <span className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground">
          <User className="h-3.5 w-3.5" />
          {cashierName}
        </span>

        <Button
          variant="ghost"
          size="icon"
          title={t('pos.header.settings')}
          aria-label={t('pos.header.settings')}
          onClick={() => onNavigate('settings')}
          disabled={page === 'settings'}
        >
          <Settings className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          title={t('pos.header.logout')}
          aria-label={t('pos.header.logout')}
          onClick={() => void logout()}
        >
          <LogOut className="h-4 w-4 text-destructive" />
        </Button>

        {/* The visible text is the target language name, which is also the
            accessible name — an aria-label here would override it. */}
        <Button variant="ghost" size="sm" onClick={toggleLocale} title={t('settings.language')}>
          {locale === 'ar' ? 'English' : 'العربية'}
        </Button>
      </div>
    </header>
  );
}
