import { useMemo, useState } from 'react';
import {
  Banknote,
  BarChart3,
  Boxes,
  Calculator,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Coins,
  DatabaseBackup,
  History,
  Layers,
  LayoutGrid,
  ListChecks,
  PenLine,
  Pill,
  Receipt,
  Search,
  SearchX,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  Truck,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { hasPermission, PERMISSIONS, ROLES, type Role } from '@pharmacy/shared';
import { useI18n } from '../i18n/useI18n';
import { KpiCard } from '../components/dashboard/KpiCard';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { formatNumber } from '../lib/format';
import { cn } from '../lib/utils';
import {
  ACTION_LABEL_KEYS,
  MODULE_LABEL_KEYS,
  PERMISSION_GROUPS,
  ROLE_LABEL_KEYS,
} from '../lib/permissions';

/** Icon per permission module (unknown modules fall back to `Boxes`). */
const MODULE_ICONS: Partial<Record<string, LucideIcon>> = {
  products: Pill,
  inventory: Boxes,
  batches: Layers,
  suppliers: Truck,
  purchases: ShoppingCart,
  sales: Receipt,
  cost: Coins,
  reports: BarChart3,
  expenses: Wallet,
  register: Calculator,
  cashdrawer: Banknote,
  users: Users,
  settings: Settings,
  audit: History,
  backup: DatabaseBackup,
};

/** Role badges shown per permission before collapsing into a “+N” badge. */
const MAX_ROLE_BADGES = 4;

export function PermissionsPage() {
  const { t, locale, tag } = useI18n();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all');
  const [expandedModules, setExpandedModules] = useState<Set<string>>(
    new Set(PERMISSION_GROUPS.map(group => group.module)),
  );

  const query = search.trim().toLowerCase();

  const moduleLabel = (module: string): string => {
    const key = MODULE_LABEL_KEYS[module];
    return key ? t(key) : module;
  };

  const actionLabel = (permission: string): string => {
    const action = permission.split(':')[1] ?? permission;
    const key = ACTION_LABEL_KEYS[action];
    return key ? t(key) : action;
  };

  // Modules with the permissions that survive the current search/role filter.
  const visibleGroups = useMemo(() => {
    return PERMISSION_GROUPS.map(({ module, permissions }) => {
      const moduleMatches =
        !query ||
        module.toLowerCase().includes(query) ||
        moduleLabel(module).toLowerCase().includes(query);

      const visible = permissions.filter(permission => {
        if (roleFilter !== 'all' && !hasPermission(roleFilter, permission)) return false;
        if (!query) return true;
        return (
          moduleMatches ||
          permission.toLowerCase().includes(query) ||
          actionLabel(permission).toLowerCase().includes(query)
        );
      });

      return { module, permissions: visible };
    }).filter(group => group.permissions.length > 0);
    // `moduleLabel`/`actionLabel` only depend on the dictionary, which follows `locale`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, roleFilter, locale]);

  const visibleCount = visibleGroups.reduce((sum, group) => sum + group.permissions.length, 0);
  const writeCount = PERMISSIONS.filter(permission => permission.endsWith(':write')).length;
  const deleteCount = PERMISSIONS.filter(permission => permission.endsWith(':delete')).length;
  const roleSeparator = locale === 'ar' ? '، ' : ', ';

  const toggleModule = (module: string) => {
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(module)) next.delete(module);
      else next.add(module);
      return next;
    });
  };

  // While searching, keep every matching module open so results are never hidden.
  const isExpanded = (module: string) => (query ? true : expandedModules.has(module));

  const clearFilters = () => {
    setSearch('');
    setRoleFilter('all');
  };

  return (
    <div className="space-y-6" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('permissions.title')}</h1>
          <p className="text-muted-foreground text-sm">{t('permissions.description')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setExpandedModules(new Set())}>
            <ChevronsDownUp className="h-4 w-4" /> {t('common.collapseAll')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpandedModules(new Set(PERMISSION_GROUPS.map(group => group.module)))}
          >
            <ChevronsUpDown className="h-4 w-4" /> {t('common.expandAll')}
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={t('permissions.totalPermissions')}
          value={formatNumber(PERMISSIONS.length, tag)}
          icon={ListChecks}
        />
        <KpiCard
          title={t('permissions.totalModules')}
          value={formatNumber(PERMISSION_GROUPS.length, tag)}
          icon={LayoutGrid}
          tone="success"
        />
        <KpiCard
          title={t('permissions.writePermissions')}
          value={formatNumber(writeCount, tag)}
          icon={PenLine}
          tone="warning"
        />
        <KpiCard
          title={t('permissions.deletePermissions')}
          value={formatNumber(deleteCount, tag)}
          icon={Trash2}
          tone="destructive"
        />
      </div>

      {/* Search + role filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('common.searchPermissions')}
            value={search}
            onChange={event => setSearch(event.target.value)}
            className="ps-9 pe-9"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label={t('common.clear')}
              className="focus-ring absolute end-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <div className="w-full sm:w-56">
          <Select value={roleFilter} onValueChange={value => setRoleFilter(value as 'all' | Role)}>
            <Select.Trigger aria-label={t('permissions.roleFilter')}>
              <Select.Value placeholder={t('common.allRoles')} />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="all">{t('common.allRoles')}</Select.Item>
              {ROLES.map(role => (
                <Select.Item key={role} value={role}>
                  {t(ROLE_LABEL_KEYS[role])}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
      </div>

      {/* Active role filter */}
      {roleFilter !== 'all' ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <p className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
            <span>{t('permissions.showingForRole', { role: t(ROLE_LABEL_KEYS[roleFilter]) })}</span>
            <Badge className="numeric">{formatNumber(visibleCount, tag)}</Badge>
          </p>
          <Button variant="ghost" size="sm" onClick={() => setRoleFilter('all')}>
            <X className="h-3.5 w-3.5" /> {t('permissions.clearFilters')}
          </Button>
        </div>
      ) : null}

      {/* Modules */}
      {visibleGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <SearchX className="h-6 w-6" />
          </span>
          <p className="text-base font-medium">{t('permissions.noResults')}</p>
          <p className="text-sm text-muted-foreground">{t('permissions.noResultsDesc')}</p>
          <Button variant="outline" size="sm" onClick={clearFilters}>
            <X className="h-3.5 w-3.5" /> {t('permissions.clearFilters')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleGroups.map(({ module, permissions }) => {
            const Icon = MODULE_ICONS[module] ?? Boxes;
            const expanded = isExpanded(module);

            return (
              <Card key={module} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleModule(module)}
                  aria-expanded={expanded}
                  className="focus-ring flex w-full cursor-pointer items-center gap-3 p-4 text-start transition-colors hover:bg-muted/40"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{moduleLabel(module)}</span>
                      <Badge variant="secondary" className="numeric">
                        {t('permissions.count', { count: formatNumber(permissions.length, tag) })}
                      </Badge>
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                      {module}
                    </span>
                  </span>
                  {expanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : locale === 'ar' ? (
                    <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>

                {expanded ? (
                  <div className="border-t border-border">
                    {permissions.map((permission, index) => {
                      const granted = ROLES.filter(role => hasPermission(role, permission));
                      const grantedLabels = granted
                        .map(role => t(ROLE_LABEL_KEYS[role]))
                        .join(roleSeparator);

                      return (
                        <div
                          key={permission}
                          className={cn(
                            'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/30',
                            index > 0 && 'border-t border-border/60',
                          )}
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{actionLabel(permission)}</p>
                            <p className="font-mono text-xs text-muted-foreground">{permission}</p>
                          </div>
                          <div
                            className="flex flex-wrap items-center gap-1.5"
                            title={t('permissions.grantedTo', { roles: grantedLabels })}
                          >
                            {granted.slice(0, MAX_ROLE_BADGES).map(role => (
                              <Badge key={role} variant="secondary" className="px-1.5 text-[11px]">
                                {t(ROLE_LABEL_KEYS[role])}
                              </Badge>
                            ))}
                            {granted.length > MAX_ROLE_BADGES ? (
                              <Badge variant="outline" className="numeric px-1.5 text-[11px]">
                                +{formatNumber(granted.length - MAX_ROLE_BADGES, tag)}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
