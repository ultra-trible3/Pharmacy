import { useState, useEffect, useCallback } from 'react';
import { Clock, Loader2 } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { api } from '../../lib/api';
import { ProductThumb } from '../products/ProductThumb';
import type { ProductListItem } from '@pharmacy/shared';

interface RecentlySoldProps {
  onAddToCart: (product: ProductListItem) => void;
  limit?: number;
}

export function RecentlySold({ onAddToCart, limit = 10 }: RecentlySoldProps) {
  const { t, locale } = useI18n();
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchRecentSales = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await api.sales.getRecentSales({ limit, period: '7d' });
      setProducts(result.items ?? []);
    } catch (e) {
      console.error('Failed to load recent sales:', e);
      setProducts([]);
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchRecentSales();
  }, [fetchRecentSales]);

  if (products.length === 0 && !isLoading) {
    return (
      <section className="recently-sold-block">
        <div className="section-header">
          <h2>
            <Clock className="header-icon" size={18} />
            {t('pos.recentlySold.title')}
          </h2>
        </div>
        <div className="empty-state">
          <Clock size={32} className="empty-icon" />
          <p>{t('pos.recentlySold.empty')}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="recently-sold-block">
      <div className="section-header">
        <h2>
          <Clock className="header-icon" size={18} />
          {t('pos.recentlySold.title')}
        </h2>
      </div>

      {isLoading && (
        <div className="loading-state">
          <Loader2 className="spin" size={24} />
          <span>{t('common.loading')}</span>
        </div>
      )}

      {!isLoading && products.length > 0 && (
        <div className="recent-list" role="list">
          {products.map((product, index) => (
            <article
              key={product.id}
              className="recent-item"
              role="listitem"
              onClick={() => onAddToCart(product)}
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAddToCart(product); } }}
            >
              <div className="recent-rank">#{index + 1}</div>
              <div className="recent-image">
                <ProductThumb
                  productId={product.id}
                  hasImage={product.hasImage}
                  alt={product.nameAr}
                  iconSize={26}
                  placeholderClassName="placeholder-icon"
                />
              </div>
              <div className="recent-info">
                <h4 className="recent-name">{product.nameAr}</h4>
                <p className="recent-meta">
                  {product.strength} {product.dosageForm} • {product.packSize}
                </p>
                <div className="recent-details">
                  <span className="recent-time">
                    <Clock size={12} />
                    {product.lastSoldAt ? new Date(product.lastSoldAt).toLocaleString(locale) : '—'}
                  </span>
                  <span className="recent-qty">×{product.lastQuantity ?? 0}</span>
                  <span className="recent-invoice">#{product.lastInvoiceId?.slice(-6) ?? '—'}</span>
                </div>
              </div>
              <div className="recent-price">
                <span className="price">{Number(product.salePrice).toFixed(2)} {t('currency')}</span>
              </div>
              <button
                className="add-to-cart-btn"
                onClick={(e) => { e.stopPropagation(); onAddToCart(product); }}
                disabled={product.totalStock <= 0}
                aria-label={t('pos.popular.addToCart', { name: product.nameAr })}
              >
                +
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}