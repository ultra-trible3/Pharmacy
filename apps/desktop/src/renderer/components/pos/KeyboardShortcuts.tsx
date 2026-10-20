import { useEffect, useCallback } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { Keyboard, X } from 'lucide-react';

interface Shortcut {
  key: string;
  description: string;
  action: () => void;
  global?: boolean;
}

interface KeyboardShortcutsProps {
  shortcuts: Shortcut[];
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcuts({ shortcuts, isOpen, onClose }: KeyboardShortcutsProps) {
  const { t } = useI18n();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key === 'Escape') {
      onClose();
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
      <div className="modal shortcuts-modal" onClick={e => e.stopPropagation()}>
        <header>
          <h2 id="shortcuts-title">
            <Keyboard size={20} />
            {t('pos.keyboard.shortcuts')}
          </h2>
          <button className="close-btn" onClick={onClose} aria-label={t('common.close')}>
            <X size={20} />
          </button>
        </header>
        <div className="shortcuts-list">
          {shortcuts.map((shortcut, index) => (
            <div key={index} className="shortcut-item">
              <kbd className="shortcut-key">{shortcut.key}</kbd>
              <span className="shortcut-desc">{shortcut.description}</span>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn-primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useKeyboardShortcuts(shortcuts: Shortcut[]) {

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Match bare keys: the help dialog advertises plain F1–F11 (F5 =
      // suspend, F4 = checkout, …). The old matcher demanded a modifier for
      // every `global` shortcut, so F3–F11 never fired at all — and F5 was
      // never preventDefault-ed, leaving the browser's reload default in
      // charge instead of the POS action.
      const shortcut = shortcuts.find(s => s.key.toLowerCase() === e.key.toLowerCase());
      if (shortcut) {
        e.preventDefault();
        shortcut.action();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts]);
}

export const DEFAULT_SHORTCUTS = [
  { key: 'F1', description: 'pos.keyboard.help', global: true },
  { key: 'F2', description: 'pos.keyboard.focusSearch', global: true },
  { key: 'F3', description: 'pos.toolbar.customers', global: true },
  { key: 'F4', description: 'pos.keyboard.checkout', global: true },
  { key: 'F5', description: 'pos.keyboard.suspend', global: true },
  { key: 'F6', description: 'pos.keyboard.resume', global: true },
  { key: 'F7', description: 'pos.keyboard.returns', global: true },
  { key: 'F8', description: 'pos.keyboard.history', global: true },
  { key: 'F9', description: 'pos.keyboard.calculator', global: true },
  { key: 'F10', description: 'pos.keyboard.closeShift', global: true },
  { key: 'F11', description: 'pos.keyboard.printerSettings', global: true },
  { key: 'Escape', description: 'common.close', global: false },
];