import type { LucideIcon } from 'lucide-react';
import { Calculator, ClipboardList, Lock, Pause, Play, Printer, Search, Undo2, Users } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import type { TranslationKey } from '../../i18n/dictionaries';

const actions: { id: string; labelKey: string; icon: LucideIcon; shortcut: string }[] = [
  { id: 'customers', labelKey: 'pos.toolbar.customers', icon: Users, shortcut: 'F3' },
  { id: 'suspend', labelKey: 'pos.toolbar.suspend', icon: Pause, shortcut: 'F5' },
  { id: 'resume', labelKey: 'pos.toolbar.resume', icon: Play, shortcut: 'F6' },
  { id: 'returns', labelKey: 'pos.toolbar.returns', icon: Undo2, shortcut: 'F7' },
  { id: 'history', labelKey: 'pos.toolbar.history', icon: ClipboardList, shortcut: 'F8' },
  { id: 'search', labelKey: 'pos.toolbar.search', icon: Search, shortcut: 'F2' },
  { id: 'calculator', labelKey: 'pos.toolbar.calculator', icon: Calculator, shortcut: 'F9' },
  { id: 'closeShift', labelKey: 'pos.toolbar.closeShift', icon: Lock, shortcut: 'F10' },
  { id: 'printerSettings', labelKey: 'pos.toolbar.printerSettings', icon: Printer, shortcut: 'F11' },
];

/**
 * Read-only overview of the POS quick actions and their keyboard shortcuts.
 * Rendered on the Settings screen — the shortcuts themselves take effect on
 * the POS screen.
 */
export function QuickActionsToolbar() {
  const { t } = useI18n();

  return (
    <ul className="grid grid-cols-2 gap-2 xl:grid-cols-3" role="list">
      {actions.map(action => {
        const Icon = action.icon;
        const labelKey = action.labelKey as TranslationKey;
        return (
          <li key={action.id}>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon size={13} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">
                {t(labelKey)}
              </span>
              <kbd className="numeric shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {action.shortcut}
              </kbd>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
