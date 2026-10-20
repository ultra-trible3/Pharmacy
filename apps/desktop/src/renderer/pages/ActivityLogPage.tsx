import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { useI18n } from '../i18n/useI18n';
import { useDebounce } from '../hooks/useDebounce';
import { api } from '../lib/api';
import type { Paginated } from '@pharmacy/shared';

interface AuditEntryDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  userId: string | null;
  ip: string | null;
  userAgent: string | null;
  terminalId: string | null;
  createdAt: string;
  user: { id: string; fullName: string; username: string } | null;
}

function ActivityLogPage() {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 300);

  const { data: audit, isLoading, isError } = useQuery<Paginated<AuditEntryDto>>({
    queryKey: ['audit', page, debouncedSearch],
    queryFn: () =>
      api.audit.list({
        page,
        pageSize: 25,
        q: debouncedSearch ?? undefined,
      }),
    placeholderData: (previous) => previous,
  });

  const items = audit?.items ?? [];
  const totalPages = audit?.totalPages ?? 1;

  const renderTable = () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('audit.time')}</TableHead>
          <TableHead>{t('audit.user')}</TableHead>
          <TableHead>{t('audit.action')}</TableHead>
          <TableHead>{t('audit.entity')}</TableHead>
          <TableHead>{t('audit.details')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="numeric text-xs" dir="ltr">
              {item.createdAt ? item.createdAt.substring(0, 16) : '—'}
            </TableCell>
            <TableCell>{item.user?.username ?? '—'}</TableCell>
            <TableCell>{item.action}</TableCell>
            <TableCell>{item.entityType ?? '—'}</TableCell>
            <TableCell>{item.before !== null ? 'Changed' : '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('common.search')}
          aria-label={t('common.search')}
          className="ps-9"
        />
        <Button variant="outline" size="sm" onClick={() => setPage(1)}>
          {t('common.refresh')}
        </Button>
      </div>

      {isLoading ? (
        <svg className="h-8 w-8" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" focusable="false">
          <circle cx="12" cy="12" r="3" />
          <path d="M1 1l4 4 4-4" />
        </svg>
      ) : null}
      {isError ? (
        <svg className="h-8 w-8" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" focusable="false" fill="currentColor">
          <path d="M9 12L10 12M12 9l6 6M12 15l6-6" />
        </svg>
      ) : null}
      {!isLoading && !isError && items.length === 0 ? (
        <svg className="h-8 w-8" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" focusable="false">
          <path d="M12 4c-4.41 0-8 3.59-8 8s3.59 8 8 8 8-3.59 8-8-3.59-8-8-8zm0 2c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6 2.69-6 6-6z" />
        </svg>
      ) : null}

      {items.length > 0 ? renderTable() : null}

      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={1 >= totalPages} onClick={() => setPage((c) => Math.max(1, c - 1))}>
            {t('common.previous')}
          </Button>
          <Button variant="outline" size="sm" disabled={totalPages <= 1} onClick={() => setPage((c) => Math.min(totalPages, c + 1))}>
            {t('common.next')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export { ActivityLogPage };