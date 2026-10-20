import { useState, useEffect, useCallback } from 'react';
import { CreditCard, Smartphone, Banknote, Landmark, Plus, X, CheckCircle, AlertTriangle, Loader2, Award } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { sumCurrency, roundCurrency, formatEGP } from '@pharmacy/shared';
import type { TranslationKey } from '../../i18n/dictionaries';

interface PaymentAllocation {
  method: string;
  amount: string;
  reference?: string;
}

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  total: string;
  paymentMethods: string[];
  paymentAllocations: PaymentAllocation[];
  onUpdateAllocations: (allocations: PaymentAllocation[]) => void;
  onComplete: (allocations: PaymentAllocation[], pointsUsed?: number) => Promise<void>;
  customer?: { id: string; name: string; creditLimit: string; currentBalance: string; loyaltyPoints: number } | null;
  isProcessing?: boolean;
}

const PAYMENT_METHODS = [
  { id: 'cash', label: 'pos.payment.cash', icon: Banknote, color: 'text-success', requiresAmount: true, requiresReference: false },
  { id: 'card', label: 'pos.payment.card', icon: CreditCard, color: 'text-blue-600', requiresAmount: true, requiresReference: true },
  { id: 'wallet', label: 'pos.payment.wallet', icon: Smartphone, color: 'text-purple-600', requiresAmount: true, requiresReference: true },
  { id: 'credit', label: 'pos.payment.credit', icon: Landmark, color: 'text-orange-600', requiresAmount: true, requiresReference: false },
];

/** 100 loyalty points = 1 EGP discount. */
const POINTS_REDEMPTION_RATE = 100;

export function PaymentModal({
  isOpen,
  onClose,
  total,
  paymentMethods,
  paymentAllocations,
  onUpdateAllocations,
  onComplete,
  customer,
  isProcessing = false,
}: PaymentModalProps) {
  const { t, locale } = useI18n();
  const [allocations, setAllocations] = useState<PaymentAllocation[]>(paymentAllocations);
  const [activeTab, setActiveTab] = useState<string>(paymentMethods[0] || 'cash');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showConfirm, setShowConfirm] = useState(false);
  const [pointsToUse, setPointsToUse] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setAllocations(paymentAllocations.length > 0 ? paymentAllocations : [{ method: 'cash', amount: total }]);
      setActiveTab(paymentMethods[0] || 'cash');
      setErrors({});
      setShowConfirm(false);
      setPointsToUse(0);
    }
  }, [isOpen, paymentAllocations, paymentMethods, total]);

  useEffect(() => {
    onUpdateAllocations(allocations);
  }, [allocations, onUpdateAllocations]);

  const customerPoints = customer?.loyaltyPoints ?? 0;
  const pointsDiscount = roundCurrency(Number(pointsToUse) / POINTS_REDEMPTION_RATE);
  const maxPointsUsable = Math.min(customerPoints, Number(total) * POINTS_REDEMPTION_RATE);

  const paidTotal = sumCurrency(allocations
    .map(a => a.amount)
    .filter(v => v !== '' && !isNaN(Number(v)))
  );
  const remainingAfterPoints = roundCurrency(Number(total) - Number(pointsDiscount));
  const remaining = roundCurrency(Number(remainingAfterPoints) - Number(paidTotal));
  const isValid = Number(remaining) <= 0.01 && allocations.every(a => Number(a.amount) > 0);

  /** Cash actually handed over (an amount cleared mid-typing counts as 0). */
  const cashPaid = allocations.reduce(
    (sum, a) => (a.method === 'cash' ? sum + (Number(a.amount) || 0) : sum),
    0
  );
  /**
   * Change to hand back: the cash received minus the share of the bill cash
   * has to cover. Giving change on an over-tendered note is a normal cash
   * sale — only an overpayment cash cannot explain (e.g. an over-tapped
   * card) stays an error.
   */
  const nonCashPaid = Math.max(Number(paidTotal) - cashPaid, 0);
  const changeDue = roundCurrency(
    Math.max(cashPaid - Math.max(Number(remainingAfterPoints) - nonCashPaid, 0), 0)
  );
  const isOverpaid =
    Number(paidTotal) > Number(remainingAfterPoints) + 0.01 &&
    Number(paidTotal) - Number(remainingAfterPoints) > Number(changeDue) + 0.01;

  const canUseCredit = customer && Number(customer.creditLimit) > 0 && Number(customer.currentBalance) < Number(customer.creditLimit);
  const availableCredit = customer ? roundCurrency(Number(customer.creditLimit) - Number(customer.currentBalance)) : '0.00';

  const validateAllocations = useCallback(() => {
    const newErrors: Record<string, string> = {};
    allocations.forEach((alloc, index) => {
      const config = getMethodConfig(alloc.method);
      if (Number(alloc.amount) <= 0) {
        newErrors[`amount-${index}`] = t('pos.errors.invalidAmount');
      }
      if ((alloc.method === 'card' || alloc.method === 'wallet') && config.requiresReference && !alloc.reference?.trim()) {
        newErrors[`ref-${index}`] = t('pos.errors.referenceRequired');
      }
      if (alloc.method === 'credit' && !canUseCredit) {
        newErrors[`method-${index}`] = t('pos.errors.creditNotAvailable');
      }
      if (alloc.method === 'credit' && Number(alloc.amount) > Number(availableCredit)) {
        newErrors[`amount-${index}`] = t('pos.errors.exceedsCreditLimit', { limit: formatEGP(availableCredit, locale === 'ar' ? 'ar-EG' : 'en-EG') });
      }
    });
    if (Number(remaining) > 0.01) {
      newErrors.remaining = t('pos.errors.remainingBalance', { amount: formatEGP(remaining, locale === 'ar' ? 'ar-EG' : 'en-EG') });
    }
    if (isOverpaid) {
      newErrors.overpaid = t('pos.errors.overpaid', { amount: formatEGP(roundCurrency(Number(paidTotal) - Number(remainingAfterPoints)), locale === 'ar' ? 'ar-EG' : 'en-EG') });
    }
    if (pointsToUse > customerPoints) {
      newErrors.points = t('pos.payment.insufficientPoints');
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [allocations, remaining, isOverpaid, canUseCredit, availableCredit, total, paidTotal, locale, pointsToUse, customerPoints, pointsDiscount, remainingAfterPoints]);

  const updateAllocation = (index: number, field: 'method' | 'amount' | 'reference', value: string) => {
    setAllocations(prev => prev.map((a, i) => i === index ? { ...a, [field]: value } : a));
    if (errors[`${field}-${index}`]) {
      setErrors(prev => { const next = { ...prev }; delete next[`${field}-${index}`]; return next; });
    }
  };

  const updatePointsToUse = (value: string) => {
    const num = Math.floor(Number(value) || 0);
    setPointsToUse(Math.max(0, Math.min(num, maxPointsUsable)));
    if (errors.points) {
      setErrors(prev => { const next = { ...prev }; delete next.points; return next; });
    }
  };

  const addAllocation = () => {
    if (Number(remaining) > 0) {
      setAllocations(prev => [...prev, { method: paymentMethods[0] || 'cash', amount: remaining }]);
    }
  };

  const removeAllocation = (index: number) => {
    if (allocations.length > 1) {
      setAllocations(prev => prev.filter((_, i) => i !== index));
    }
  };

  const handleComplete = async () => {
    if (!validateAllocations()) return;
    setShowConfirm(true);
  };

  const confirmPayment = async () => {
    setShowConfirm(false);
    try {
      await onComplete(allocations, pointsToUse > 0 ? pointsToUse : undefined);
      onClose();
    } catch (e) {
      console.error('Payment failed:', e);
    }
  };

  const getMethodConfig = (methodId: string) => PAYMENT_METHODS.find(m => m.id === methodId) || PAYMENT_METHODS[0];

  const hasCustomer = !!customer;
  const canRedeemPoints = hasCustomer && customerPoints > 0 && Number(total) > 0;

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="payment-title">
      <div className="modal payment-modal" onClick={e => e.stopPropagation()}>
        <header>
          <h2 id="payment-title">{t('pos.payment.title')}</h2>
          <button className="close-btn" onClick={onClose} aria-label={t('common.close')}>
            <X size={20} />
          </button>
        </header>

        {hasCustomer && (
          <div className="customer-info">
            <div className="info-row">
              <span>{t('pos.payment.customerPoints')}</span>
              <strong>{customerPoints}</strong>
            </div>
            <div className="info-row">
              <span>{t('pos.payment.pointsBalance')}</span>
              <strong>{formatEGP(customerPoints / POINTS_REDEMPTION_RATE, locale === 'ar' ? 'ar-EG' : 'en-EG')} value</strong>
            </div>
          </div>
        )}

        <div className="payment-total">
          <span>{t('pos.payment.total')}</span>
          <strong>{formatEGP(total, locale === 'ar' ? 'ar-EG' : 'en-EG')}</strong>
        </div>

        {canRedeemPoints && (
          <div className="points-redemption">
            <div className="points-rate">
              <Award size={16} />
              <span>{t('pos.payment.pointsRate', { rate: POINTS_REDEMPTION_RATE, amount: formatEGP('1.00', locale === 'ar' ? 'ar-EG' : 'en-EG') })}</span>
            </div>
            <div className="points-input-row">
              <label>{t('pos.payment.pointsToUse')}</label>
              <input
                type="number"
                inputMode="numeric"
                value={pointsToUse}
                onChange={(e) => updatePointsToUse(e.target.value)}
                min="0"
                max={maxPointsUsable}
                step="1"
                className={`points-input ${errors.points ? 'error' : ''}`}
                placeholder="0"
                aria-label={t('pos.payment.pointsToUse')}
                aria-invalid={!!errors.points}
              />
              <span className="points-max">(max {maxPointsUsable})</span>
            </div>
            <div className="points-discount">
              <span>{t('pos.payment.pointsDiscount')}</span>
              <strong className="discount-amount">−{formatEGP(pointsDiscount, locale === 'ar' ? 'ar-EG' : 'en-EG')}</strong>
            </div>
            {errors.points && <span className="error-message">{errors.points}</span>}
          </div>
        )}

        <div className="payment-method-tabs" role="tablist">
          {paymentMethods.map(method => {
            const config = getMethodConfig(method);
            const Icon = config.icon;
            const disabled = method === 'credit' && !canUseCredit;
            return (
              <button
                key={method}
                role="tab"
                aria-selected={activeTab === method}
                className={`method-tab ${activeTab === method ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
                onClick={() => !disabled && setActiveTab(method)}
                disabled={disabled}
              >
                <span className="tab-icon" style={{ color: `var(--${config.color.replace('text-', '')})` }}>
                  <Icon size={18} />
                </span>
                <span>{t(config.label as TranslationKey)}</span>
                {disabled && <AlertTriangle size={12} className="tab-warning" />}
              </button>
            );
          })}
        </div>

        <div className="payments-list" role="list">
          {allocations.map((payment, index) => {
            const config = getMethodConfig(payment.method);
            const errorKey = `amount-${index}`;
            const refErrorKey = `ref-${index}`;
            return (
              <div key={index} className="payment-row" role="listitem">
                <select
                  value={payment.method}
                  onChange={(e) => updateAllocation(index, 'method', e.target.value)}
                  className="method-select"
                  disabled={allocations.length === 1}
                  aria-label={t('pos.payment.method')}
                >
                  {paymentMethods.map(m => (
                    <option key={m} value={m}>{t(getMethodConfig(m).label as TranslationKey)}</option>
                  ))}
                </select>
                <input
                  type="number"
                  inputMode="numeric"
                  value={payment.amount ?? ''}
                  onChange={(e) => updateAllocation(index, 'amount', e.target.value)}
                  onBlur={() => {
                    // Normalise on blur only: re-formatting on every keystroke
                    // would rewrite the field mid-typing (amount never sticks).
                    const raw = allocations[index]?.amount ?? '';
                    if (raw !== '' && Number.isFinite(Number(raw))) {
                      const normalized = Number(raw).toFixed(2);
                      if (normalized !== raw) updateAllocation(index, 'amount', normalized);
                    }
                  }}
                  min="0"
                  step="0.01"
                  className={`amount-input ${errors[errorKey] ? 'error' : ''}`}
                  placeholder={t('pos.payment.amount')}
                  aria-label={t('pos.payment.amount')}
                  aria-invalid={!!errors[errorKey]}
                  aria-describedby={errors[errorKey] ? `error-${errorKey}` : undefined}
                />
                {errors[errorKey] && <span id={`error-${errorKey}`} className="error-message">{errors[errorKey]}</span>}
                {config.requiresReference && (
                  <>
                    <input
                      type="text"
                      value={payment.reference || ''}
                      onChange={(e) => updateAllocation(index, 'reference', e.target.value)}
                      placeholder={t('pos.payment.reference')}
                      className={`reference-input ${errors[refErrorKey] ? 'error' : ''}`}
                      aria-label={t('pos.payment.reference')}
                      aria-invalid={!!errors[refErrorKey]}
                      aria-describedby={errors[refErrorKey] ? `error-${refErrorKey}` : undefined}
                    />
                    {errors[refErrorKey] && <span id={`error-${refErrorKey}`} className="error-message">{errors[refErrorKey]}</span>}
                  </>
                )}
                {allocations.length > 1 && (
                  <button className="remove-payment" onClick={() => removeAllocation(index)} aria-label={t('common.cancel')}>
                    <X size={16} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {Number(remaining) > 0.01 && (
          <button className="add-payment-btn" onClick={addAllocation}>
            <Plus size={16} />
            {t('pos.payment.addMethod', { amount: formatEGP(remaining, locale === 'ar' ? 'ar-EG' : 'en-EG') })}
          </button>
        )}

        <div className="payment-summary">
          <div className="summary-row">
            <span>{t('pos.payment.total')}</span>
            <span>{formatEGP(total, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>
          </div>
          {canRedeemPoints && Number(pointsDiscount) > 0 && (
            <div className="summary-row points-summary">
              <span>{t('pos.payment.pointsDiscount')}</span>
              <span className="discount">−{formatEGP(pointsDiscount, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>
            </div>
          )}
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
          {Number(changeDue) > 0 && (
            <div className="summary-row change-row">
              <span>{t('pos.totals.changeDue')}</span>
              <span className="change-amount">{formatEGP(changeDue, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>
            </div>
          )}
          {isOverpaid && (
            <div className="summary-row overpaid" role="alert">
              <AlertTriangle size={14} />
              <span>{t('pos.errors.overpaid', { amount: formatEGP(roundCurrency(Number(paidTotal) - Number(remainingAfterPoints)), locale === 'ar' ? 'ar-EG' : 'en-EG') })}</span>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={isProcessing}>
            {t('pos.payment.cancel')}
          </button>
          <button
            className="btn-primary"
            onClick={handleComplete}
            disabled={!isValid || isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader2 className="spin" size={18} />
                {t('pos.checkout.processing')}
              </>
            ) : (
              t('pos.payment.confirm')
            )}
          </button>
        </div>

        {showConfirm && (
          <div className="confirm-overlay" onClick={() => setShowConfirm(false)}>
            <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
              <div className="confirm-icon">
                <CheckCircle size={48} />
              </div>
              <h3>{t('pos.payment.confirmTitle')}</h3>
              <p>{t('pos.payment.confirmMessage', { amount: formatEGP(total, locale === 'ar' ? 'ar-EG' : 'en-EG') })}</p>
              <div className="confirm-breakdown">
                {allocations.map((alloc, index) => (
                  <div key={index} className="confirm-row">
                    <span>{t(getMethodConfig(alloc.method).label as TranslationKey)}</span>
                    <span>{formatEGP(alloc.amount, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>
                  </div>
                ))}
                {canRedeemPoints && Number(pointsDiscount) > 0 && (
                  <div className="confirm-row points-row">
                    <span>{t('pos.payment.pointsDiscount')}</span>
                    <span className="discount">−{formatEGP(pointsDiscount, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>
                  </div>
                )}
                <div className="confirm-row total-row">
                  <span>{t('pos.payment.total')}</span>
                  <strong>{formatEGP(total, locale === 'ar' ? 'ar-EG' : 'en-EG')}</strong>
                </div>
              </div>
              <div className="confirm-actions">
                <button className="btn-secondary" onClick={() => setShowConfirm(false)}>
                  {t('common.cancel')}
                </button>
                <button className="btn-primary" onClick={confirmPayment} disabled={isProcessing}>
                  {isProcessing ? (
                    <>
                      <Loader2 className="spin" size={18} />
                      {t('pos.checkout.processing')}
                    </>
                  ) : (
                    t('pos.payment.confirmFinal')
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
