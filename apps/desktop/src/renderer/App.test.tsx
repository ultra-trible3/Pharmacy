import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { Toaster } from './components/ui/toast';
import { setBridge } from './lib/bridge';
import { createFakeBridge } from './test/fake-bridge';
import { useAuthStore } from './store/auth';

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <App />
      <Toaster />
    </QueryClientProvider>,
  );
}

describe('App shell', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'loading', user: null, permissions: [], error: null });
  });

  it('boots into the Arabic RTL login screen when there is no session', async () => {
    setBridge(createFakeBridge());
    renderApp();

    expect(await screen.findByRole('heading', { name: 'تسجيل الدخول' })).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(document.documentElement.lang).toBe('ar');
  });

  it('signs in and lands on the Arabic dashboard shell', async () => {
    const user = userEvent.setup();
    setBridge(createFakeBridge());
    renderApp();

    await screen.findByRole('heading', { name: 'تسجيل الدخول' });

    await user.type(screen.getByLabelText('اسم المستخدم'), 'owner');
    await user.type(screen.getByLabelText('كلمة المرور'), 'Pharma@2024');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    // The signed-in shell shows the user, the Arabic navigation and the locale toggle.
    // The user's name appears in both the sidebar and the global header.
    expect((await screen.findAllByText('أحمد عبد الرحمن')).length).toBeGreaterThan(0);
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('button', { name: 'لوحة التحكم' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'المخزون' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'الأصناف' })).toBeInTheDocument();
    // Logout exists in the sidebar (aside) and again in the global header.
    expect(
      within(screen.getByRole('complementary')).getByRole('button', { name: 'تسجيل الخروج' }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('banner')).getByRole('button', { name: 'تسجيل الخروج' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument();

    // The global header (banner) carries the pharmacy brand, page title and user.
    const banner = screen.getByRole('banner');
    expect(within(banner).getByText('أحمد عبد الرحمن')).toBeInTheDocument();
    expect(within(banner).getByRole('heading', { name: 'لوحة التحكم' })).toBeInTheDocument();

    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('translates the shell when the user switches to English', async () => {
    const user = userEvent.setup();
    setBridge(createFakeBridge());
    renderApp();

    await screen.findByRole('heading', { name: 'تسجيل الدخول' });
    await user.type(screen.getByLabelText('اسم المستخدم'), 'owner');
    await user.type(screen.getByLabelText('كلمة المرور'), 'Pharma@2024');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    await screen.findAllByText('أحمد عبد الرحمن');
    await user.click(screen.getByRole('button', { name: 'English' }));

    expect(within(screen.getByRole('navigation')).getByRole('button', { name: 'Dashboard' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('complementary')).getByRole('button', { name: 'Sign out' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.dir).toBe('ltr'));
  });

  it('applies the dark palette when the user picks the dark theme', async () => {
    const user = userEvent.setup();
    setBridge(createFakeBridge());
    renderApp();

    await screen.findByRole('heading', { name: 'تسجيل الدخول' });
    await user.type(screen.getByLabelText('اسم المستخدم'), 'owner');
    await user.type(screen.getByLabelText('كلمة المرور'), 'Pharma@2024');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    await screen.findAllByText('أحمد عبد الرحمن');
    // The jsdom matchMedia stub reports light, so "system" resolves to light.
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'المظهر' }));
    await user.click(screen.getByRole('button', { name: 'داكن' }));
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true));

    await user.click(screen.getByRole('button', { name: 'المظهر' }));
    await user.click(screen.getByRole('button', { name: 'حسب النظام' }));
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false));
  });
});

describe('App shell sidebar', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'loading', user: null, permissions: [], error: null });
  });

  it('collapses to an icon rail, re-opens it when a destination is picked, and remembers the choice', async () => {
    const user = userEvent.setup();
    setBridge(createFakeBridge());
    renderApp();

    await screen.findByRole('heading', { name: 'تسجيل الدخول' });
    await user.type(screen.getByLabelText('اسم المستخدم'), 'owner');
    await user.type(screen.getByLabelText('كلمة المرور'), 'Pharma@2024');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    await screen.findAllByText('أحمد عبد الرحمن');
    const sidebar = screen.getByRole('complementary');
    const nav = within(sidebar).getByRole('navigation');
    expect(within(sidebar).getByText('نظام إدارة الصيدلية')).toBeInTheDocument();

    // Collapse: brand text and group headers go away, every destination stays
    // reachable (icon rail keeps the accessible names for tooltips/screen readers).
    await user.click(within(sidebar).getByRole('button', { name: 'طي القائمة الجانبية' }));
    expect(window.localStorage.getItem('pharmacy.nav.sidebarOpen')).toBe('0');
    expect(within(sidebar).queryByText('نظام إدارة الصيدلية')).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole('button', { name: 'المخزون و المشتريات' }),
    ).not.toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'لوحة التحكم' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'الأصناف' })).toBeInTheDocument();

    // Icon-rail navigation still works, and picking a destination re-opens the
    // full sidebar so the collapsed rail is never a dead end.
    await user.click(within(nav).getByRole('button', { name: 'المخزون' }));
    expect(
      await within(screen.getByRole('banner')).findByRole('heading', { name: 'المخزون' }),
    ).toBeInTheDocument();
    expect(within(sidebar).getByText('نظام إدارة الصيدلية')).toBeInTheDocument();

    // Manual collapse/expand still persists the choice.
    await user.click(within(sidebar).getByRole('button', { name: 'طي القائمة الجانبية' }));
    expect(window.localStorage.getItem('pharmacy.nav.sidebarOpen')).toBe('0');
    await user.click(within(sidebar).getByRole('button', { name: 'توسيع القائمة الجانبية' }));
    expect(window.localStorage.getItem('pharmacy.nav.sidebarOpen')).toBe('1');
    expect(within(sidebar).getByText('نظام إدارة الصيدلية')).toBeInTheDocument();
  });

  it('lets the active section collapse, and expands a section when one of its pages opens', async () => {
    const user = userEvent.setup();
    setBridge(createFakeBridge());
    renderApp();

    await screen.findByRole('heading', { name: 'تسجيل الدخول' });
    await user.type(screen.getByLabelText('اسم المستخدم'), 'owner');
    await user.type(screen.getByLabelText('كلمة المرور'), 'Pharma@2024');
    await user.click(screen.getByRole('button', { name: 'دخول' }));
    await screen.findAllByText('أحمد عبد الرحمن');

    const sidebar = screen.getByRole('complementary');
    const nav = within(sidebar).getByRole('navigation');

    // The section holding the current page may collapse and must STAY
    // collapsed (it used to snap straight back open).
    await user.click(within(nav).getByRole('button', { name: 'الإدارة' }));
    expect(within(nav).queryByRole('button', { name: 'لوحة التحكم' })).not.toBeInTheDocument();
    expect(
      within(nav).getByRole('button', { name: 'الإدارة' }),
    ).toHaveAttribute('aria-expanded', 'false');

    // Collapsing a destination section, then opening one of its pages from the
    // icon rail, expands that section again while other sections keep their state.
    await user.click(within(nav).getByRole('button', { name: 'المخزون و المشتريات' }));
    expect(within(nav).queryByRole('button', { name: 'الأصناف' })).not.toBeInTheDocument();

    await user.click(within(sidebar).getByRole('button', { name: 'طي القائمة الجانبية' }));
    await user.click(within(nav).getByRole('button', { name: 'الأصناف' }));

    const productsItem = await within(nav).findByRole('button', { name: 'الأصناف' });
    expect(productsItem).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'المخزون' })).toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: 'لوحة التحكم' })).not.toBeInTheDocument();
  });

  it('re-opens the sidebar when a destination is picked outside of it', async () => {
    const user = userEvent.setup();
    setBridge(createFakeBridge());
    renderApp();

    await screen.findByRole('heading', { name: 'تسجيل الدخول' });
    await user.type(screen.getByLabelText('اسم المستخدم'), 'owner');
    await user.type(screen.getByLabelText('كلمة المرور'), 'Pharma@2024');
    await user.click(screen.getByRole('button', { name: 'دخول' }));
    await screen.findAllByText('أحمد عبد الرحمن');

    const sidebar = screen.getByRole('complementary');
    const banner = screen.getByRole('banner');
    const main = screen.getByRole('main');

    // Collapse the sidebar to the icon rail.
    await user.click(within(sidebar).getByRole('button', { name: 'طي القائمة الجانبية' }));
    expect(window.localStorage.getItem('pharmacy.nav.sidebarOpen')).toBe('0');

    // A dashboard quick action picks a destination outside the sidebar: the
    // full sidebar comes back and the picked page's section is expanded, so
    // the destination the user just opened is visible.
    await user.click(within(main).getByRole('button', { name: 'إدارة الأصناف' }));
    expect(within(sidebar).getByText('نظام إدارة الصيدلية')).toBeInTheDocument();
    expect(window.localStorage.getItem('pharmacy.nav.sidebarOpen')).toBe('1');
    expect(within(sidebar).getByRole('button', { name: 'الأصناف' })).toBeInTheDocument();

    // The header behaves the same way: collapse again, then navigate from it.
    await user.click(within(sidebar).getByRole('button', { name: 'طي القائمة الجانبية' }));
    expect(window.localStorage.getItem('pharmacy.nav.sidebarOpen')).toBe('0');
    await user.click(within(banner).getByRole('button', { name: 'الإعدادات' }));
    expect(within(sidebar).getByText('نظام إدارة الصيدلية')).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: 'الإعدادات' })).toBeInTheDocument();
    expect(window.localStorage.getItem('pharmacy.nav.sidebarOpen')).toBe('1');
  });

  it('expands the section of the destination picked from the rail even on the same page', async () => {
    const user = userEvent.setup();
    setBridge(createFakeBridge());
    renderApp();

    await screen.findByRole('heading', { name: 'تسجيل الدخول' });
    await user.type(screen.getByLabelText('اسم المستخدم'), 'owner');
    await user.type(screen.getByLabelText('كلمة المرور'), 'Pharma@2024');
    await user.click(screen.getByRole('button', { name: 'دخول' }));
    await screen.findAllByText('أحمد عبد الرحمن');

    const sidebar = screen.getByRole('complementary');
    const nav = within(sidebar).getByRole('navigation');

    // Open a page, then collapse the section that holds it (allowed: the
    // active section may stay collapsed while its page is on screen).
    await user.click(within(nav).getByRole('button', { name: 'الأصناف' }));
    await within(screen.getByRole('banner')).findByRole('heading', { name: 'الأصناف' });
    await user.click(within(nav).getByRole('button', { name: 'المخزون و المشتريات' }));
    expect(within(nav).queryByRole('button', { name: 'الأصناف' })).not.toBeInTheDocument();

    // Collapse the sidebar and re-pick the very same page from the icon rail:
    // the sidebar re-opens AND its section expands, so the picked item shows
    // up even though the page itself never changed.
    await user.click(within(sidebar).getByRole('button', { name: 'طي القائمة الجانبية' }));
    await user.click(within(nav).getByRole('button', { name: 'الأصناف' }));

    const productsItem = await within(nav).findByRole('button', { name: 'الأصناف' });
    expect(productsItem).toHaveAttribute('aria-current', 'page');
    expect(
      within(nav).getByRole('button', { name: 'المخزون و المشتريات' }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(window.localStorage.getItem('pharmacy.nav.sidebarOpen')).toBe('1');
    expect(
      JSON.parse(window.localStorage.getItem('pharmacy.nav.collapsed') ?? '[]'),
    ).not.toContain('inventory');
  });

  it('keeps a persisted collapsed rail collapsed across a restart', async () => {
    const user = userEvent.setup();
    setBridge(createFakeBridge());
    window.localStorage.setItem('pharmacy.nav.sidebarOpen', '0');
    renderApp();

    await screen.findByRole('heading', { name: 'تسجيل الدخول' });
    await user.type(screen.getByLabelText('اسم المستخدم'), 'owner');
    await user.type(screen.getByLabelText('كلمة المرور'), 'Pharma@2024');
    await user.click(screen.getByRole('button', { name: 'دخول' }));
    await screen.findAllByText('أحمد عبد الرحمن');

    // Mounting is not a navigation: the user's collapsed rail stays as-is.
    const sidebar = screen.getByRole('complementary');
    expect(within(sidebar).queryByText('نظام إدارة الصيدلية')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('pharmacy.nav.sidebarOpen')).toBe('0');
  });
});
