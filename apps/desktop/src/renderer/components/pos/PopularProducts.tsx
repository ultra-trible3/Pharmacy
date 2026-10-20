import { Pin } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { ProductThumb } from '../products/ProductThumb';

interface Product {
  id: string;
  nameAr: string;
  nameEn: string;
  strength: string;
  dosageForm: string;
  packageSize: string;
  salePrice: number;
  stock: number;
  hasImage?: boolean;
  isPinned?: boolean;
  isBestSeller?: boolean;
}

interface PopularProductsProps {
  products: Product[];
  onAddToCart: (product: Product) => void;
  cartItemCount: number;
}

export function PopularProducts({ products, onAddToCart, cartItemCount }: PopularProductsProps) {
  const { t } = useI18n();

  if (products.length === 0) return null;

  return (
    <section className="popular-products-block">
      <div className="section-header">
        <h2>{t('pos.popular.title')}</h2>
        <span className="items-count">{cartItemCount} {t('pos.popular.itemsInCart')}</span>
      </div>
      <div className="products-grid" role="list">
        {products.map((product) => (
          <article
            key={product.id}
            className="product-card"
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
              {product.isBestSeller && <span className="bestseller-badge">{t('pos.popular.bestSeller')}</span>}
              {product.isPinned && (
                <span className="pinned-badge">
                  <Pin size={11} />
                </span>
              )}
              {product.stock <= 0 && <span className="out-of-stock-overlay">{t('pos.popular.outOfStock')}</span>}
            </div>
            <div className="card-content">
              <h3 className="product-name">{product.nameAr}</h3>
              <p className="product-strength">{product.strength} {product.dosageForm}</p>
              <p className="product-package">{product.packageSize}</p>
              <div className="card-footer">
                <span className="price">{product.salePrice.toFixed(2)} {t('currency')}</span>
                <span className={`stock-indicator ${product.stock > 10 ? 'high' : product.stock > 0 ? 'low' : 'empty'}`}>
                  {product.stock > 0 ? `${product.stock} ${t('pos.popular.inStock')}` : t('pos.popular.outOfStock')}
                </span>
              </div>
            </div>
            <button
              className="add-to-cart-btn"
              onClick={(e) => { e.stopPropagation(); onAddToCart(product); }}
              disabled={product.stock <= 0}
              aria-label={t('pos.popular.addToCart', { name: product.nameAr })}
            >
              +
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}