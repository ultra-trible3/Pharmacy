import { useI18n } from '../../i18n/useI18n';

interface CheckoutActionsProps {
  total: number;
  cartCount: number;
  isProcessing: boolean;
  onCheckout: () => void;
  onPrintPreview: () => void;
  onReprint: () => void;
  onCompleteWithoutPrint: () => void;
}

export function CheckoutActions({
  cartCount,
  isProcessing,
  onCheckout,
  onPrintPreview,
  onReprint,
  onCompleteWithoutPrint,
}: CheckoutActionsProps) {
  const { t } = useI18n();

  return (
    <section className="checkout-actions-block">
      <button
        className="btn-primary checkout-btn"
        onClick={onCheckout}
        disabled={cartCount === 0 || isProcessing}
      >
        {isProcessing ? t('pos.checkout.processing') : t('pos.checkout.confirmAndPrint')}
      </button>

      <div className="secondary-actions">
        <button
          className="btn-secondary"
          onClick={onCompleteWithoutPrint}
          disabled={cartCount === 0 || isProcessing}
        >
          {t('pos.checkout.completeWithoutPrint')}
        </button>
        <button
          className="btn-secondary"
          onClick={onPrintPreview}
          disabled={cartCount === 0}
        >
          {t('pos.checkout.previewReceipt')}
        </button>
        <button
          className="btn-secondary"
          onClick={onReprint}
        >
          {t('pos.checkout.reprint')}
        </button>
      </div>

      <div className="shortcut-hints">
        <kbd>F4</kbd> {t('pos.checkout.shortcut')}
      </div>
    </section>
  );
}