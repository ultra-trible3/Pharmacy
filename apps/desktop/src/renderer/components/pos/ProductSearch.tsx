import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useMemo } from 'react';
import { Search, X, Barcode, Loader2, ChevronDown, FolderOpen } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';

interface ProductSearchResult {
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
}

interface ProductSearchProps {
  query: string;
  onSearch: (query: string) => void;
  results: ProductSearchResult[];
  onSelect: (product: ProductSearchResult, batch?: { id: string; lotNumber: string; expiryDate: string; quantity: number }) => void;
  selectedCategoryId: string | null;
  onCategoryChange: (categoryId: string | null) => void;
  categories: { id: string; code: string; nameAr: string; nameEn: string | null; productCount: number }[];
}

const DEBOUNCE_MS = 200;

export interface ProductSearchHandle {
  focus: () => void;
  clear: () => void;
}

export const ProductSearch = forwardRef<ProductSearchHandle, ProductSearchProps>(
  ({
    query,
    onSearch,
    results,
    onSelect,
    selectedCategoryId,
    onCategoryChange,
    categories,
  }, ref) => {
    const { t } = useI18n();
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const [showResults, setShowResults] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const resultsRef = useRef<HTMLDivElement>(null);
    const categoryBtnRef = useRef<HTMLButtonElement>(null);

    /* The parent only ever holds the *debounced* query, so driving the input
       from that prop made every keystroke revert to the stale value for up to
       DEBOUNCE_MS. Keep an instant local mirror instead: keystrokes paint
       immediately, the debounced value only feeds the API call. */
    const [inputValue, setInputValue] = useState(query);

    /* Mirror external clears (the imperative clear()) without ever
       overwriting what the cashier is typing. */
    useEffect(() => {
      if (!query) setInputValue('');
    }, [query]);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      clear: () => {
        inputRef.current?.focus();
        setInputValue('');
        onSearch('');
      },
    }));

    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'F2') {
          e.preventDefault();
          inputRef.current?.focus();
        }
        if (e.key === 'F1') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('pos:shortcuts:toggle'));
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const debouncedSearch = useMemo(
      () => {
        let timeout: NodeJS.Timeout;
        return (value: string) => {
          clearTimeout(timeout);
          setIsSearching(true);
          timeout = setTimeout(() => {
            onSearch(value);
          }, DEBOUNCE_MS);
        };
      },
      [onSearch]
    );

    /* The debounced call only *starts* the request — keep the spinner up
       through the actual round-trip and clear it the moment results (or the
       empty list set on an error) land. */
    useEffect(() => {
      setIsSearching(false);
    }, [results]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setInputValue(value); // paint instantly — never wait for the debounce
      setShowResults(true);
      setFocusedIndex(-1);
      debouncedSearch(value);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex(prev => Math.min(prev + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex(prev => Math.max(prev - 1, -1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (focusedIndex >= 0 && results[focusedIndex]) {
          onSelect(results[focusedIndex]);
          setShowResults(false);
          setFocusedIndex(-1);
        } else if (inputValue.trim() && results.length === 1) {
          onSelect(results[0]);
          setShowResults(false);
        }
      } else if (e.key === 'Escape') {
        setShowResults(false);
        setFocusedIndex(-1);
        inputRef.current?.blur();
      }
    };

    const handleResultClick = (product: ProductSearchResult) => {
      onSelect(product);
      setShowResults(false);
      setFocusedIndex(-1);
    };

    const clearSearch = () => {
      setInputValue('');
      onSearch('');
      setShowResults(false);
      setFocusedIndex(-1);
      inputRef.current?.focus();
    };

    const handleCategoryClick = (categoryId: string | null) => {
      onCategoryChange(categoryId);
      setShowCategoryDropdown(false);
      inputRef.current?.focus();
    };

    return (
      <div className="product-search-block">
        <div className="search-input-wrapper">
          <div className="search-header-row">
            <label className="search-label">{t('pos.search.placeholder')}</label>
            <div className="category-selector" onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}>
              <button
                ref={categoryBtnRef}
                type="button"
                className="category-btn"
                aria-haspopup="listbox"
                aria-expanded={showCategoryDropdown}
              >
                <span className="category-icon">
                  <FolderOpen size={14} />
                </span>
                <span className="category-name">
                  {selectedCategoryId
                    ? categories.find(c => c.id === selectedCategoryId)?.nameAr ?? t('pos.categories.all')
                    : t('pos.categories.all')}
                </span>
                <ChevronDown className={`chevron ${showCategoryDropdown ? 'open' : ''}`} size={16} />
              </button>
              {showCategoryDropdown && (
                <div className="category-dropdown" role="listbox">
                  <button
                    role="option"
                    aria-selected={!selectedCategoryId}
                    className={`category-option ${!selectedCategoryId ? 'selected' : ''}`}
                    onClick={() => handleCategoryClick(null)}
                  >
                    {t('pos.categories.all')}
                  </button>
                  {categories.map(cat => (
                    <button
                      key={cat.id}
                      role="option"
                      aria-selected={selectedCategoryId === cat.id}
                      className={`category-option ${selectedCategoryId === cat.id ? 'selected' : ''}`}
                      onClick={() => handleCategoryClick(cat.id)}
                    >
                      <span>{cat.nameAr}</span>
                      <span className="product-count">({cat.productCount})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="search-input-group">
            <span className="search-icon"><Search size={20} /></span>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={() => setShowResults(true)}
              onBlur={() => setTimeout(() => setShowResults(false), 200)}
              placeholder={t('pos.search.placeholder')}
              className="search-input"
              autoComplete="off"
              aria-autocomplete="list"
              aria-controls="search-results"
              aria-activedescendant={focusedIndex >= 0 ? `result-${focusedIndex}` : undefined}
            />
            {inputValue && (
              <button className="clear-btn" onClick={clearSearch} aria-label={t('common.cancel')}>
                <X size={18} />
              </button>
            )}
            <span className="scanner-hint">
              <Barcode size={14} /> {t('pos.search.scannerHint')}
            </span>
          </div>
        </div>

        {showResults && (
          <div className="search-results" ref={resultsRef} id="search-results" role="listbox">
            {isSearching && (
              <div className="search-loading">
                <Loader2 className="spin" size={20} />
                <span>{t('common.loading')}</span>
              </div>
            )}
            {results.length > 0 && results.map((product, index) => (
              <div
                key={product.id}
                id={`result-${index}`}
                className={`result-item ${index === focusedIndex ? 'focused' : ''}`}
                onClick={() => handleResultClick(product)}
                onMouseEnter={() => setFocusedIndex(index)}
                role="option"
                aria-selected={index === focusedIndex}
              >
                <div className="result-info">
                  <div className="result-name-row">
                    <span className="result-name">{product.nameAr}</span>
                    {product.prescriptionClass === 'PRESCRIPTION' && (
                      <span className="badge rx">{t('pos.search.rxOnly')}</span>
                    )}
                    {product.prescriptionClass === 'CONTROLLED' && (
                      <span className="badge controlled">{t('pos.search.controlled')}</span>
                    )}
                  </div>
                  <div className="result-details">
                    {product.brand && <span className="brand">{product.brand}</span>}
                    {product.strength && product.dosageForm && (
                      <>
                        {product.brand && <span>•</span>}
                        <span>{product.strength} {product.dosageForm}</span>
                      </>
                    )}
                    {product.packSize && (
                      <>
                        {(product.brand || (product.strength && product.dosageForm)) && <span>•</span>}
                        <span>{product.packSize}</span>
                      </>
                    )}
                    <span>•</span>
                    <span className="price">{Number(product.salePrice).toFixed(2)} {t('currency')}</span>
                    <span>•</span>
                    <span className={
                      product.totalStock > 10 ? 'in-stock' :
                      product.totalStock > 0 ? 'low-stock' : 'out-of-stock'
                    }>
                      {product.totalStock > 0
                        ? `${t('pos.search.inStock')}: ${product.totalStock}`
                        : t('pos.search.outOfStock')}
                    </span>
                  </div>
                </div>
                <button
                  className="add-btn"
                  onClick={(e) => { e.stopPropagation(); handleResultClick(product); }}
                  disabled={product.totalStock <= 0}
                  aria-label={t('pos.search.add', { name: product.nameAr })}
                >
                  {t('pos.search.add')}
                </button>
              </div>
            ))}
            {results.length === 0 && inputValue.trim() && !isSearching && (
              <div className="search-empty">
                {t('pos.search.noResults')}
              </div>
            )}
          </div>
        )}

        {showCategoryDropdown && (
          <div
            className="category-backdrop"
            onClick={() => setShowCategoryDropdown(false)}
            aria-hidden="true"
          />
        )}
      </div>
    );
  }
);

ProductSearch.displayName = 'ProductSearch';