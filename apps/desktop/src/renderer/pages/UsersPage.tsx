import { useState, type FormEvent } from 'react';
import { Plus, Search, Edit, RefreshCw, Lock, Unlock, RotateCcw, Shield } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../i18n/useI18n';
import { api } from '../lib/api';
import type { UserDto, UserCreateBody, UserUpdateBody, UserResetPasswordBody, ListParams } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableFooter,
} from '../components/ui/table';
import { Badge, Spinner, EmptyState } from '../components/ui/badge';
import { toast } from '../components/ui/toast';

function RoleBadge({ role, isSystem = false }: { role: string; isSystem?: boolean }) {
  const { t } = useI18n();
  const labels: Record<string, string> = {
    OWNER: t('roles.level.owner'),
    MANAGER: t('roles.level.manager'),
    PHARMACIST: t('roles.level.pharmacist'),
    CASHIER: t('roles.level.cashier'),
    INVENTORY_CLERK: t('roles.level.inventory_clerk'),
    ACCOUNTANT: t('roles.level.accountant'),
  };

  return (
    <Badge variant={role === 'OWNER' ? 'destructive' : role === 'MANAGER' ? 'default' : 'secondary'} className="gap-1">
      {isSystem && <Shield className="h-3 w-3" />}
      {labels[role] || role}
    </Badge>
  );
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  const { t } = useI18n();
  return (
    <Badge variant={isActive ? 'success' : 'secondary'}>
      {isActive ? t('common.active') : t('common.inactive')}
    </Badge>
  );
}

export function UsersPage() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [sortBy, setSortBy] = useState<'username' | 'fullName' | 'role' | 'isActive' | 'lastLoginAt' | 'createdAt'>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Dialog states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserDto | null>(null);
  const [resettingPasswordFor, setResettingPasswordFor] = useState<UserDto | null>(null);

  // Form states
  const [createForm, setCreateForm] = useState<UserCreateBody>({
    username: '',
    fullName: '',
    email: '',
    role: 'CASHIER',
    password: '',
  });
  const [editForm, setEditForm] = useState<Partial<UserUpdateBody>>({});
  const [resetForm, setResetForm] = useState<UserResetPasswordBody>({
    newPassword: '',
    mustChangePassword: true,
  });

  // Fetch users
  const { data, isLoading, error, refetch, isError } = useQuery({
    queryKey: ['users', page, pageSize, search, roleFilter, statusFilter, sortBy, sortOrder],
    queryFn: async () => {
      const params: ListParams & { search?: string; role?: string; isActive?: boolean; sortBy?: string; sortOrder?: 'asc' | 'desc' } = {
        page,
        pageSize,
        sortBy,
        sortOrder,
      };
      if (search) params.search = search;
      if (roleFilter) params.role = roleFilter;
      if (statusFilter !== 'all') params.isActive = statusFilter === 'active';

      return api.users.list(params);
    },
    retry: 1,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (body: UserCreateBody) => api.users.create(body),
    onSuccess: () => {
      toast.success(t('users.created', { username: createForm.username }));
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setIsCreateOpen(false);
      setCreateForm({ username: '', fullName: '', email: '', role: 'CASHIER', password: '' });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UserUpdateBody }) => api.users.update(id, body),
    onSuccess: () => {
      toast.success(t('users.updated'));
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditingUser(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UserResetPasswordBody }) => api.users.resetPassword(id, body),
    onSuccess: () => {
      toast.success(t('users.passwordReset'));
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setResettingPasswordFor(null);
      setResetForm({ newPassword: '', mustChangePassword: true });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.users.deactivate(id),
    onSuccess: () => {
      toast.success(t('users.deactivated'));
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleCreateSubmit = (e: FormEvent) => {
    e.preventDefault();
    createMutation.mutate(createForm);
  };

  const handleEditSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    updateMutation.mutate({ id: editingUser.id, body: editForm as UserUpdateBody });
  };

  const handleResetSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!resettingPasswordFor) return;
    resetPasswordMutation.mutate({ id: resettingPasswordFor.id, body: resetForm });
  };

  const handleDeactivate = (user: UserDto) => {
    if (!confirm(t('users.confirmDeactivate'))) return;
    deactivateMutation.mutate(user.id);
  };

  const handleActivate = (user: UserDto) => {
    updateMutation.mutate({ id: user.id, body: { isActive: true } });
  };

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const SortIcon = ({ field }: { field: typeof sortBy }) => {
    if (sortBy !== field) return <span className="text-muted-foreground">⇅</span>;
    return sortOrder === 'asc' ? '▲' : '▼';
  };

  return (
    <div className="space-y-6" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('users.title')}</h1>
          <p className="text-muted-foreground text-sm">{t('users.description', { count: data?.total || 0 })}</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" />
          {t('users.add')}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 p-4 bg-card border border-border rounded-lg">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('users.searchPlaceholder')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-10"
          />
        </div>
        <div className="w-full sm:w-48">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <Select.Trigger><Select.Value placeholder={t('common.allRoles')} /></Select.Trigger>
            <Select.Content>
              <Select.Item value="">{t('common.allRoles')}</Select.Item>
              <Select.Item value="OWNER">{t('roles.level.owner')}</Select.Item>
              <Select.Item value="MANAGER">{t('roles.level.manager')}</Select.Item>
              <Select.Item value="PHARMACIST">{t('roles.level.pharmacist')}</Select.Item>
              <Select.Item value="CASHIER">{t('roles.level.cashier')}</Select.Item>
              <Select.Item value="INVENTORY_CLERK">{t('roles.level.inventory_clerk')}</Select.Item>
              <Select.Item value="ACCOUNTANT">{t('roles.level.accountant')}</Select.Item>
            </Select.Content>
          </Select>
        </div>
        <div className="w-full sm:w-40">
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as 'all' | 'active' | 'inactive')}>
            <Select.Trigger><Select.Value placeholder={t('common.allStatus')} /></Select.Trigger>
            <Select.Content>
              <Select.Item value="all">{t('common.allStatus')}</Select.Item>
              <Select.Item value="active">{t('common.active')}</Select.Item>
              <Select.Item value="inactive">{t('common.inactive')}</Select.Item>
            </Select.Content>
          </Select>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Users Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center"><Spinner className="h-8 w-8" /></div>
        ) : isError ? (
          <EmptyState 
            title={t('common.error')} 
            description={error instanceof Error ? error.message : t('users.loadFailed')} 
          />
        ) : data?.items.length === 0 ? (
          <EmptyState title={t('users.noUsers')} description={t('users.noUsersDesc')} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead onClick={() => handleSort('username')} className="cursor-pointer select-none">
                      {t('users.username')} <SortIcon field="username" />
                    </TableHead>
                    <TableHead onClick={() => handleSort('fullName')} className="cursor-pointer select-none">
                      {t('users.fullName')} <SortIcon field="fullName" />
                    </TableHead>
                    <TableHead onClick={() => handleSort('role')} className="cursor-pointer select-none">
                      {t('users.role')} <SortIcon field="role" />
                    </TableHead>
                    <TableHead onClick={() => handleSort('isActive')} className="cursor-pointer select-none">
                      {t('common.status')} <SortIcon field="isActive" />
                    </TableHead>
                    <TableHead onClick={() => handleSort('lastLoginAt')} className="cursor-pointer select-none">
                      {t('users.lastLogin')} <SortIcon field="lastLoginAt" />
                    </TableHead>
                    <TableHead className="text-center">{t('users.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data!.items.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-mono">{user.username}</TableCell>
                      <TableCell>{user.fullName}</TableCell>
                      <TableCell><RoleBadge role={user.role} isSystem={user.role === 'OWNER'} /></TableCell>
                      <TableCell><StatusBadge isActive={user.isActive} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB') : '—'}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Button variant="ghost" size="icon" onClick={() => { setEditingUser(user); setEditForm({ fullName: user.fullName, email: user.email, role: user.role, isActive: user.isActive }); }}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => { setResettingPasswordFor(user); setResetForm({ newPassword: '', mustChangePassword: true }); }}>
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                          {user.isActive ? (
                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDeactivate(user)} disabled={deactivateMutation.isPending}>
                              <Lock className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="icon" className="text-success" onClick={() => handleActivate(user)} disabled={updateMutation.isPending}>
                              <Unlock className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      {t('common.showing', { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, data!.total), total: data!.total })}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>

            {/* Pagination */}
            {data!.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <span className="text-sm text-muted-foreground">
                  {t('common.page')} {page} {t('common.of')} {data!.totalPages}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                    {t('common.previous')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(data!.totalPages, p + 1))} disabled={page === data!.totalPages}>
                    {t('common.next')}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create User Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('users.add')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="username">{t('users.username')}</Label>
                <Input id="username" value={createForm.username} onChange={e => setCreateForm({ ...createForm, username: e.target.value })} required autoComplete="username" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="fullName">{t('users.fullName')}</Label>
                <Input id="fullName" value={createForm.fullName} onChange={e => setCreateForm({ ...createForm, fullName: e.target.value })} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">{t('users.email')}</Label>
                <Input id="email" type="email" value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="role">{t('users.role')}</Label>
                <Select value={createForm.role} onValueChange={v => setCreateForm({ ...createForm, role: v })} required>
                  <Select.Trigger><Select.Value placeholder={t('common.selectRole')} /></Select.Trigger>
                  <Select.Content>
                    <Select.Item value="OWNER">{t('roles.level.owner')}</Select.Item>
                    <Select.Item value="MANAGER">{t('roles.level.manager')}</Select.Item>
                    <Select.Item value="PHARMACIST">{t('roles.level.pharmacist')}</Select.Item>
                    <Select.Item value="CASHIER">{t('roles.level.cashier')}</Select.Item>
                    <Select.Item value="INVENTORY_CLERK">{t('roles.level.inventory_clerk')}</Select.Item>
                    <Select.Item value="ACCOUNTANT">{t('roles.level.accountant')}</Select.Item>
                  </Select.Content>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">{t('users.password')}</Label>
                <Input id="password" type="password" value={createForm.password} onChange={e => setCreateForm({ ...createForm, password: e.target.value })} required minLength={8} autoComplete="new-password" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? <Spinner className="h-4 w-4 mr-2" /> : null} {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      {editingUser && (
        <Dialog open={true} onOpenChange={open => !open && setEditingUser(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('users.edit', { name: editingUser.fullName })}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleEditSubmit}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="editFullName">{t('users.fullName')}</Label>
                <Input id="editFullName" value={editForm.fullName || ''} onChange={e => setEditForm({ ...editForm, fullName: e.target.value })} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="editEmail">{t('users.email')}</Label>
                <Input id="editEmail" type="email" value={editForm.email || ''} onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="editRole">{t('users.role')}</Label>
                <Select value={editForm.role || editingUser!.role} onValueChange={v => setEditForm({ ...editForm, role: v })} required>
                  <Select.Trigger><Select.Value placeholder={t('common.selectRole')} /></Select.Trigger>
                  <Select.Content>
                    <Select.Item value="OWNER">{t('roles.level.owner')}</Select.Item>
                    <Select.Item value="MANAGER">{t('roles.level.manager')}</Select.Item>
                    <Select.Item value="PHARMACIST">{t('roles.level.pharmacist')}</Select.Item>
                    <Select.Item value="CASHIER">{t('roles.level.cashier')}</Select.Item>
                    <Select.Item value="INVENTORY_CLERK">{t('roles.level.inventory_clerk')}</Select.Item>
                    <Select.Item value="ACCOUNTANT">{t('roles.level.accountant')}</Select.Item>
                  </Select.Content>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="editIsActive" checked={editForm.isActive ?? editingUser!.isActive} onChange={e => setEditForm({ ...editForm, isActive: e.target.checked })} />
                <Label htmlFor="editIsActive">{t('users.isActive')}</Label>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? <Spinner className="h-4 w-4 mr-2" /> : null} {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      )}

      {/* Reset Password Dialog */}
      {resettingPasswordFor && (
        <Dialog open={true} onOpenChange={open => !open && setResettingPasswordFor(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('users.resetPassword', { name: resettingPasswordFor.fullName })}</DialogTitle>
            </DialogHeader>
          <form onSubmit={handleResetSubmit}>
            <div className="grid gap-4 py-4">
              <p className="text-sm text-muted-foreground">{t('users.resetPasswordDesc')}</p>
              <div className="grid gap-2">
                <Label htmlFor="newPassword">{t('users.newPassword')}</Label>
                <Input id="newPassword" type="password" value={resetForm.newPassword} onChange={e => setResetForm({ ...resetForm, newPassword: e.target.value })} required minLength={8} autoComplete="new-password" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="mustChangePassword" checked={resetForm.mustChangePassword} onChange={e => setResetForm({ ...resetForm, mustChangePassword: e.target.checked })} />
                <Label htmlFor="mustChangePassword">{t('users.mustChangePassword')}</Label>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResettingPasswordFor(null)}>{t('common.cancel')}</Button>
              <Button type="submit" className="bg-destructive" disabled={resetPasswordMutation.isPending}>
                {resetPasswordMutation.isPending ? <Spinner className="h-4 w-4 mr-2" /> : null} {t('users.resetPassword')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      )}

    </div>
  );
}