import { useState, useRef, useEffect } from 'react';
import { Printer, Download, X, CheckCircle, Loader2, AlertCircle, Phone } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { formatEGP } from '@pharmacy/shared';
import type { TranslationKey } from '../../i18n/dictionaries';

interface Invoice {
  id: string;
  invoiceNumber: string;
  items: Array<{
    id: string;
    product: { nameAr: string; nameEn: string | null; strength: string | null; dosageForm: string; packSize: string | null; unit: string | null; barcode: string | null };
    batch: { lotNumber: string; expiryDate: string };
    quantity: number;
    unitPrice: string;
    discount: string;
    lineTotal: string;
  }>;
  customer?: { name: string; phone: string | null };
  subtotal: string;
  itemDiscount: string;
  invoiceDiscount: string;
  taxAmount: string;
  total: string;
  paymentMethods: string[];
  payments?: Array<{ method: string; amount: string; reference?: string }>;
  status: 'completed' | 'suspended' | 'voided';
  createdAt: string;
  cashierId: string;
  cashierName?: string;
  warehouseId: string;
  warehouseNameAr?: string;
  note?: string;
}

interface ReceiptPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  onPrint: (format: 'thermal' | 'pdf' | 'a4') => void;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'pos.payment.cash',
  card: 'pos.payment.card',
  wallet: 'pos.payment.wallet',
  credit: 'pos.payment.credit',
};

export function ReceiptPreview({ isOpen, onClose, invoice, onPrint }: ReceiptPreviewProps) {
  const { t, locale } = useI18n();
  const [printFormat, setPrintFormat] = useState<'thermal' | 'pdf' | 'a4'>('thermal');
  const [isPrinting, setIsPrinting] = useState(false);
  const [printResult, setPrintResult] = useState<{ success: boolean; message: string } | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPrintFormat('thermal');
      setPrintResult(null);
    }
  }, [isOpen]);

  const formatDate = (date: string) => new Date(date).toLocaleString(locale);
  const formatDateShort = (date: string) => new Date(date).toLocaleDateString(locale);

  const handlePrint = async (format: 'thermal' | 'pdf' | 'a4') => {
    if (!invoice) return;
    setIsPrinting(true);
    try {
      await onPrint(format);
      setPrintResult({ success: true, message: t('pos.success.receiptPrinted') });
    } catch (e) {
      console.error('Print failed:', e);
      setPrintResult({ success: false, message: t('pos.errors.printFailed') });
    } finally {
      setIsPrinting(false);
    }
  };

  const downloadPDF = async () => {
    if (!invoice || !previewRef.current) return;
    try {
      const { default: html2pdf } = await import('html2pdf.js');
      const pageFormat: string | [number, number] = printFormat === 'a4' ? 'a4' : printFormat === 'thermal' ? [58, 297] : [80, 297];
      // Temporarily expand the container so html2canvas captures the full receipt
      // instead of clipping at the modal's 60vh scrollable area.
      const container = previewRef.current.parentElement;
      const prevOverflow = container?.style.overflow;
      const prevMaxHeight = container?.style.maxHeight;
      if (container) {
        container.style.overflow = 'visible';
        container.style.maxHeight = 'none';
      }
      try {
        await html2pdf()
          .from(previewRef.current)
          .set({
            margin: 5,
            filename: `receipt-${invoice.invoiceNumber}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'mm', format: pageFormat, orientation: 'portrait' },
          })
          .save();
      } finally {
        if (container) {
          container.style.overflow = prevOverflow ?? '';
          container.style.maxHeight = prevMaxHeight ?? '';
        }
      }
    } catch (e) {
      console.error('PDF download failed:', e);
    }
  };

  if (!isOpen || !invoice) return null;

  const paymentLabels = invoice.paymentMethods.map(m => t((PAYMENT_LABELS[m] || m) as TranslationKey)).join(', ');

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="receipt-title">
      <div className="modal receipt-preview-modal" onClick={e => e.stopPropagation()}>
        <header>
          <h2 id="receipt-title">{t('pos.receipt.preview')}</h2>
          <div className="header-actions">
            <select
              value={printFormat}
              onChange={(e) => setPrintFormat(e.target.value as 'thermal' | 'pdf' | 'a4')}
              className="format-select"
              aria-label={t('pos.receipt.format')}
            >
              <option value="thermal">{t('pos.receipt.thermal58')}</option>
              <option value="pdf">{t('pos.receipt.pdf')}</option>
              <option value="a4">{t('pos.receipt.a4')}</option>
            </select>
            <button className="download-btn" onClick={downloadPDF} aria-label={t('pos.receipt.downloadPDF')} disabled={isPrinting}>
              <Download size={16} />
              <span>{t('pos.receipt.downloadPDF')}</span>
            </button>
            <button className="close-btn" onClick={onClose} aria-label={t('common.close')}>
              <X size={20} />
            </button>
          </div>
        </header>

        {printResult && (
          <div className={`print-result ${printResult.success ? 'success' : 'error'}`} role="alert">
            <span>{printResult.success ? <CheckCircle size={16} /> : <AlertCircle size={16} />}</span>
            <span>{printResult.message}</span>
            <button onClick={() => setPrintResult(null)} aria-label={t('common.close')}>
              <X size={16} />
            </button>
          </div>
        )}

        <div className="receipt-preview-container">
          <div
            ref={previewRef}
            className={`receipt-preview ${printFormat === 'a4' ? 'a4' : printFormat === 'thermal' ? 'thermal-58' : 'thermal-80'}`}
            style={{ width: printFormat === 'a4' ? '210mm' : printFormat === 'thermal' ? '58mm' : '80mm', maxWidth: '100%' }}
            dir="rtl"
          >
            {/* Receipt Header */}
            <div className="receipt-header">
              <div className="pharmacy-name">صيدلية</div>
              <div className="pharmacy-address">شارع الملك فهد، الرياض</div>
              <div className="pharmacy-phone">
                <Phone size={11} /> 011-234-5678
              </div>
              <div className="pharmacy-vat">الرقم الضريبي: 300000000000003</div>
              <hr />
            </div>

            {/* Invoice Info */}
            <div className="receipt-info">
              <div><strong>{t('pos.receipt.invoiceNo')}: </strong>{invoice.invoiceNumber}</div>
              <div><strong>{t('pos.receipt.date')}: </strong>{formatDate(invoice.createdAt)}</div>
              <div><strong>{t('pos.receipt.cashier')}: </strong>{invoice.cashierName || invoice.cashierId}</div>
              {invoice.warehouseNameAr && (
                <div><strong>{t('pos.receipt.warehouse')}: </strong>{invoice.warehouseNameAr}</div>
              )}
              {invoice.customer && (
                <div>
                  <strong>{t('pos.receipt.customer')}: </strong>
                  {invoice.customer.name + (invoice.customer.phone ? ` (${invoice.customer.phone})` : '')}
                </div>
              )}
              {invoice.note && (
                <div><strong>{t('pos.receipt.note')}: </strong>{invoice.note}</div>
              )}
              <hr />
            </div>

            {/* Items */}
            <div className="receipt-items">
              {invoice.items.map((item) => (
                <div key={item.id} className="receipt-item">
                  <div className="item-header">
                    <span>{item.product.nameAr}</span>
                    <span>{formatEGP(item.lineTotal, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>
                  </div>
                  <div className="item-details">
                    {item.product.strength && item.product.dosageForm && (
                      <span>{item.product.strength} {item.product.dosageForm}</span>
                    )}
                    {item.product.packSize && <span>• {item.product.packSize}</span>}
                    <span>× {item.quantity}</span>
                    <span>@ {formatEGP(item.unitPrice, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>
                    {Number(item.discount) > 0 && <span className="discount">−{formatEGP(item.discount, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>}
                    {item.batch.lotNumber && <span className="batch">Batch: {item.batch.lotNumber}</span>}
                    {item.batch.expiryDate && <span className="expiry">Exp: {formatDateShort(item.batch.expiryDate)}</span>}
                  </div>
                </div>
              ))}
            </div>

            <hr />

            {/* Totals */}
            <div className="receipt-totals">
              <div><span>{t('pos.receipt.subtotal')}</span><span>{formatEGP(invoice.subtotal, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span></div>
              {Number(invoice.itemDiscount) > 0 && <div><span>{t('pos.receipt.itemDiscount')}</span><span>−{formatEGP(invoice.itemDiscount, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span></div>}
              {Number(invoice.invoiceDiscount) > 0 && <div><span>{t('pos.receipt.invoiceDiscount')}</span><span>−{formatEGP(invoice.invoiceDiscount, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span></div>}
              <div><span>{t('pos.receipt.tax')}</span><span>{formatEGP(invoice.taxAmount, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span></div>
              <div className="grand-total"><span>{t('pos.receipt.total')}</span><span>{formatEGP(invoice.total, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span></div>
            </div>

            <hr />

            {/* Payment */}
            <div className="receipt-payment">
              <div><strong>{t('pos.receipt.paymentMethod')}:</strong> {paymentLabels}</div>
              {invoice.payments && invoice.payments.length > 1 && (
                <div className="payment-breakdown">
                  {invoice.payments.map((p, i) => (
                    <div key={i}><span>{t((PAYMENT_LABELS[p.method] || p.method) as TranslationKey)}</span><span>{formatEGP(p.amount, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>{p.reference && <span>({p.reference})</span>}</div>
                  ))}
                </div>
              )}
            </div>

            <hr />

            {/* Footer */}
            <div className="receipt-footer">
              <p>{t('pos.receipt.thankYou')}</p>
              <p>{t('pos.receipt.returnPolicy')}</p>
              <p className="vat">VAT: {Number(invoice.taxAmount) > 0 ? '15%' : '0%'}</p>
              <p className="invoice-copy">{t('pos.receipt.copy')}</p>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={isPrinting}>
            {t('pos.receipt.close')}
          </button>
          <button
            className="btn-primary"
            onClick={() => handlePrint(printFormat)}
            disabled={isPrinting}
          >
            {isPrinting ? (
              <>
                <Loader2 className="spin" size={18} />
                {t('pos.receipt.printing')}
              </>
            ) : (
              <>
                <Printer size={18} />
                {t('pos.receipt.print')} ({printFormat === 'thermal' ? '58mm' : printFormat === 'a4' ? 'A4' : '80mm'})
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}