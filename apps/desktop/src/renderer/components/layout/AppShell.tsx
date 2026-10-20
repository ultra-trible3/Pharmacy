import {
  Banknote,
  BellRing,
  Boxes,
  Box,
  CalendarClock,
  ChevronDown,
  ClipboardList,
  FileText,
  FolderTree,
  HandCoins,
  History,
  Key,
  LayoutDashboard,
  LogOut,
  Package,
  PackagePlus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pill,
  Receipt,
  Settings,
  Shield,
  Truck,
  Undo2,
  Users,
  Warehouse,
  WifiOff,
  Wifi,
} from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABELS_AR, ROLE_LABELS_EN } from '@pharmacy/shared';
import type { Role } from '@pharmacy/shared';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { api } from '../../lib/api';
import { useI18n } from '../../i18n/useI18n';
import { useAuthStore } from '../../store/auth';
import type { TranslationKey } from '../../i18n/dictionaries';
import { AppHeader } from './AppHeader';

export type PageKey =
  | 'dashboard'
  | 'pos'
  | 'products'
  | 'inventory'
  | 'warehouses'
  | 'alerts'
  | 'suppliers'
  | 'purchases'
  | 'categories'
  | 'customers'
  | 'debts'
  | 'sales'
  | 'invoices'
  | 'returns'
  | 'reports'
  | 'expenses'
  | 'shifts'
  | 'audit'
  | 'settings'
  | 'users'
  | 'roles'
  | 'permissions';

export type NavGroupKey = 'management' | 'inventory' | 'sales' | 'system';

interface NavItem {
  key: PageKey;
  labelKey: TranslationKey;
  icon: typeof LayoutDashboard;
  permission?: string;
}

interface NavGroup {
  key: NavGroupKey;
  labelKey: TranslationKey;
  items: NavItem[];
}

/** The sidebar arrangement: four groups, each independently collapsible. */
export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'management',
    labelKey: 'nav.management',
    items: [
      { key: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
      { key: 'pos', labelKey: 'nav.pos', icon: Box, permission: 'products:read' },
    ],
  },
  {
    key: 'inventory',
    labelKey: 'nav.groupInventory',
    items: [
      { key: 'products', labelKey: 'nav.products', icon: Pill, permission: 'products:read' },
      { key: 'inventory', labelKey: 'nav.inventory', icon: Boxes, permission: 'inventory:read' },
      { key: 'warehouses', labelKey: 'nav.warehouses', icon: Warehouse, permission: 'inventory:read' },
      { key: 'alerts', labelKey: 'nav.alerts', icon: BellRing, permission: 'inventory:read' },
      { key: 'suppliers', labelKey: 'nav.suppliers', icon: Truck, permission: 'suppliers:read' },
      { key: 'purchases', labelKey: 'nav.purchases', icon: PackagePlus, permission: 'purchases:read' },
      { key: 'categories', labelKey: 'nav.categories', icon: FolderTree, permission: 'products:read' },
    ],
  },
  {
    key: 'sales',
    labelKey: 'nav.groupSales',
    items: [
      { key: 'customers', labelKey: 'nav.customers', icon: Users, permission: 'sales:read' },
      { key: 'debts', labelKey: 'nav.debts', icon: HandCoins, permission: 'sales:read' },
      { key: 'sales', labelKey: 'nav.sales', icon: Receipt, permission: 'sales:read' },
      { key: 'invoices', labelKey: 'nav.invoices', icon: FileText, permission: 'sales:read' },
      { key: 'returns', labelKey: 'nav.returns', icon: Undo2, permission: 'sales:read' },
    ],
  },
  {
    key: 'system',
    labelKey: 'nav.groupSystem',
    items: [
      { key: 'reports', labelKey: 'nav.reports', icon: ClipboardList, permission: 'reports:operational' },
      { key: 'expenses', labelKey: 'nav.expenses', icon: Banknote, permission: 'expenses:read' },
      { key: 'shifts', labelKey: 'nav.shifts', icon: CalendarClock, permission: 'cashdrawer:read' },
      { key: 'audit', labelKey: 'nav.audit', icon: History, permission: 'audit:read' },
      { key: 'users', labelKey: 'nav.users', icon: Users, permission: 'users:manage' },
      { key: 'roles', labelKey: 'nav.roles', icon: Shield, permission: 'users:manage' },
      { key: 'permissions', labelKey: 'nav.permissions', icon: Key, permission: 'users:manage' },
      { key: 'settings', labelKey: 'nav.settings', icon: Settings },
    ],
  },
];

/** Flat PageKey -> title lookup used by the global header. */
export const PAGE_TITLE_KEYS: Record<PageKey, TranslationKey> = Object.fromEntries(
  NAV_GROUPS.flatMap((group) => group.items.map((item) => [item.key, item.labelKey])),
) as Record<PageKey, TranslationKey>;

const COLLAPSED_STORAGE_KEY = 'pharmacy.nav.collapsed';

function readCollapsedGroups(): string[] {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

function persistCollapsedGroups(groups: string[]): void {
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(groups));
  } catch {
    // ignore storage failures (private mode / locked profile)
  }
}

const SIDEBAR_STORAGE_KEY = 'pharmacy.nav.sidebarOpen';

/** The whole sidebar defaults to open; `'0'` is the persisted closed state. */
function readSidebarOpen(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

function persistSidebarOpen(open: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, open ? '1' : '0');
  } catch {
    // ignore storage failures (private mode / locked profile)
  }
}

export function AppShell({
  page,
  onNavigate,
  children,
}: {
  page: PageKey;
  onNavigate: (page: PageKey) => void;
  children: ReactNode;
}): ReactElement {
  const { t, locale, dir } = useI18n();
  const { user, can, logout } = useAuthStore();
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(() => readCollapsedGroups());
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => readSidebarOpen());

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health(),
    refetchInterval: 30_000,
    retry: false,
  });

  // Keep the group containing the active page expanded when NAVIGATING (e.g.
  // after a dashboard shortcut lands inside a collapsed group), but never
  // fight the user's manual collapse of the section they are looking at:
  // this runs on page changes and on mount, not on group toggles.
  // A real page change also re-opens a collapsed sidebar — picking a
  // destination reveals it no matter where it was picked from (icon rail,
  // dashboard shortcut, header). The first run is the shell's mount, not a
  // navigation, so a persisted collapsed rail survives a restart.
  const lastPageRef = useRef<PageKey | null>(null);
  useEffect(() => {
    if (lastPageRef.current === page) return;
    const isMount = lastPageRef.current === null;
    lastPageRef.current = page;
    const group = NAV_GROUPS.find((candidate) =>
      candidate.items.some((item) => item.key === page),
    );
    if (group) {
      setCollapsedGroups((previous) => {
        if (!previous.includes(group.key)) return previous;
        const next = previous.filter((key) => key !== group.key);
        persistCollapsedGroups(next);
        return next;
      });
    }
    if (!isMount) {
      setSidebarOpen((previous) => {
        if (previous) return previous;
        persistSidebarOpen(true);
        return true;
      });
    }
  }, [page]);

  const toggleGroup = (groupKey: NavGroupKey): void => {
    setCollapsedGroups((previous) => {
      const next = previous.includes(groupKey)
        ? previous.filter((key) => key !== groupKey)
        : [...previous, groupKey];
      persistCollapsedGroups(next);
      return next;
    });
  };

  const toggleSidebar = (): void => {
    setSidebarOpen((previous) => {
      const next = !previous;
      persistSidebarOpen(next);
      return next;
    });
  };

  const online = health.data?.reachable ?? false;
  const roleLabel = user
    ? locale === 'ar'
      ? ROLE_LABELS_AR[user.role as Role]
      : ROLE_LABELS_EN[user.role as Role]
    : '';

  // The sidebar sits on the inline-start edge (right in RTL), so the toggle
  // chevron mirrors to always point at the edge being collapsed.
  const SidebarToggleIcon =
    dir === 'rtl'
      ? sidebarOpen
        ? PanelRightClose
        : PanelRightOpen
      : sidebarOpen
        ? PanelLeftClose
        : PanelLeftOpen;

  const initials = (user?.fullName ?? '')
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('');

  /**
   * Picking a destination always reveals it: a collapsed icon rail re-opens
   * and the section holding the picked page expands (even when the page does
   * not change, e.g. re-picking the current page from the rail), so browsing
   * is never a dead end — the toggle at the top still collapses it right
   * back, and sections the user collapsed stay collapsed until picked.
   */
  const navigateTo = (key: PageKey): void => {
    onNavigate(key);

    setSidebarOpen((previous) => {
      if (previous) return previous;
      persistSidebarOpen(true);
      return true;
    });

    const group = NAV_GROUPS.find((candidate) =>
      candidate.items.some((item) => item.key === key),
    );
    if (!group) return;
    setCollapsedGroups((previous) => {
      if (!previous.includes(group.key)) return previous;
      const next = previous.filter((entry) => entry !== group.key);
      persistCollapsedGroups(next);
      return next;
    });
  };

  const renderNavItem = (item: NavItem, rail: boolean): ReactElement => {
    const Icon = item.icon;
    const active = page === item.key;
    return (
      <button
        key={item.key}
        type="button"
        aria-current={active ? 'page' : undefined}
        aria-label={rail ? t(item.labelKey) : undefined}
        title={rail ? t(item.labelKey) : undefined}
        onClick={() => navigateTo(item.key)}
        className={cn(
          'focus-ring flex w-full items-center rounded-md text-sm transition-colors',
          rail ? 'justify-center py-2' : 'gap-3 px-3 py-2',
          active
            ? 'bg-primary/10 font-semibold text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        <Icon className="h-4 w-4" />
        {rail ? null : t(item.labelKey)}
      </button>
    );
  };

  return (
    <div className="flex h-full min-h-screen bg-background" dir={dir}>
      <aside
        className={cn(
          'flex shrink-0 flex-col overflow-hidden border-e border-border bg-card transition-[width] duration-200 ease-in-out',
          sidebarOpen ? 'w-60' : 'w-16',
        )}
      >
        <div
          className={cn(
            'flex items-center border-b border-border',
            sidebarOpen ? 'gap-2 px-4 py-4' : 'flex-col justify-center gap-1.5 px-2 py-3',
          )}
        >
          <Package className="h-6 w-6 shrink-0 text-primary" />
          {sidebarOpen ? (
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-bold">{t('app.title')}</p>
              <p className="truncate text-[11px] text-muted-foreground">{t('app.subtitle')}</p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? t('nav.collapseSidebar') : t('nav.expandSidebar')}
            title={sidebarOpen ? t('nav.collapseSidebar') : t('nav.expandSidebar')}
            className="focus-ring shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <SidebarToggleIcon className="h-4 w-4" />
          </button>
        </div>

        <nav
          className={cn('flex-1 overflow-y-auto', sidebarOpen ? 'space-y-1 p-2' : 'space-y-1 p-1.5')}
          aria-label={t('nav.mainNav')}
        >
          {NAV_GROUPS.map((group, index) => {
            const items = group.items.filter(
              (item) => !item.permission || can(item.permission),
            );
            if (items.length === 0) return null;

            // Rail mode: every destination stays one click away as an icon
            // (labelled via aria-label/tooltip), with hairline separators
            // standing in for the group headers.
            if (!sidebarOpen) {
              return (
                <div
                  key={group.key}
                  className={cn(
                    'space-y-0.5',
                    index > 0 && 'mt-1.5 border-t border-border pt-1.5',
                  )}
                >
                  {items.map((item) => renderNavItem(item, true))}
                </div>
              );
            }

            const collapsed = collapsedGroups.includes(group.key);
            return (
              <div key={group.key} className="pb-1">
                <button
                  type="button"
                  aria-expanded={!collapsed}
                  onClick={() => toggleGroup(group.key)}
                  className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[11px] font-bold tracking-wide text-muted-foreground transition-colors hover:text-foreground focus-ring"
                >
                  <span>{t(group.labelKey)}</span>
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 transition-transform', collapsed && '-rotate-90')}
                  />
                </button>

                {collapsed ? null : (
                  <div className="space-y-0.5">
                    {items.map((item) => renderNavItem(item, false))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className={cn('border-t border-border', sidebarOpen ? 'p-3' : 'p-2')}>
          {sidebarOpen ? (
            <>
              <div
                className={cn(
                  'mb-3 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                  online ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive',
                )}
              >
                {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                <span>{online ? t('dashboard.connected') : t('dashboard.disconnected')}</span>
                {health.data?.latencyMs !== undefined ? (
                  <span className="numeric ms-auto opacity-70">{health.data.latencyMs}ms</span>
                ) : null}
              </div>

              <div className="mb-2 px-1">
                <p className="truncate text-sm font-medium">{user?.fullName}</p>
                <p className="text-[11px] text-muted-foreground">{roleLabel}</p>
              </div>

              <Button variant="outline" size="sm" className="w-full" onClick={() => void logout()}>
                <LogOut className="h-3.5 w-3.5" />
                {t('nav.logout')}
              </Button>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <span
                title={`${online ? t('dashboard.connected') : t('dashboard.disconnected')}${
                  health.data?.latencyMs !== undefined ? ` • ${health.data.latencyMs}ms` : ''
                }`}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-md',
                  online ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive',
                )}
              >
                {online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
              </span>
              <span
                title={`${user?.fullName ?? ''} • ${roleLabel}`}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary"
              >
                {initials}
              </span>
              <Button
                variant="outline"
                size="icon"
                aria-label={t('nav.logout')}
                title={t('nav.logout')}
                onClick={() => void logout()}
              >
                <LogOut className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          page={page}
          title={t(PAGE_TITLE_KEYS[page] ?? 'app.title')}
          onNavigate={navigateTo}
        />
        <main className="min-h-0 flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
