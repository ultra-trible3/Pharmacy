import { FileDown, Loader2, Printer, X } from 'lucide-react';
import { useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../ui/button';
import { toast } from '../ui/toast';
import { useDismiss } from '../../hooks/useDismiss';
import { useI18n } from '../../i18n/useI18n';
import { dashboardFileName } from '../../lib/reportRange';
import type { InventoryReportDto, SalesReportDto } from '../../lib/api';
import { DashboardReport } from './DashboardReport';

export interface DashboardReportDialogProps {
  open: boolean;
  onClose: () => void;
  sales: SalesReportDto | null;
  inventory: InventoryReportDto | null;
  canViewCost: boolean;
  /** Already-localised "From … to … • N days" line. */
  rangeLabel: string;
  range: { from: string; to: string } | null;
}

/**
 * Preview dialog for the printable dashboard report: shows the exact document
 * that gets downloaded as PDF (`html2pdf`, same pipeline as receipts) or sent
 * to the system printer (`window.print`, styled by the `report-print-root`
 * rules in index.css). Portalled to <body> so print mode can drop the app.
 */
export function DashboardReportDialog({
  open,
  onClose,
  sales,
  inventory,
  canViewCost,
  rangeLabel,
  range,
}: DashboardReportDialogProps): ReactElement | null {
  const { t } = useI18n();
  const [downloading, setDownloading] = useState(false);
  const panelRef = useDismiss<HTMLDivElement>(open, onClose);
  const scrollRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  if (!open) return null;

  const downloadPdf = async (): Promise<void> => {
    if (!reportRef.current) return;
    setDownloading(true);
    try {
      const { default: html2pdf } = await import('html2pdf.js');
      // Expand the scroll container so html2canvas captures the whole report
      // instead of just the visible slice (same trick as ReceiptPreview).
      const scroll = scrollRef.current;
      const prevOverflow = scroll?.style.overflow;
      const prevMaxHeight = scroll?.style.maxHeight;
      if (scroll) {
        scroll.style.overflow = 'visible';
        scroll.style.maxHeight = 'none';
      }
      try {
        // `pagebreak` is supported by html2pdf.js at runtime but missing from
        // its bundled type declarations, so the options go through a variable.
        const pdfOptions = {
          margin: 8,
          filename: dashboardFileName(range, new Date(), 'pdf'),
          image: { type: 'jpeg' as const, quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
          pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.dr-kpi'] },
        };
        await html2pdf().from(reportRef.current).set(pdfOptions).save();
        toast.success(t('dashboard.exportPdfDone'));
      } finally {
        if (scroll) {
          scroll.style.overflow = prevOverflow ?? '';
          scroll.style.maxHeight = prevMaxHeight ?? '';
        }
      }
    } catch (error) {
      console.error('Dashboard PDF export failed:', error);
      toast.error(t('dashboard.exportPdfFailed'));
    } finally {
      setDownloading(false);
    }
  };

  return createPortal(
    <div
      className="report-print-root fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dashboard-report-title"
    >
      <div
        ref={panelRef}
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
      >
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 id="dashboard-report-title" className="text-sm font-bold">
            {t('dashboard.report.title')}
          </h2>
          <div className="report-header-actions flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" />
              {t('common.print')}
            </Button>
            <Button size="sm" onClick={() => void downloadPdf()} disabled={downloading}>
              {downloading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileDown className="h-3.5 w-3.5" />
              )}
              {downloading ? t('dashboard.exportPreparing') : t('dashboard.report.download')}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('common.close')}
              title={t('common.close')}
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div ref={scrollRef} className="report-scroll min-h-0 flex-1 overflow-y-auto bg-muted p-4 sm:p-6">
          <div className="mx-auto w-full max-w-[210mm] shadow-md">
            {/* The captured node stays free of screen-only chrome (shadow),
                so the exported PDF never gets a grey halo at its edges. */}
            <div ref={reportRef}>
              <DashboardReport
                sales={sales}
                inventory={inventory}
                canViewCost={canViewCost}
                rangeLabel={rangeLabel}
                generatedAt={new Date()}
              />
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
