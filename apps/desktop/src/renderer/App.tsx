import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertOctagon } from 'lucide-react';
import { type ReactElement, useEffect, useState } from 'react';
import { AppShell, type PageKey } from './components/layout/AppShell';
import { Spinner } from './components/ui/badge';
import { Toaster } from './components/ui/toast';
import { useI18n } from './i18n/useI18n';
import { getBridge, hasBridge } from './lib/bridge';
import { DashboardPage } from './pages/DashboardPage';
import { AlertsPage } from './pages/AlertsPage';
import { InventoryPage } from './pages/InventoryPage';
import { WarehousesPage } from './pages/WarehousesPage';
import { LoginPage } from './pages/LoginPage';
import { ProductsPage } from './pages/ProductsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { POSPage } from './pages/POSPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { CustomersPage } from './pages/CustomersPage';
import { DebtsPage } from './pages/DebtsPage';
import { SalesPage } from './pages/SalesPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { ReturnsPage } from './pages/ReturnsPage';
import { ActivityLogPage } from './pages/ActivityLogPage';
import { ShiftManagementPage } from './pages/ShiftManagementPage';
import { UsersPage } from './pages/UsersPage';
import { RolesPage } from './pages/RolesPage';
import { PermissionsPage } from './pages/PermissionsPage';
import { useAuthStore } from './store/auth';
import { useUiStore } from './store/ui';
import { useTheme } from './hooks/useTheme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
    mutations: { retry: 0 },
  },
});

/** Shown when the renderer is opened outside the Electron shell (e.g. `vite preview`). */
function BridgeMissingScreen(): ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8" dir="rtl">
      <div className="max-w-md rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
        <AlertOctagon className="mx-auto mb-3 h-8 w-8 text-destructive" />
        <h1 className="text-base font-bold">يجب تشغيل التطبيق داخل نافذة سطح المكتب</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          جسر الاتصال الآمن (preload) غير متاح. شغّل التطبيق عبر{' '}
          <code className="numeric">pnpm --filter @pharmacy/desktop dev</code> بدلًا من فتح المتصفح.
        </p>
      </div>
    </div>
  );
}

function SplashScreen({ message }: { message: string }): ReactElement {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <Spinner className="h-6 w-6" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function AuthenticatedApp(): ReactElement {
  const [page, setPage] = useState<PageKey>('dashboard');

  const renderPage = (): ReactElement => {
    switch (page) {
      case 'dashboard':
        return <DashboardPage onNavigate={setPage} />;
      case 'products':
        return <ProductsPage />;
      case 'inventory':
        return <InventoryPage />;
      case 'warehouses':
        return <WarehousesPage />;
      case 'alerts':
        return <AlertsPage onNavigate={setPage} />;
      case 'pos':
        return <POSPage />;
      case 'suppliers':
        return <SuppliersPage />;
      case 'purchases':
        return <PurchasesPage />;
      case 'categories':
        return <CategoriesPage />;
      case 'customers':
        return <CustomersPage />;
      case 'debts':
        return <DebtsPage />;
      case 'sales':
        return <SalesPage />;
      case 'invoices':
        return <InvoicesPage />;
      case 'returns':
        return <ReturnsPage />;
      case 'reports':
        return <ReportsPage />;
      case 'expenses':
        return <ExpensesPage />;
      case 'shifts':
        return <ShiftManagementPage />;
      case 'audit':
        return <ActivityLogPage />;
      case 'settings':
        return <SettingsPage onNavigate={setPage} />;
      case 'users':
        return <UsersPage />;
      case 'roles':
        return <RolesPage />;
      case 'permissions':
        return <PermissionsPage />;
      default:
        return <DashboardPage onNavigate={setPage} />;
    }
  };

  return (
    <AppShell page={page} onNavigate={setPage}>
      {renderPage()}
    </AppShell>
  );
}

export function App(): ReactElement {
  const { dir, locale, t } = useI18n();
  const themeMode = useUiStore((state) => state.themeMode);
  const status = useAuthStore((state) => state.status);
  const bootstrap = useAuthStore((state) => state.bootstrap);
  const applySession = useAuthStore((state) => state.applySession);

  // Keep the `.dark` class (and thus the whole palette) in sync with the
  // selected appearance; "system" follows the OS colour scheme live.
  useTheme(themeMode);

  // Keep <html lang/dir> in sync with the selected locale (RTL by default).
  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = locale;
    document.title = t('app.title');
  }, [dir, locale, t]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!hasBridge()) return undefined;
    return getBridge().auth.onChange(applySession);
  }, [applySession]);

  if (!hasBridge()) return <BridgeMissingScreen />;
  if (status === 'loading') return <SplashScreen message={t('common.loading')} />;
  if (status === 'anonymous') return <LoginPage />;
  return <AuthenticatedApp />;
}

export function Root(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster />
    </QueryClientProvider>
  );
}
