import type { LucideIcon } from 'lucide-react';
import { Bandage, Droplets, Folder, HeartPulse, Leaf, Package, Pill, SprayCan, Syringe, Utensils, Wind } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';

interface Category {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  productCount: number;
  isActive: boolean;
}

interface ProductCategoriesProps {
  categories: Category[];
  selectedCategoryId: string | null;
  onCategoryChange: (categoryId: string | null) => void;
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  ANALGESIC: Pill,
  ANTIBIOTIC: Syringe,
  CARDIO: HeartPulse,
  DIABETES: Droplets,
  RESPIRATORY: Wind,
  GASTRO: Utensils,
  VITAMIN: Leaf,
  DERMA: SprayCan,
  MEDICAL_SUPPLY: Bandage,
};

function categoryIcon(code: string) {
  const Icon = CATEGORY_ICONS[code] ?? Folder;
  return <Icon size={14} />;
}

export function ProductCategories({ categories, selectedCategoryId, onCategoryChange }: ProductCategoriesProps) {
  const { t } = useI18n();

  if (categories.length === 0) return null;

  return (
    <section className="product-categories-block" aria-label={t('pos.categories.all')}>
      <div className="categories-scroll" role="tablist" aria-label="Product categories">
        <button
          role="tab"
          aria-selected={!selectedCategoryId}
          className={`category-chip ${!selectedCategoryId ? 'active' : ''}`}
          onClick={() => onCategoryChange(null)}
        >
          <span className="chip-icon">
            <Package size={14} />
          </span>
          <span className="chip-label">{t('pos.categories.all')}</span>
        </button>
        {categories
          .filter(c => c.isActive)
          .map(category => (
            <button
              key={category.id}
              role="tab"
              aria-selected={selectedCategoryId === category.id}
              className={`category-chip ${selectedCategoryId === category.id ? 'active' : ''}`}
              onClick={() => onCategoryChange(category.id)}
            >
              <span className="chip-icon">{categoryIcon(category.code)}</span>
              <span className="chip-label">{category.nameAr}</span>
              <span className="chip-count">{category.productCount}</span>
            </button>
          ))}
      </div>
    </section>
  );
}