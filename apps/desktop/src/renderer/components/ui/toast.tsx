import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { type ReactElement } from 'react';
import { create } from 'zustand';
import { cn } from '../../lib/utils';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
  title?: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (toast: Omit<ToastItem, 'id'>) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 6_000);
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Imperative helpers usable from anywhere (event handlers, query callbacks). */
export const toast = {
  success: (message: string, title?: string) =>
    useToastStore.getState().push({ variant: 'success', message, ...(title ? { title } : {}) }),
  error: (message: string, title?: string) =>
    useToastStore.getState().push({ variant: 'error', message, ...(title ? { title } : {}) }),
  info: (message: string, title?: string) =>
    useToastStore.getState().push({ variant: 'info', message, ...(title ? { title } : {}) }),
};

const ICONS = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
} as const;

const STYLES: Record<ToastVariant, string> = {
  success: 'border-success/30 bg-success/5 text-foreground',
  error: 'border-destructive/40 bg-destructive/5 text-foreground',
  info: 'border-border bg-card text-foreground',
};

/** Renders the toast stack. Mounted once at the application root. */
export function Toaster(): ReactElement {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-4 z-[100] flex w-80 flex-col gap-2"
      role="region"
      aria-label="الإشعارات"
    >
      {toasts.map((item) => {
        const Icon = ICONS[item.variant];
        return (
          <div
            key={item.id}
            role={item.variant === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-lg border p-3 shadow-md animate-toast-in',
              STYLES[item.variant],
            )}
          >
            <Icon
              className={cn(
                'mt-0.5 h-4 w-4 shrink-0',
                item.variant === 'success' && 'text-success',
                item.variant === 'error' && 'text-destructive',
                item.variant === 'info' && 'text-primary',
              )}
            />
            <div className="flex-1 text-sm">
              {item.title ? <p className="font-semibold">{item.title}</p> : null}
              <p>{item.message}</p>
            </div>
            <button
              type="button"
              aria-label="إغلاق الإشعار"
              className="rounded p-0.5 text-muted-foreground hover:bg-muted"
              onClick={() => dismiss(item.id)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
