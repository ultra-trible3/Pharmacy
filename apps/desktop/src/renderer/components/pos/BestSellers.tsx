import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, Package, ReceiptText, DollarSign, Loader2, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { api } from '../../lib/api';
import { ProductThumb } from '../products/ProductThumb';
import type { ProductListItem } from '@pharmacy/shared';

interface BestSellersProps {
  onAddToCart: (product: ProductListItem) => void;
  selectedCategoryId: string | null;
}

type Period = 'today' | 'week' | 'month';

export function BestSellers({ onAddToCart, selectedCategoryId }: BestSellersProps) {
  const { t } = useI18n();
  const [period, setPeriod] = useState<Period>('week');
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const pageSize = 8;

  const fetchBestSellers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.sales.getBestSellers({
        period,
        limit: pageSize,
        page: currentPage,
        ...(selectedCategoryId ? { categoryId: selectedCategoryId } : {}),
      });
      setProducts(result.items ?? []);
      setTotalPages(Math.ceil((result.total ?? 0) / pageSize));
    } catch (e) {
      console.error('Failed to load best sellers:', e);
      setError(t('errors.generic'));
      setProducts([]);
    } finally {
      setIsLoading(false);
    }
  }, [period, currentPage, selectedCategoryId]);

  useEffect(() => {
    fetchBestSellers();
  }, [fetchBestSellers]);

  const periodOptions: { value: Period; label: string }[] = [
    { value: 'today', label: t('pos.bestsellers.today') },
    { value: 'week', label: t('pos.bestsellers.week') },
    { value: 'month', label: t('pos.bestsellers.month') },
  ];

  if (products.length === 0 && !isLoading && !error) {
    return (
      <section className="bestsellers-block">
        <div className="section-header">
          <h2>
            <TrendingUp className="header-icon" size={18} />
            {t('pos.bestsellers.title')}
          </h2>
        </div>
        <div className="empty-state">
          <Package size={32} className="empty-icon" />
          <p>{t('pos.bestsellers.noData')}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="bestsellers-block">
      <div className="section-header">
        <h2>
          <TrendingUp className="header-icon" size={18} />
          {t('pos.bestsellers.title')}
        </h2>
        <div className="period-selector" role="group" aria-label={t('pos.bestsellers.byCategory')}>
          {periodOptions.map(opt => (
            <button
              key={opt.value}
              className={`period-btn ${period === opt.value ? 'active' : ''}`}
              onClick={() => { setPeriod(opt.value); setCurrentPage(1); }}
              role="tab"
              aria-selected={period === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="loading-state">
          <Loader2 className="spin" size={24} />
          <span>{t('common.loading')}</span>
        </div>
      )}

      {error && (
        <div className="error-state">
          <p>{error}</p>
          <button className="retry-btn" onClick={fetchBestSellers}>{t('common.retry')}</button>
        </div>
      )}

      {!isLoading && !error && products.length > 0 && (
        <div className="products-grid" role="list">
          {products.map(product => (
            <article
              key={product.id}
              className="product-card bestseller-card"
              role="listitem"
              onClick={() => onAddToCart(product)}
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAddToCart(product); } }}
            >
              <div className="card-rank">
                <span className="rank-badge">{product.rank}</span>
                {product.rank !== undefined && product.rank <= 3 && <TrendingUp className="trending-icon" size={16} />}
              </div>
              <div className="card-image">
                <ProductThumb
                  productId={product.id}
                  hasImage={product.hasImage}
                  alt={product.nameAr}
                  iconSize={26}
                  placeholderClassName="placeholder-icon"
                />
                {product.prescriptionClass === 'PRESCRIPTION' && <span className="badge rx">{t('pos.search.rxOnly')}</span>}
                {product.prescriptionClass === 'CONTROLLED' && <span className="badge controlled">{t('pos.search.controlled')}</span>}
                {product.totalStock <= 0 && <span className="out-of-stock-overlay">{t('pos.popular.outOfStock')}</span>}
              </div>
              <div className="card-content">
                <h3 className="product-name">{product.nameAr}</h3>
                {product.brand && <p className="product-brand">{product.brand}</p>}
                <p className="product-strength">{product.strength} {product.dosageForm}</p>
                <p className="product-package">{product.packSize}</p>
                <div className="card-metrics">
                  <div className="metric">
                    <Package size={12} />
                    <span>{product.unitsSold ?? 0} {t('pos.bestsellers.unitsSold')}</span>
                  </div>
                  <div className="metric">
                    <ReceiptText size={12} />
                    <span>{product.invoicesCount ?? 0} {t('pos.bestsellers.invoicesCount')}</span>
                  </div>
                </div>
                <div className="card-footer">
                  <span className="price">{Number(product.salePrice).toFixed(2)} {t('currency')}</span>
                  <span className="revenue">
                    <DollarSign size={12} />
                    {Number(product.revenue ?? 0).toFixed(0)}
                  </span>
                </div>
              </div>
              <div className="card-actions">
                <button
                  className="add-to-cart-btn"
                  onClick={(e) => { e.stopPropagation(); onAddToCart(product); }}
                  disabled={product.totalStock <= 0}
                  aria-label={t('pos.popular.addToCart', { name: product.nameAr })}
                >
                  <Plus size={14} />
                  {t('pos.search.add')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {totalPages > 1 && !isLoading && (
        <div className="pagination">
          <button
            className="page-btn"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            aria-label={t('common.previous')}
          >
            <ChevronLeft size={18} />
          </button>
          <span className="page-info" aria-live="polite">
            {t('common.page')} {currentPage} {t('common.of')} {totalPages}
          </span>
          <button
            className="page-btn"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            aria-label={t('common.next')}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </section>
  );
}