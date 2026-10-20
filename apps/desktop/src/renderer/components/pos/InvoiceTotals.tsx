import { useMemo, useState } from 'react';
import { CreditCard, Smartphone, Banknote, Landmark, X, AlertTriangle } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { sumCurrency, roundCurrency, multiplyCurrency, formatEGP } from '@pharmacy/shared';

interface CartItem {
  id: string;
  product: any;
  batch: any;
  quantity: number;
  unitPrice: string;
  discount: string;
  lineTotal: string;
}

interface InvoiceTotalsProps {
  items: CartItem[];
  invoiceDiscount: string;
  onInvoiceDiscountChange: (discount: string) => void;
  customer?: { id: string; name: string; creditLimit: string; currentBalance: string } | null;
  paymentMethods: string[];
  onAddPaymentMethod: (method: string) => void;
  onRemovePaymentMethod: (method: string) => void;
  paymentAllocations: { method: string; amount: string; reference?: string }[];
  onUpdatePaymentAllocation: (index: number, field: 'amount' | 'reference', value: string) => void;
}

const TAX_RATE = '0.15';

/**
 * Raw keystroke text can be temporarily unparseable ("" or "." while a
 * decimal point is being typed). Store anything the shared money helpers
 * accept verbatim and fall back to zero otherwise, so the totals can never
 * crash on a half-typed amount.
 */
function toStorableAmount(raw: string): string {
  return raw.trim() !== '' && Number.isFinite(Number(raw)) ? raw : '0.00';
}

export function InvoiceTotals({
  items,
  invoiceDiscount,
  onInvoiceDiscountChange,
  customer,
  paymentMethods,
  onAddPaymentMethod,
  onRemovePaymentMethod,
  paymentAllocations,
  onUpdatePaymentAllocation,
}: InvoiceTotalsProps) {
  const { t, locale } = useI18n();

  /* Raw keystrokes are mirrored here while an amount field is focused.
     Formatting on every keystroke (Number().toFixed(2)) rewrote the input
     mid-typing, so digits never stuck; fields are normalised on blur. */
  const [amountDrafts, setAmountDrafts] = useState<Record<number, string>>({});
  const [discountDraft, setDiscountDraft] = useState<string | undefined>(undefined);

  const subtotal = useMemo(() => 
    items.reduce((sum, item) => sumCurrency([sum, multiplyCurrency(item.unitPrice, item.quantity)]), '0.00'),
    [items]
  );

  const itemDiscountTotal = useMemo(() =>
    items.reduce((sum, item) => sumCurrency([sum, item.discount]), '0.00'),
    [items]
  );

  const taxableAmount = useMemo(() =>
    roundCurrency(Number(subtotal) - Number(itemDiscountTotal) - Number(invoiceDiscount)),
    [subtotal, itemDiscountTotal, invoiceDiscount]
  );

  const taxAmount = useMemo(() =>
    roundCurrency(Number(taxableAmount) * Number(TAX_RATE)),
    [taxableAmount]
  );

  const total = useMemo(() =>
    roundCurrency(Number(taxableAmount) + Number(taxAmount)),
    [taxableAmount, taxAmount]
  );

  const paidTotal = useMemo(() =>
    paymentAllocations.reduce((sum, p) => sumCurrency([sum, p.amount]), '0.00'),
    [paymentAllocations]
  );

  const remaining = useMemo(() =>
    roundCurrency(Number(total) - Number(paidTotal)),
    [total, paidTotal]
  );

  const changeDue = useMemo(() => {
    const cashAllocation = paymentAllocations.find(p => p.method === 'cash');
    if (!cashAllocation) return '0.00';
    return roundCurrency(Number(cashAllocation.amount) - Number(total));
  }, [paymentAllocations, total]);

  /* Over-tendered cash is change to hand back, not an error — only flag an
     overpayment that the cash on the counter does not explain. */
  const cashCoversChange = Number(changeDue) > 0 && paymentMethods.includes('cash');
  const isOverpaid = Number(paidTotal) > Number(total) + 0.01 && !cashCoversChange;

  const paymentOptions = [
    { id: 'cash', label: t('pos.payment.cash'), icon: Banknote, color: 'text-success' },
    { id: 'card', label: t('pos.payment.card'), icon: CreditCard, color: 'text-blue-600' },
    { id: 'wallet', label: t('pos.payment.wallet'), icon: Smartphone, color: 'text-purple-600' },
    { id: 'credit', label: t('pos.payment.credit'), icon: Landmark, color: 'text-orange-600' },
  ];

  const togglePaymentMethod = (method: string) => {
    if (paymentMethods.includes(method)) {
      onRemovePaymentMethod(method);
    } else {
      onAddPaymentMethod(method);
    }
  };

  const canUseCredit = customer && Number(customer.creditLimit) > 0 && Number(customer.currentBalance) < Number(customer.creditLimit);
  const availableCredit = customer ? roundCurrency(Number(customer.creditLimit) - Number(customer.currentBalance)) : '0.00';

  return (
    <section className="invoice-totals-block">
      <div className="totals-header">
        <h2>{t('pos.totals.title')}</h2>
      </div>

      <div className="totals-breakdown">
        <div className="row">
          <span>{t('pos.totals.subtotal')}</span>
          <span>{formatEGP(subtotal, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>
        </div>
        {Number(itemDiscountTotal) > 0 && (
          <div className="row discount">
            <span>{t('pos.totals.itemDiscount')}</span>
            <span>−{formatEGP(itemDiscountTotal, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>
          </div>
        )}
        <div className="row invoice-discount-row">
          <label>
            {t('pos.totals.invoiceDiscount')}
            <input
              type="number"
              value={discountDraft ?? invoiceDiscount}
              onChange={(e) => {
                const raw = e.target.value;
                setDiscountDraft(raw);
                onInvoiceDiscountChange(toStorableAmount(raw));
              }}
              onBlur={() => {
                if (discountDraft === undefined) return;
                const normalized = discountDraft.trim() !== '' && Number.isFinite(Number(discountDraft))
                  ? Number(discountDraft).toFixed(2)
                  : Number(invoiceDiscount).toFixed(2);
                setDiscountDraft(undefined);
                if (normalized !== invoiceDiscount) onInvoiceDiscountChange(normalized);
              }}
              min="0"
              max={Number(subtotal) - Number(itemDiscountTotal)}
              step="0.01"
              className="discount-input"
              aria-label={t('pos.totals.invoiceDiscount')}
            />
          </label>
          <span>−{formatEGP(invoiceDiscount, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>
        </div>
        <div className="row tax">
          <span>{t('pos.totals.tax')} ({Number(TAX_RATE) * 100}%)</span>
          <span>{formatEGP(taxAmount, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>
        </div>
        <div className="row total-row">
          <span>{t('pos.totals.total')}</span>
          <span className="total-amount">{formatEGP(total, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>
        </div>
      </div>

      {customer && (
        <div className="customer-credit-info">
          <div className="credit-row">
            <span>{t('pos.customer.creditLimit')}</span>
            <span>{formatEGP(customer.creditLimit, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>
          </div>
          <div className="credit-row">
            <span>{t('pos.customer.currentBalance')}</span>
            <span className={Number(customer.currentBalance) > 0 ? 'debit' : 'credit'}>
              {formatEGP(customer.currentBalance, locale === 'ar' ? 'ar-EG' : 'en-EG')}
            </span>
          </div>
          <div className="credit-row available">
            <span>{t('pos.customer.availableCredit')}</span>
            <span className="available-amount">{formatEGP(availableCredit, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>
          </div>
        </div>
      )}

      <div className="payment-section">
        <h3>{t('pos.totals.paymentMethods')}</h3>
        <div className="payment-methods">
          {paymentOptions.map(option => {
            const Icon = option.icon;
            const selected = paymentMethods.includes(option.id);
            const disabled = option.id === 'credit' && !canUseCredit;
            return (
              <label key={option.id} className={`payment-method ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => !disabled && togglePaymentMethod(option.id)}
                  disabled={disabled}
                />
                <span className="method-icon" style={{ color: `var(--${option.color.replace('text-', '')})` }}>
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span>{option.label}</span>
                {disabled && <AlertTriangle size={14} className="method-warning" aria-label={t('pos.errors.creditLimitExceeded')} />}
              </label>
            );
          })}
        </div>

        <div className="payment-allocations">
          {paymentAllocations.map((payment, index) => (
            <div key={index} className="payment-row">
              <select
                value={payment.method}
                onChange={(e) => onUpdatePaymentAllocation(index, 'reference', e.target.value)}
                className="method-select"
                disabled={paymentAllocations.length === 1}
              >
                {paymentMethods.map(m => {
                  const opt = paymentOptions.find(o => o.id === m);
                  return <option key={m} value={m}>{opt?.label || m}</option>;
                })}
              </select>
              <input
                type="number"
                value={amountDrafts[index] ?? Number(payment.amount).toFixed(2)}
                onChange={(e) => {
                  const raw = e.target.value;
                  // Mirror the raw keystrokes; re-formatting here on every
                  // keypress rewrote the field mid-typing, so the typed
                  // amount never stuck. Normalised on blur below.
                  setAmountDrafts(prev => ({ ...prev, [index]: raw }));
                  onUpdatePaymentAllocation(index, 'amount', toStorableAmount(raw));
                }}
                onBlur={() => {
                  const raw = amountDrafts[index];
                  if (raw === undefined) return;
                  const normalized = raw.trim() !== '' && Number.isFinite(Number(raw))
                    ? Number(raw).toFixed(2)
                    : Number(payment.amount).toFixed(2);
                  const next = { ...amountDrafts };
                  delete next[index];
                  setAmountDrafts(next);
                  if (normalized !== payment.amount) {
                    onUpdatePaymentAllocation(index, 'amount', normalized);
                  }
                }}
                min="0"
                step="0.01"
                className="amount-input"
                placeholder={t('pos.payment.amount')}
                aria-label={t('pos.payment.amount')}
              />
              {(payment.method === 'card' || payment.method === 'wallet') && (
                <input
                  type="text"
                  value={payment.reference || ''}
                  onChange={(e) => onUpdatePaymentAllocation(index, 'reference', e.target.value)}
                  placeholder={t('pos.payment.reference')}
                  className="reference-input"
                  aria-label={t('pos.payment.reference')}
                />
              )}
              {paymentAllocations.length > 1 && (
                <button className="remove-payment" onClick={() => onRemovePaymentMethod(payment.method)} aria-label={t('common.cancel')}>
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
        </div>

        {Number(remaining) > 0.01 && paymentMethods.length > 0 && (
          <button className="add-payment-btn" onClick={() => onAddPaymentMethod(paymentMethods[0])}>
            + {t('pos.payment.addMethod', { amount: formatEGP(remaining, locale === 'ar' ? 'ar-EG' : 'en-EG') })}
          </button>
        )}

        <div className="payment-summary">
          <div className="summary-row">
            <span>{t('pos.payment.paid')}</span>
            <span>{formatEGP(paidTotal, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>
          </div>
          <div className="summary-row">
            <span>{t('pos.payment.remaining')}</span>
            <span className={Number(remaining) <= 0.01 ? 'positive' : 'negative'}>
              {formatEGP(remaining, locale === 'ar' ? 'ar-EG' : 'en-EG')}
            </span>
          </div>
          {Number(changeDue) > 0 && paymentMethods.includes('cash') && (
            <div className="summary-row change-row">
              <span>{t('pos.totals.changeDue')}</span>
              <span className="change-amount">{formatEGP(changeDue, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>
            </div>
          )}
        </div>

        {isOverpaid && (
          <div className="overpaid-warning" role="alert">
            <AlertTriangle size={16} />
            <span>{t('pos.errors.overpaid', { amount: formatEGP(roundCurrency(Number(paidTotal) - Number(total)), locale === 'ar' ? 'ar-EG' : 'en-EG') })}</span>
          </div>
        )}
      </div>
    </section>
  );
}