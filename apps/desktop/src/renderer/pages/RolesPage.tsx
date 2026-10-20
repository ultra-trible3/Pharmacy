import { useState, useMemo, type FormEvent } from 'react';
import { Plus, Search, Edit, Trash2, Copy, Shield, Check, Minus } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import { ACTION_LABEL_KEYS, MODULE_LABEL_KEYS, PERMISSION_GROUPS, ROLE_LABEL_KEYS } from '../lib/permissions';
import { ROLES, PERMISSIONS, type Role, permissionsForRole } from '@pharmacy/shared';
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
} from '../components/ui/table';
import { Badge, Spinner } from '../components/ui/badge';
import { toast } from '../components/ui/toast';

function RoleBadge({ role, isSystem = false }: { role: Role; isSystem?: boolean }) {
  const { t } = useI18n();

  const colors: Record<Role, 'default' | 'destructive' | 'secondary' | 'success' | 'outline'> = {
    OWNER: 'destructive',
    MANAGER: 'default',
    PHARMACIST: 'secondary',
    CASHIER: 'success',
    INVENTORY_CLERK: 'outline',
    ACCOUNTANT: 'secondary',
  };

  return (
    <Badge variant={colors[role]} className="gap-1">
      {isSystem && <Shield className="h-3 w-3" />}
      {t(ROLE_LABEL_KEYS[role])}
    </Badge>
  );
}

export function RolesPage() {
  const { t, locale } = useI18n();
  const [search, setSearch] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [formData, setFormData] = useState<Record<string, boolean>>({});

  // Blank permission form (used when opening the create dialog / "clear all").
  const initialFormData = useMemo(() => {
    const data: Record<string, boolean> = {};
    PERMISSIONS.forEach(p => { data[p] = false; });
    return data;
  }, []);

  // Handle permission toggle
  const togglePermission = (permission: string, checked: boolean) => {
    setFormData(prev => ({ ...prev, [permission]: checked }));
  };

  /** Open the permission matrix pre-filled with the role's current permissions. */
  const openPermissionMatrix = (role: Role) => {
    const perms = permissionsForRole(role);
    const data: Record<string, boolean> = {};
    PERMISSIONS.forEach(p => { data[p] = perms.includes(p); });
    setEditingRole(role);
    setFormData(data);
  };

  const moduleLabel = (module: string): string => {
    const key = MODULE_LABEL_KEYS[module];
    return key ? t(key) : module;
  };

  const permissionLabel = (permission: string): string => {
    const action = permission.split(':')[1] ?? permission;
    const key = ACTION_LABEL_KEYS[action];
    return key ? t(key) : action;
  };

  const handleSave = async () => {
    if (!editingRole) return;
    // In a real implementation, this would call an API to update role permissions.
    // For now, we just show a toast.
    toast.success(t('roles.saved', { role: t(ROLE_LABEL_KEYS[editingRole]) }));
    setEditingRole(null);
  };

  const handleCreateRole = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Placeholder for creating custom roles
    toast.info(t('roles.createNotImplemented'));
  };

  const handleDuplicateRole = async (_role: Role) => {
    toast.info(t('roles.duplicateNotImplemented'));
  };

  return (
    <div className="space-y-6" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('roles.title')}</h1>
          <p className="text-muted-foreground text-sm">{t('roles.description')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setEditingRole(null); setFormData(initialFormData); setIsCreateOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" /> {t('roles.add')}
          </Button>
        </div>
      </div>

      {/* Roles List */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder={t('common.searchRoles')} value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('roles.name')}</TableHead>
                <TableHead>{t('roles.level')}</TableHead>
                <TableHead>{t('roles.userCount')}</TableHead>
                <TableHead>{t('roles.status')}</TableHead>
                <TableHead className="text-center">{t('roles.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROLES
                .filter(r => r.toLowerCase().includes(search.toLowerCase()))
                .map(role => (
                  <TableRow key={role}>
                    <TableCell className="font-medium">{t(ROLE_LABEL_KEYS[role])}</TableCell>
                    <TableCell><RoleBadge role={role} isSystem={!['MANAGER', 'PHARMACIST', 'CASHIER', 'INVENTORY_CLERK', 'ACCOUNTANT'].includes(role)} /></TableCell>
                    <TableCell>{t('roles.userCount', { count: 0 })}</TableCell>
                    <TableCell>
                      <Badge variant={role === 'OWNER' ? 'default' : 'success'}>
                        {t('roles.systemProtected')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Button variant="ghost" size="icon" onClick={() => openPermissionMatrix(role)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDuplicateRole(role)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                        {role !== 'OWNER' && (
                          <Button variant="ghost" size="icon" className="text-destructive" onClick={() => toast.error(t('roles.deleteProtected'))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Permissions Matrix Dialog */}
      <Dialog open={!!editingRole} onOpenChange={open => !open && setEditingRole(null)}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>{t('roles.permissionMatrix', { role: editingRole ? t(ROLE_LABEL_KEYS[editingRole]) : '' })}</span>
              <Badge variant="secondary"><Shield className="h-3 w-3 mr-1" /> {t('roles.summary', { count: PERMISSIONS.filter(p => formData[p]).length })}</Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="p-4">
            <div className="flex gap-4 mb-4 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => {
                const allPerms = PERMISSIONS.reduce((acc, p) => ({ ...acc, [p]: true }), {});
                setFormData(allPerms);
              }}>
                <Check className="h-4 w-4 mr-2" /> {t('roles.selectAll')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setFormData(initialFormData)}>
                <Minus className="h-4 w-4 mr-2" /> {t('roles.clearAll')}
              </Button>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-56">{t('roles.module')}</TableHead>
                    <TableHead>{t('roles.permissions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PERMISSION_GROUPS.map(({ module, permissions }) => (
                    <TableRow key={module}>
                      <TableCell className="font-medium align-top">{moduleLabel(module)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-x-6 gap-y-2">
                          {permissions.map(permission => (
                            <label
                              key={permission}
                              title={permission}
                              className="flex items-center gap-1.5 cursor-pointer text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={formData[permission] || false}
                                onChange={e => togglePermission(permission, e.target.checked)}
                                disabled={editingRole === 'OWNER'}
                                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                              />
                              <span>{permissionLabel(permission)}</span>
                            </label>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRole(null)}>{t('common.cancel')}</Button>
            <Button onClick={handleSave} disabled={editingRole === 'OWNER'}>
              <Spinner className="h-4 w-4 mr-2" /> {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Role Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('roles.add')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateRole}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="roleName">{t('roles.name')}</Label>
                <Input id="roleName" placeholder={t('roles.namePlaceholder')} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="roleDesc">{t('roles.description')}</Label>
                <Input id="roleDesc" placeholder={t('roles.descriptionPlaceholder')} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="roleLevel">{t('roles.level')}</Label>
                <Select>
                  <Select.Trigger><Select.Value placeholder={t('roles.selectLevel')} /></Select.Trigger>
                  <Select.Content>
                    <Select.Item value="1">{t('roles.level.superAdmin')}</Select.Item>
                    <Select.Item value="2">{t('roles.level.manager')}</Select.Item>
                    <Select.Item value="3">{t('roles.level.pharmacist')}</Select.Item>
                    <Select.Item value="4">{t('roles.level.inventory')}</Select.Item>
                    <Select.Item value="5">{t('roles.level.accountant')}</Select.Item>
                  </Select.Content>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>{t('common.cancel')}</Button>
              <Button type="submit">{t('common.save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}