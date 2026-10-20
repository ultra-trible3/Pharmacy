/**
 * Printable invoice sheet portaled onto `<body>` so the print stylesheet can
 * hide every other body child and print this invoice alone.
 */

import { type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { PaymentDto, SaleDto, SaleItemDto } from '../../lib/api';
import { formatMoney } from '../../lib/format';

interface InvoicePrintSheetProps {
  invoice: SaleDto;
  locale: string;
}

function fmt(value: string | number | null | undefined): string {
  return formatMoney(value, 'ar-EG');
}

function paymentLabel(method: string): string {
  const map: Record<string, string> = {
    cash: 'نقدي',
    card: 'بطاقة',
    wallet: 'محفظة',
    credit: 'آجل',
  };
  return map[method] ?? method;
}

export function InvoicePrintSheet({ invoice, locale }: InvoicePrintSheetProps): ReactElement {
  const moneyLocale = locale === 'ar' ? 'ar-EG' : 'en-EG';

  const itemsHtml = invoice.items
    .map(
      (item: SaleItemDto) => `
      <tr>
        <td style="border:1px solid #ddd;padding:6px;text-align:right">${item.product?.nameAr ?? '—'}</td>
        <td style="border:1px solid #ddd;padding:6px;text-align:center">${item.quantity}</td>
        <td style="border:1px solid #ddd;padding:6px;text-align:right">${fmt(item.unitPrice)}</td>
        <td style="border:1px solid #ddd;padding:6px;text-align:right">${fmt(item.lineTotal)}</td>
      </tr>
    `,
    )
    .join('');

  const paymentsHtml = invoice.payments
    .map(
      (p: PaymentDto) => `
      <tr>
        <td style="border:1px solid #ddd;padding:6px;text-align:right">${paymentLabel(p.method)}</td>
        <td style="border:1px solid #ddd;padding:6px;text-align:right">${fmt(p.amount)}</td>
        ${p.reference ? `<td style="border:1px solid #ddd;padding:6px;text-align:right">(${p.reference})</td>` : '<td></td>'}
      </tr>
    `,
    )
    .join('');

  const moneyFmt = (v: string | number) =>
    new Intl.NumberFormat(moneyLocale, {
      style: 'currency',
      currency: 'EGP',
      minimumFractionDigits: 2,
    }).format(Number(v));

  return createPortal(
    <div className="invoice-print-root">
      <div className="invoice-print-body">
        <div className="invoice-header">
          <div className="invoice-title">صيدلية</div>
          <div className="invoice-subtitle">فاتورة مبيعات</div>
          <div className="invoice-number">رقم الفاتورة: {invoice.invoiceNumber}</div>
          <div className="invoice-date">
            التاريخ: {new Date(invoice.createdAt).toLocaleString(locale)}
          </div>
        </div>

        <table className="invoice-info-table">
          <tbody>
            <tr>
              <td><strong>العميل:</strong></td>
              <td>{invoice.customer?.name ?? 'عميل نقدي'}</td>
              <td><strong>الكاشير:</strong></td>
              <td>{invoice.user?.fullName ?? '—'}</td>
            </tr>
          </tbody>
        </table>

        <table className="invoice-items-table">
          <thead>
            <tr>
              <th>المنتج</th>
              <th>الكمية</th>
              <th>سعر الوحدة</th>
              <th>الإجمالي</th>
            </tr>
          </thead>
          <tbody dangerouslySetInnerHTML={{ __html: itemsHtml }} />
        </table>

        <table className="invoice-totals-table">
          <tbody>
            <tr>
              <td><strong>المجموع الفرعي:</strong></td>
              <td>{moneyFmt(invoice.subtotal)}</td>
            </tr>
            <tr>
              <td><strong>إجمالي الخصم:</strong></td>
              <td>{moneyFmt(invoice.itemDiscount)}</td>
            </tr>
            <tr>
              <td><strong>ضريبة القيمة المضافة:</strong></td>
              <td>{moneyFmt(invoice.taxAmount)}</td>
            </tr>
            <tr className="invoice-total-row">
              <td><strong>الإجمالي:</strong></td>
              <td>{moneyFmt(invoice.total)}</td>
            </tr>
          </tbody>
        </table>

        <table className="invoice-payments-table">
          <thead>
            <tr>
              <th>طريقة الدفع</th>
              <th>المبلغ</th>
              <th>المرجع</th>
            </tr>
          </thead>
          <tbody dangerouslySetInnerHTML={{ __html: paymentsHtml }} />
        </table>

        {invoice.note && (
          <div className="invoice-note">
            <strong>ملاحظة:</strong> {invoice.note}
          </div>
        )}

        <div className="invoice-footer">
          شكرًا لزيارتكم — {invoice.invoiceNumber}
        </div>
      </div>
    </div>,
    document.body,
  );
}
