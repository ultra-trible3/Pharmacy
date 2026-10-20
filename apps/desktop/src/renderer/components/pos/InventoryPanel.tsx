import { useI18n } from '../../i18n/useI18n';
import { AlertTriangle, Clock, Package, TrendingUp, Warehouse, AlertCircle, Info } from 'lucide-react';
import { formatEGP } from '@pharmacy/shared';
import type { ProductListItem } from '@pharmacy/shared';
import type { TranslationKey } from '../../i18n/dictionaries';

interface Batch {
  id: string;
  lotNumber: string;
  expiryDate: string;
  quantity: number;
  costPrice: string;
  salePrice: string | null;
  warehouseId: string;
  warehouseNameAr: string;
  manufactureDate: string | null;
  daysToExpiry: number;
  isExpired: boolean;
  isNearExpiry: boolean;
  stockValue: string;
}

interface InventoryPanelProps {
  product: ProductListItem | null;
  batches: Batch[];
}

export function InventoryPanel({ product, batches }: InventoryPanelProps) {
  const { t, locale } = useI18n();

  if (!product) {
    return (
      <section className="inventory-panel">
        <div className="panel-empty">
          <Package size={48} className="icon" />
          <p>{t('pos.inventory.selectProduct')}</p>
        </div>
      </section>
    );
  }

  const totalStock = batches.reduce((sum, b) => sum + b.quantity, 0);
  const expiredBatches = batches.filter(b => b.isExpired && b.quantity > 0);
  const expiringBatches = batches.filter(b => b.isNearExpiry && !b.isExpired && b.quantity > 0);
  const lowStock = totalStock > 0 && totalStock <= product.minStock;
  const outOfStock = totalStock === 0;

  const nearestExpiry = batches
    .filter(b => b.quantity > 0 && !b.isExpired)
    .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())[0];

  const stockByWarehouse = batches.reduce((acc, batch) => {
    if (!acc[batch.warehouseId]) {
      acc[batch.warehouseId] = { name: batch.warehouseNameAr, quantity: 0, value: '0.00' };
    }
    acc[batch.warehouseId].quantity += batch.quantity;
    acc[batch.warehouseId].value = (Number(acc[batch.warehouseId].value) + Number(batch.stockValue)).toFixed(2);
    return acc;
  }, {} as Record<string, { name: string; quantity: number; value: string }>);

  const formatDate = (date: string) => new Date(date).toLocaleDateString(locale);

  return (
    <section className="inventory-panel">
      <header className="panel-header">
        <h2>{t('pos.inventory.title')}</h2>
        <span className="product-name">{product.nameAr}</span>
      </header>

      <div className="panel-content">
        <div className="alerts-section">
          {product.prescriptionClass === 'PRESCRIPTION' && (
            <div className="alert prescription" role="alert">
              <AlertCircle size={16} />
              <span>{t('pos.inventory.prescriptionRequired')}</span>
            </div>
          )}
          {product.prescriptionClass === 'CONTROLLED' && (
            <div className="alert controlled" role="alert">
              <AlertCircle size={16} className="controlled-icon" />
              <span>{t('pos.inventory.controlledSubstance')}</span>
            </div>
          )}
          {expiredBatches.length > 0 && (
            <div className="alert error" role="alert">
              <AlertTriangle size={16} />
              <span>{t('pos.inventory.expiredBatches', { count: expiredBatches.length })}</span>
            </div>
          )}
          {expiringBatches.length > 0 && (
            <div className="alert warning" role="alert">
              <Clock size={16} />
              <span>{t('pos.inventory.expiringSoon', { count: expiringBatches.length })}</span>
            </div>
          )}
          {lowStock && (
            <div className="alert warning" role="alert">
              <Package size={16} />
              <span>{t('pos.inventory.lowStock', { current: totalStock, min: product.minStock })}</span>
            </div>
          )}
          {outOfStock && (
            <div className="alert error" role="alert">
              <Package size={16} />
              <span>{t('pos.inventory.outOfStock')}</span>
            </div>
          )}
        </div>

        <div className="info-grid">
          <div className="info-item">
            <label>{t('pos.inventory.availableQty')}</label>
            <span className={`value ${outOfStock ? 'critical' : lowStock ? 'low' : 'good'}`}>
              {totalStock} {t('pos.inventory.units')}
            </span>
          </div>
          <div className="info-item">
            <label>{t('pos.inventory.minStock')}</label>
            <span className="value">{product.minStock}</span>
          </div>
          <div className="info-item">
            <label>{t('pos.inventory.salePrice')}</label>
            <span className="value price">{formatEGP(product.salePrice, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>
          </div>
          <div className="info-item">
            <label>{t('pos.inventory.costPrice')}</label>
            <span className="value cost">{formatEGP(product.costPrice, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>
          </div>
          <div className="info-item">
            <label>{t('pos.inventory.taxRate')}</label>
            <span className="value">{Number(product.taxRate).toFixed(2)}%</span>
          </div>
          <div className="info-item">
            <label>{t('pos.inventory.manufacturer')}</label>
            <span className="value">{product.manufacturer || '—'}</span>
          </div>
          <div className="info-item">
            <label>{t('pos.inventory.activeIngredient')}</label>
            <span className="value">{product.activeIngredient || '—'}</span>
          </div>
          <div className="info-item">
            <label>{t('pos.inventory.category')}</label>
            <span className="value">{product.categoryNameAr || '—'}</span>
          </div>
          <div className="info-item">
            <label>{t('pos.inventory.dosageForm')}</label>
            <span className="value">{t(`dosageForm.${product.dosageForm}` as TranslationKey) || product.dosageForm}</span>
          </div>
          <div className="info-item">
            <label>{t('pos.inventory.strength')}</label>
            <span className="value">{product.strength || '—'}</span>
          </div>
          <div className="info-item">
            <label>{t('pos.inventory.packSize')}</label>
            <span className="value">{product.packSize || '—'}</span>
          </div>
          <div className="info-item">
            <label>{t('pos.inventory.unit')}</label>
            <span className="value">{product.unit || '—'}</span>
          </div>
          <div className="info-item">
            <label>{t('pos.inventory.barcode')}</label>
            <span className="value barcode">{product.barcode || t('pos.inventory.barcodeMissing')}</span>
          </div>
        </div>

        <div className="warehouse-stock">
          <h3>
            <Warehouse size={16} />
            {t('pos.inventory.stockByWarehouse')}
          </h3>
          <div className="warehouse-grid">
            {Object.entries(stockByWarehouse).map(([warehouseId, data]) => (
              <div key={warehouseId} className="warehouse-card">
                <div className="warehouse-name">{data.name}</div>
                <div className="warehouse-qty">{data.quantity} {t('pos.inventory.units')}</div>
                <div className="warehouse-value">{formatEGP(data.value, locale === 'ar' ? 'ar-EG' : 'en-EG')}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="batches-section">
          <h3>
            <Package size={16} />
            {t('pos.inventory.batches')}
            {nearestExpiry && (
              <span className="fefo-indicator">
                <TrendingUp size={12} /> {t('pos.inventory.fefoActive')}
              </span>
            )}
          </h3>
          <div className="batches-table-wrapper">
            <table className="batches-table">
              <thead>
                <tr>
                  <th>{t('pos.inventory.warehouse')}</th>
                  <th>{t('pos.inventory.batchNumber')}</th>
                  <th>{t('pos.inventory.expiryDate')}</th>
                  <th>{t('pos.inventory.manufactureDate')}</th>
                  <th>{t('pos.inventory.quantity')}</th>
                  <th>{t('pos.inventory.purchasePrice')}</th>
                  <th>{t('pos.inventory.salePrice')}</th>
                  <th>{t('pos.inventory.stockValue')}</th>
                  <th>{t('pos.inventory.fefoRank')}</th>
                  <th>{t('pos.inventory.daysToExpiry')}</th>
                </tr>
              </thead>
              <tbody>
                {batches
                  .filter(b => b.quantity > 0)
                  .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())
                  .map((batch, index) => (
                    <tr
                      key={batch.id}
                      className={batch.id === nearestExpiry?.id ? 'fefo-first' : ''}
                    >
                      <td>{batch.warehouseNameAr}</td>
                      <td>{batch.lotNumber}</td>
                      <td className={batch.isExpired ? 'expired' : batch.isNearExpiry ? 'expiring' : ''}>
                        {formatDate(batch.expiryDate)}
                        {batch.isExpired && <AlertTriangle size={12} className="inline-warning" />}
                        {batch.isNearExpiry && !batch.isExpired && <Clock size={12} className="inline-warning" />}
                      </td>
                      <td>{batch.manufactureDate ? formatDate(batch.manufactureDate) : '—'}</td>
                      <td>{batch.quantity}</td>
                      <td>{formatEGP(batch.costPrice, locale === 'ar' ? 'ar-EG' : 'en-EG')}</td>
                      <td>{batch.salePrice ? formatEGP(batch.salePrice, locale === 'ar' ? 'ar-EG' : 'en-EG') : 'â€”'}</td>
                      <td>{formatEGP(batch.stockValue, locale === 'ar' ? 'ar-EG' : 'en-EG')}</td>
                      <td>{index + 1} {index === 0 ? `ðŸ¥‡ ${t('pos.inventory.fefoFirst')}` : ''}</td>
                      <td className={batch.daysToExpiry < 0 ? 'expired' : batch.daysToExpiry <= 30 ? 'expiring' : ''}>
                        {batch.daysToExpiry >= 0 ? `${batch.daysToExpiry} ${t('pos.inventory.days')}` : t('pos.inventory.expired')}
                      </td>
                    </tr>
                  ))}
                {batches.filter(b => b.quantity === 0).length > 0 && (
                  <tr className="empty-batches">
                    <td colSpan={10}>
                      {t('pos.inventory.emptyBatchesHidden')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {product.activeIngredient && (
          <div className="alternatives-section">
            <h3>
              <Info size={16} />
              {t('pos.inventory.alternatives')}
            </h3>
            <p className="hint">{t('pos.inventory.alternativesHint')}</p>
            <div className="alternatives-placeholder">
              {t('pos.inventory.alternativesComingSoon')}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}