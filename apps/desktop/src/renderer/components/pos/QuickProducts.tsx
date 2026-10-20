import { useState } from 'react';
import { Plus, Star } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { ProductThumb } from '../products/ProductThumb';

interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  nameAr: string;
  nameEn: string | null;
  brand: string | null;
  manufacturer: string | null;
  categoryId: string | null;
  categoryNameAr: string | null;
  dosageForm: string;
  strength: string | null;
  packSize: string | null;
  unit: string | null;
  salePrice: string;
  costPrice: string;
  taxRate: string;
  minStock: number;
  prescriptionClass: string;
  totalStock: number;
  nearestExpiry: string | null;
  hasImage: boolean;
  isActive: boolean;
  isFavorite?: boolean;
}

interface QuickProductsProps {
  products: Product[];
  onAddToCart: (product: Product) => void;
  onToggleFavorite?: (productId: string, isFavorite: boolean) => Promise<void>;
  canManageFavorites?: boolean;
}

export function QuickProducts({ products, onAddToCart, onToggleFavorite, canManageFavorites = false }: QuickProductsProps) {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState<Set<string>>(new Set());

  const favoriteProducts = products.filter(p => p.isFavorite);
  const displayProducts = favoriteProducts.length > 0 ? favoriteProducts : products.slice(0, 12);

  const handleToggleFavorite = async (product: Product) => {
    if (!onToggleFavorite || !canManageFavorites) return;
    const newFavorite = !product.isFavorite;
    setIsLoading(prev => new Set(prev).add(product.id));
    try {
      await onToggleFavorite(product.id, newFavorite);
    } finally {
      setIsLoading(prev => {
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      });
    }
  };

  if (displayProducts.length === 0) {
    return (
      <section className="quick-products-block">
        <div className="section-header">
          <h2>{t('pos.quickProducts.title')}</h2>
        </div>
        <div className="products-grid">
          <div className="empty-favorites">
            <Star className="empty-icon" size={32} />
            <p>{t('pos.quickProducts.addToFavorites')}</p>
            <span className="hint">{t('pos.quickProducts.hint')}</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="quick-products-block">
      <div className="section-header">
        <h2>
          <Star className="header-icon" size={18} fill="currentColor" />
          {t('pos.quickProducts.title')}
        </h2>
        {canManageFavorites && (
          <span className="section-hint">{t('pos.quickProducts.addToFavorites')}</span>
        )}
      </div>
      <div className="products-grid" role="list">
        {displayProducts.map(product => (
          <article
            key={product.id}
            className="product-card quick-card"
            role="listitem"
            onClick={() => onAddToCart(product)}
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAddToCart(product); } }}
          >
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
              <div className="card-footer">
                <span className="price">{Number(product.salePrice).toFixed(2)} {t('currency')}</span>
                <span className={`stock-indicator ${product.totalStock > 10 ? 'high' : product.totalStock > 0 ? 'low' : 'empty'}`}>
                  {product.totalStock > 0 ? `${product.totalStock} ${t('pos.popular.inStock')}` : t('pos.popular.outOfStock')}
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
              {canManageFavorites && (
                <button
                  className={`favorite-btn ${product.isFavorite ? 'active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); handleToggleFavorite(product); }}
                  disabled={isLoading.has(product.id)}
                  aria-label={product.isFavorite ? t('pos.quickProducts.removeFromFavorites') : t('pos.quickProducts.addToFavorites')}
                  aria-pressed={product.isFavorite}
                >
                  <Star size={18} fill={product.isFavorite ? 'currentColor' : 'none'} className={isLoading.has(product.id) ? 'spin' : ''} />
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}