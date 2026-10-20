import {
  Check,
  Clock,
  DatabaseBackup,
  Info,
  KeyRound,
  Languages,
  Lock,
  LogOut,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  Shield,
  ShieldCheck,
  Sun,
  UserCog,
  UserX,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useState, type KeyboardEvent, type ReactElement } from 'react';
import { type Role } from '@pharmacy/shared';
import { NAV_GROUPS, type PageKey } from '../components/layout/AppShell';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '../components/ui/card';
import { Select } from '../components/ui/select';
import { toast } from '../components/ui/toast';
import { useI18n } from '../i18n/useI18n';
import type { Locale, TranslationKey } from '../i18n/dictionaries';
import { ROLE_LABEL_KEYS } from '../lib/permissions';
import { cn } from '../lib/utils';
import { useAuthStore } from '../store/auth';
import { useUiStore, type ThemeMode } from '../store/ui';

interface SettingsPageProps {
  /** Navigates to another page of the app shell. */
  onNavigate?: (page: PageKey) => void;
}

const TAB_KEYS = ['appearance', 'security', 'administration', 'backup'] as const;
type TabKey = (typeof TAB_KEYS)[number];

const TABS: { key: TabKey; labelKey: TranslationKey; icon: LucideIcon }[] = [
  { key: 'appearance', labelKey: 'settings.appearance', icon: Palette },
  { key: 'security', labelKey: 'settings.security', icon: Lock },
  { key: 'administration', labelKey: 'settings.administration', icon: Shield },
  { key: 'backup', labelKey: 'nav.backup', icon: DatabaseBackup },
];

const THEME_OPTIONS: { mode: ThemeMode; icon: LucideIcon }[] = [
  { mode: 'light', icon: Sun },
  { mode: 'dark', icon: Moon },
  { mode: 'system', icon: Monitor },
];

const BACKUP_SCHEDULES = ['hourly', 'daily', 'weekly', 'disabled'] as const;
type BackupSchedule = (typeof BACKUP_SCHEDULES)[number];

/** Curated shell destinations offered as quick-access shortcuts. */
const QUICK_ACCESS_KEYS: PageKey[] = ['pos', 'products', 'inventory', 'sales', 'reports', 'customers'];

/** Administration hand-off cards, with the description shown on each card. */
const ADMIN_PAGE_DESCRIPTION_KEYS: Partial<Record<PageKey, TranslationKey>> = {
  users: 'settings.adminUsersDescription',
  roles: 'settings.adminRolesDescription',
  permissions: 'settings.adminPermissionsDescription',
  audit: 'settings.adminAuditDescription',
};

const ADMIN_PAGE_KEYS = Object.keys(ADMIN_PAGE_DESCRIPTION_KEYS) as PageKey[];

type NavItem = (typeof NAV_GROUPS)[number]['items'][number];

const NAV_ITEM_BY_KEY = new Map<PageKey, NavItem>(
  NAV_GROUPS.flatMap((group) => group.items).map((item) => [item.key, item]),
);

/** Shared section header: tinted icon chip, title, description and optional trailing action. */
function SectionHeader({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactElement;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

export function SettingsPage({ onNavigate }: SettingsPageProps) {
  const { t, dir, locale } = useI18n();
  const [activeTab, setActiveTab] = useState<TabKey>('appearance');

  const selectTab = (key: TabKey) => {
    setActiveTab(key);
    // Keep focus on the newly selected tab so keyboard navigation stays usable.
    document.getElementById(`settings-tab-${key}`)?.focus();
  };

  const onTabKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const forwardKey = locale === 'ar' ? 'ArrowLeft' : 'ArrowRight';
    const backwardKey = locale === 'ar' ? 'ArrowRight' : 'ArrowLeft';

    let nextIndex: number | null = null;
    if (event.key === forwardKey) nextIndex = (index + 1) % TABS.length;
    else if (event.key === backwardKey) nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = TABS[nextIndex];
    if (nextTab) selectTab(nextTab.key);
  };

  return (
    <div className="max-w-4xl space-y-6" dir={dir}>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{t('nav.settings')}</h1>
        <p className="text-sm text-muted-foreground">{t('settings.description')}</p>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label={t('nav.settings')}
        className="flex w-full flex-wrap gap-1 rounded-lg bg-muted p-1 sm:flex-nowrap"
      >
        {TABS.map((tab, index) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              id={`settings-tab-${tab.key}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`settings-panel-${tab.key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setActiveTab(tab.key)}
              onKeyDown={onTabKeyDown(index)}
              className={cn(
                'focus-ring flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <tab.icon className="h-4 w-4" />
              {t(tab.labelKey)}
            </button>
          );
        })}
      </div>

      {/* Panels */}
      <div
        role="tabpanel"
        id={`settings-panel-${activeTab}`}
        aria-labelledby={`settings-tab-${activeTab}`}
        className="focus-ring"
      >
        {activeTab === 'appearance' ? <AppearanceSettings onNavigate={onNavigate} /> : null}
        {activeTab === 'security' ? <SecuritySettings /> : null}
        {activeTab === 'administration' ? <AdministrationSettings onNavigate={onNavigate} /> : null}
        {activeTab === 'backup' ? <BackupSettings /> : null}
      </div>
    </div>
  );
}

function AppearanceSettings({ onNavigate }: SettingsPageProps) {
  const { t } = useI18n();
  const can = useAuthStore((state) => state.can);
  const themeMode = useUiStore((state) => state.themeMode);
  const setThemeMode = useUiStore((state) => state.setThemeMode);
  const locale = useUiStore((state) => state.locale);
  const setLocale = useUiStore((state) => state.setLocale);

  const quickActions = QUICK_ACCESS_KEYS.map((key) => NAV_ITEM_BY_KEY.get(key)).filter(
    (item): item is NavItem => {
      if (!item) return false;
      return !item.permission || can(item.permission);
    },
  );

  return (
    <Card className="divide-y divide-border">
      {/* Theme */}
      <section className="space-y-4 p-5">
        <SectionHeader icon={Palette} title={t('settings.theme')} description={t('settings.themeHint')} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {THEME_OPTIONS.map(({ mode, icon: Icon }) => {
            const active = themeMode === mode;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={active}
                onClick={() => setThemeMode(mode)}
                className={cn(
                  'focus-ring flex items-center gap-3 rounded-lg border p-3 text-start transition-colors',
                  active
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card hover:bg-muted/40',
                )}
              >
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                    active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {t(`settings.theme.${mode}`)}
                </span>
                {active ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
              </button>
            );
          })}
        </div>
      </section>

      {/* Language */}
      <section className="p-5">
        <SectionHeader
          icon={Languages}
          title={t('settings.language')}
          description={t('settings.languageDescription')}
          action={
            <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
              <Select.Trigger aria-label={t('settings.language')} className="w-44">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="ar">{t('settings.arabic')}</Select.Item>
                <Select.Item value="en">{t('settings.english')}</Select.Item>
              </Select.Content>
            </Select>
          }
        />
      </section>

      {/* Quick access — hidden when the role cannot open any of the destinations */}
      {quickActions.length > 0 ? (
        <section className="space-y-4 p-5">
          <SectionHeader
            icon={Zap}
            title={t('settings.quickAccess')}
            description={t('settings.quickAccessDescription')}
          />
          <div className="flex flex-wrap gap-2">
            {quickActions.map((item) => (
              <Button
                key={item.key}
                variant="outline"
                size="sm"
                onClick={() => onNavigate?.(item.key)}
              >
                <item.icon className="h-4 w-4" />
                {t(item.labelKey)}
              </Button>
            ))}
          </div>
        </section>
      ) : null}
    </Card>
  );
}

function SecuritySettings() {
  const { t } = useI18n();
  const user = useAuthStore((state) => state.user);

  const roleLabel = user ? (ROLE_LABEL_KEYS[user.role as Role] ?? user.role) : null;

  return (
    <Card className="divide-y divide-border">
      {/* Account */}
      <section className="space-y-4 p-5">
        <SectionHeader
          icon={UserCog}
          title={t('settings.account')}
          description={t('settings.accountDescription')}
        />
        {user ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {user.fullName.trim().charAt(0)}
              </span>
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{user.fullName}</p>
                <p className="text-xs text-muted-foreground">{user.username}</p>
              </div>
              {roleLabel ? (
                <Badge variant="secondary" className="gap-1">
                  <ShieldCheck className="h-3 w-3" />
                  {t(roleLabel as TranslationKey)}
                </Badge>
              ) : null}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.info(t('settings.changePasswordHint'))}
            >
              <KeyRound className="h-4 w-4" />
              {t('settings.changePassword')}
            </Button>
          </div>
        ) : null}
      </section>

      {/* Sessions */}
      <section className="p-5">
        <SectionHeader
          icon={Monitor}
          title={t('settings.sessions')}
          description={t('settings.sessionsDescription')}
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => toast.success(t('settings.sessionRevoked'))}
              >
                <UserX className="h-4 w-4" />
                {t('settings.revokeOtherSessions')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => toast.success(t('settings.sessionRevoked'))}
              >
                <LogOut className="h-4 w-4" />
                {t('settings.revokeAllSessions')}
              </Button>
            </div>
          }
        />
      </section>

      {/* Two-factor */}
      <section className="p-5">
        <SectionHeader
          icon={ShieldCheck}
          title={t('settings.twoFactor')}
          description={t('settings.twoFactorDescription')}
          action={
            <Badge variant="outline" className="gap-1">
              <Clock className="h-3 w-3" />
              {t('settings.comingSoon')}
            </Badge>
          }
        />
      </section>
    </Card>
  );
}

function AdministrationSettings({ onNavigate }: SettingsPageProps) {
  const { t } = useI18n();
  const can = useAuthStore((state) => state.can);

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Shield}
        title={t('settings.administration')}
        description={t('settings.administrationDescription')}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {ADMIN_PAGE_KEYS.map((key) => {
          const item = NAV_ITEM_BY_KEY.get(key);
          const descriptionKey = ADMIN_PAGE_DESCRIPTION_KEYS[key];
          if (!item || !descriptionKey) return null;

          const allowed = !item.permission || can(item.permission);
          return (
            <Card key={key} className={cn(!allowed && 'opacity-60')}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <item.icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <CardTitle>{t(item.labelKey)}</CardTitle>
                    <CardDescription>{t(descriptionKey)}</CardDescription>
                  </div>
                  {!allowed ? (
                    <Badge variant="secondary" className="gap-1">
                      <Lock className="h-3 w-3" />
                      {t('common.noAccess')}
                    </Badge>
                  ) : null}
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!allowed}
                  onClick={() => onNavigate?.(key)}
                >
                  {t('common.open')}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function BackupSettings() {
  const { t } = useI18n();
  const [schedule, setSchedule] = useState<BackupSchedule>('daily');

  return (
    <div className="space-y-4">
      <Card className="divide-y divide-border">
        {/* Manual backup */}
        <section className="p-5">
          <SectionHeader
            icon={DatabaseBackup}
            title={t('settings.manualBackup')}
            description={t('settings.manualBackupDescription')}
            action={
              <Button onClick={() => toast.success(t('settings.backupStarted'))}>
                <DatabaseBackup className="h-4 w-4" />
                {t('settings.createBackup')}
              </Button>
            }
          />
        </section>

        {/* Automatic backup */}
        <section className="p-5">
          <SectionHeader
            icon={Clock}
            title={t('settings.autoBackup')}
            description={t('settings.autoBackupDescription')}
            action={
              <Select
                value={schedule}
                onValueChange={(value) => {
                  setSchedule(value as BackupSchedule);
                  toast.success(t('settings.backupScheduleSaved'));
                }}
              >
                <Select.Trigger aria-label={t('settings.autoBackup')} className="w-44">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {BACKUP_SCHEDULES.map((value) => (
                    <Select.Item key={value} value={value}>
                      {t(`settings.backup.${value}`)}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            }
          />
        </section>

        {/* Restore */}
        <section className="p-5">
          <SectionHeader
            icon={RotateCcw}
            title={t('settings.restore')}
            description={t('settings.restoreDescription')}
            action={
              <Button
                variant="outline"
                onClick={() => toast.info(t('settings.restoreNotImplemented'))}
              >
                <RotateCcw className="h-4 w-4" />
                {t('settings.restoreBackup')}
              </Button>
            }
          />
        </section>
      </Card>

      {/* Backup location note */}
      <div className="flex items-start gap-3 rounded-lg border border-success/20 bg-success/10 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{t('settings.backupNote')}</p>
          <p className="text-xs text-muted-foreground">{t('settings.backupNoteDescription')}</p>
        </div>
      </div>
    </div>
  );
}
