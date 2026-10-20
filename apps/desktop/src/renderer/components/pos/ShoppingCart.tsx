import { useState, useEffect } from 'react';
import { Minus, Plus, Trash2, RotateCcw, X, User, UserPlus, AlertTriangle, Clock, Undo2, Star, ShoppingCart as CartIcon, Loader2 } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { multiplyCurrency, formatEGP } from '@pharmacy/shared';
import { api } from '../../lib/api';

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
}

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

interface CartItem {
  id: string;
  product: Product;
  batch: Batch;
  quantity: number;
  unitPrice: string;
  discount: string;
  lineTotal: string;
  addedAt: string;
}

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  creditLimit: string;
  currentBalance: string;
  loyaltyPoints: number;
}

interface SuspendedInvoice {
  id: string;
  invoiceNumber: string;
  items: CartItem[];
  customer?: Customer;
  subtotal: string;
  itemDiscount: string;
  invoiceDiscount: string;
  taxAmount: string;
  total: string;
  status: 'suspended';
  note?: string;
  createdAt: string;
  cashierId: string;
  warehouseId: string;
}

interface ShoppingCartProps {
  items: CartItem[];
  selectedItemId: string | null;
  onSelectItem: (itemId: string | null) => void;
  onUpdateQuantity: (itemId: string, qty: number) => void;
  onUpdateDiscount: (itemId: string, discount: string) => void;
  onRemove: (itemId: string) => void;
  onClear: () => void;
  onSuspend: (note?: string) => void;
  onCustomerChange: (customer: Customer | null) => void;
  customer: Customer | null;
  suspendedInvoices: SuspendedInvoice[];
  onResumeInvoice: (invoice: SuspendedInvoice) => void;
  onBatchSelect: (itemId: string, batch: Batch) => void;
  onRestoreCart: (items: CartItem[]) => void;
}

const STORAGE_KEY = 'pos_cart_undo';

export function ShoppingCart({
  items,
  selectedItemId,
  onSelectItem,
  onUpdateQuantity,
  onUpdateDiscount,
  onRemove,
  onClear,
  onSuspend,
  onCustomerChange,
  customer,
  suspendedInvoices,
  onResumeInvoice,
  onBatchSelect,
  onRestoreCart,
}: ShoppingCartProps) {
  const { t, locale } = useI18n();
  const [showSuspended, setShowSuspended] = useState(false);
  const [showSuspendDialog, setShowSuspendDialog] = useState(false);
  const [suspendNote, setSuspendNote] = useState('');
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState<{ itemId: string; batches: Batch[] } | null>(null);
  const [undoStack, setUndoStack] = useState<{ action: 'remove' | 'clear'; prevItems: CartItem[] }[]>([]);
  const [showUndoToast, setShowUndoToast] = useState<{ message: string; action: () => void } | null>(null);

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalUnits = items.length;

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setUndoStack(parsed);
      }
      // A malformed persisted history is not fatal — start fresh.
    } catch {
      setUndoStack([]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(undoStack));
  }, [undoStack]);

  const pushUndo = (action: 'remove' | 'clear') => {
    setUndoStack(prev => [...prev.slice(-9), { action, prevItems: items }]);
  };

  const restore = (prevItems: CartItem[]) => {
    onRestoreCart(prevItems);
    setShowUndoToast(null);
  };

  const handleRemove = (itemId: string) => {
    const snapshot = items;
    pushUndo('remove');
    onRemove(itemId);
    setShowUndoToast({
      message: t('pos.success.undone', { action: t('pos.cart.remove') }),
      action: () => restore(snapshot),
    });
    setTimeout(() => setShowUndoToast(null), 5000);
  };

  const handleClear = () => {
    if (items.length > 0 && window.confirm(t('pos.confirm.clearCart'))) {
      const snapshot = items;
      pushUndo('clear');
      onClear();
      onCustomerChange(null);
      setShowUndoToast({
        message: t('pos.success.undone', { action: t('pos.cart.clear') }),
        action: () => restore(snapshot),
      });
      setTimeout(() => setShowUndoToast(null), 5000);
    }
  };

  const handleSuspend = () => {
    if (items.length === 0) return;
    // Electron does not implement window.prompt (electron/electron#472 is
    // closed wontfix), so the note is collected in an in-app dialog instead.
    setSuspendNote('');
    setShowSuspendDialog(true);
  };

  const confirmSuspend = () => {
    setShowSuspendDialog(false);
    // The parent toasts once the hold is really stored (server or local).
    onSuspend(suspendNote.trim() || undefined);
  };

  const handleResume = (invoice: SuspendedInvoice) => {
    onResumeInvoice(invoice);
    setShowSuspended(false);
  };

  const handleBatchSelect = (item: CartItem, batches: Batch[]) => {
    if (batches.length === 1) {
      onBatchSelect(item.id, batches[0]);
    } else {
      setShowBatchModal({ itemId: item.id, batches });
    }
  };

  const formatDate = (date: string) => new Date(date).toLocaleDateString(locale);
  const formatTime = (date: string) => new Date(date).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  const isExpired = (expiry: string) => new Date(expiry) <= new Date();
  const isExpiringSoon = (expiry: string) => {
    const expiryDate = new Date(expiry);
    const now = new Date();
    const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    return expiryDate > now && expiryDate < thirtyDays;
  };

  return (
    <section className="shopping-cart-block">
      <div className="cart-header">
        <h2>{t('pos.cart.title')}</h2>
        <div className="cart-summary">
          <span>{totalUnits} {t('pos.cart.items')}</span>
          <span>{totalItems} {t('pos.cart.units')}</span>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="cart-empty">
          <div className="empty-icon">
            <CartIcon size={34} />
          </div>
          <p>{t('pos.cart.empty')}</p>
          <p className="hint">{t('pos.cart.emptyHint')}</p>
        </div>
      ) : (
        <div className="cart-table-wrapper">
          <table className="cart-table" role="grid">
            <thead>
              <tr>
                <th>{t('pos.cart.columns.product')}</th>
                <th className="col-batch">{t('pos.cart.columns.batch')}</th>
                <th className="col-expiry">{t('pos.cart.columns.expiry')}</th>
                <th className="text-center">{t('pos.cart.columns.qty')}</th>
                <th className="text-right">{t('pos.cart.columns.price')}</th>
                <th className="text-right">{t('pos.cart.columns.discount')}</th>
                <th className="text-right">{t('pos.cart.columns.total')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const expired = isExpired(item.batch.expiryDate);
                const expiring = isExpiringSoon(item.batch.expiryDate);
                const isSelected = selectedItemId === item.id;
                return (
                  <tr
                    key={item.id}
                    className={`${isSelected ? 'selected' : ''} ${expired ? 'expired-row' : ''} ${expiring ? 'expiring-row' : ''}`}
                    onClick={() => onSelectItem(item.id)}
                  >
                    <td>
                      <div className="product-cell">
                        <span className="name">{item.product.nameAr}</span>
                        <span className="strength">{item.product.strength} {item.product.dosageForm}</span>
                        {item.product.packSize && <span className="pack">{item.product.packSize}</span>}
                        {item.product.prescriptionClass === 'PRESCRIPTION' && <span className="badge rx">{t('pos.search.rxOnly')}</span>}
                        {item.product.prescriptionClass === 'CONTROLLED' && <span className="badge controlled">{t('pos.search.controlled')}</span>}
                      </div>
                    </td>
                    <td className="col-batch">
                      <button
                        className="batch-btn"
                        onClick={(e) => { e.stopPropagation(); handleBatchSelect(item, [item.batch]); }}
                        disabled={item.batch.quantity <= item.quantity}
                      >
                        <span className="batch-number">{item.batch.lotNumber}</span>
                        <span className="batch-available">({item.batch.quantity - item.quantity} {t('pos.inventory.availableQty')})</span>
                      </button>
                    </td>
                    <td className="col-expiry">
                      <span className={`expiry-date ${expired ? 'expired' : expiring ? 'expiring' : ''}`}>
                        {formatDate(item.batch.expiryDate)}
                        {expired && <AlertTriangle size={12} className="warning-icon" />}
                        {expiring && !expired && <Clock size={12} className="warning-icon" />}
                      </span>
                    </td>
                    <td className="text-center">
                      <div className="qty-input">
                        <button
                          onClick={(e) => { e.stopPropagation(); onUpdateQuantity(item.id, Math.max(1, item.quantity - 1)); }}
                          aria-label={t('pos.cart.decrease')}
                          disabled={item.quantity <= 1}
                        >
                          <Minus size={16} />
                        </button>
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => { e.stopPropagation(); onUpdateQuantity(item.id, parseInt(e.target.value) || 1); }}
                          min="1"
                          max={item.batch.quantity}
                          className="qty-value"
                          aria-label={t('pos.cart.columns.qty')}
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); onUpdateQuantity(item.id, Math.min(item.batch.quantity, item.quantity + 1)); }}
                          aria-label={t('pos.cart.increase')}
                          disabled={item.quantity >= item.batch.quantity}
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    </td>
                    <td className="text-right">{Number(item.unitPrice).toFixed(2)}</td>
                    <td className="text-right">
                      <input
                        type="number"
                        value={Number(item.discount).toFixed(2)}
                        onChange={(e) => { e.stopPropagation(); onUpdateDiscount(item.id, Number(e.target.value).toFixed(2)); }}
                        min="0"
                        max={Number(multiplyCurrency(item.unitPrice, item.quantity))}
                        step="0.01"
                        className="discount-input"
                        aria-label={t('pos.cart.columns.discount')}
                      />
                    </td>
                    <td className="text-right total-cell">{Number(item.lineTotal).toFixed(2)}</td>
                    <td>
                      <button
                        className="remove-btn"
                        onClick={(e) => { e.stopPropagation(); handleRemove(item.id); }}
                        aria-label={t('pos.cart.remove')}
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="cart-footer">
        <div className="cart-actions">
          <button className="btn-secondary" onClick={handleSuspend} disabled={items.length === 0}>
            <RotateCcw size={16} /> {t('pos.cart.suspend')}
          </button>
          <button className="btn-secondary" onClick={() => setShowSuspended(true)} disabled={suspendedInvoices.length === 0}>
            <Clock size={16} /> {t('pos.cart.resume')} ({suspendedInvoices.length})
          </button>
          <button className="btn-danger" onClick={handleClear} disabled={items.length === 0}>
            <Trash2 size={16} /> {t('pos.cart.clear')}
          </button>
        </div>

        <div className="customer-section">
          <label>{t('pos.cart.customer')}</label>
          <div className="customer-select">
            {customer ? (
              <div className="selected-customer">
                <User size={16} />
                <span>{customer.name}</span>
                {customer.phone && <span className="customer-phone">{customer.phone}</span>}
                <button onClick={() => onCustomerChange(null)} className="remove-customer" aria-label={t('pos.cart.removeCustomer')}>
                  <X size={16} />
                </button>
              </div>
            ) : (
              <button className="btn-outline" onClick={() => setShowCustomerSearch(true)}>
                <UserPlus size={16} /> {t('pos.cart.selectCustomer')}
              </button>
            )}
          </div>
        </div>
      </div>

      {showSuspendDialog && (
        <div className="modal-overlay" onClick={() => setShowSuspendDialog(false)} role="dialog" aria-modal="true" aria-labelledby="suspend-title">
          <div className="modal suspended-modal" onClick={e => e.stopPropagation()}>
            <header>
              <h3 id="suspend-title">{t('pos.confirm.suspendInvoice')}</h3>
              <button onClick={() => setShowSuspendDialog(false)} aria-label={t('common.close')}>
                <X size={20} />
              </button>
            </header>
            <div className="suspend-note-field">
              <label htmlFor="suspend-note-input">{t('pos.confirm.suspendNote')}</label>
              <textarea
                id="suspend-note-input"
                rows={3}
                value={suspendNote}
                onChange={e => setSuspendNote(e.target.value)}
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowSuspendDialog(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn-primary" onClick={confirmSuspend}>
                {t('pos.cart.suspend')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuspended && suspendedInvoices.length > 0 && (
        <div className="modal-overlay" onClick={() => setShowSuspended(false)} role="dialog" aria-modal="true" aria-labelledby="suspended-title">
          <div className="modal suspended-modal" onClick={e => e.stopPropagation()}>
            <header>
              <h3 id="suspended-title">{t('pos.cart.suspendedInvoices')}</h3>
              <button onClick={() => setShowSuspended(false)} aria-label={t('common.close')}>
                <X size={20} />
              </button>
            </header>
            <div className="suspended-list">
              {suspendedInvoices.map(inv => (
                <button
                  key={inv.id}
                  className="suspended-item"
                  onClick={() => handleResume(inv)}
                >
                  <div>
                    <strong>{inv.invoiceNumber}</strong>
                    <span>{formatDate(inv.createdAt)} {formatTime(inv.createdAt)}</span>
                    {inv.note && <span className="suspended-note">{inv.note}</span>}
                  </div>
                  <div>
                    <span>{inv.items.length} {t('pos.cart.items')}</span>
                    <span className="total">{formatEGP(inv.total, locale === 'ar' ? 'ar-EG' : 'en-EG')}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showBatchModal && (
        <div className="modal-overlay" onClick={() => setShowBatchModal(null)} role="dialog" aria-modal="true" aria-labelledby="batch-title">
          <div className="modal batch-modal" onClick={e => e.stopPropagation()}>
            <header>
              <h3 id="batch-title">{t('pos.inventory.selectBatch')}</h3>
              <button onClick={() => setShowBatchModal(null)} aria-label={t('common.close')}>
                <X size={20} />
              </button>
            </header>
            <div className="batch-selection-list">
              {showBatchModal.batches
                .filter(b => b.quantity > 0)
                .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())
                .map((batch, index) => {
                  const expired = isExpired(batch.expiryDate);
                  const expiring = isExpiringSoon(batch.expiryDate);
                  return (
                    <button
                      key={batch.id}
                      className={`batch-option ${index === 0 ? 'fefo-first' : ''} ${expired ? 'expired' : ''} ${expiring && !expired ? 'expiring' : ''}`}
                      onClick={() => { onBatchSelect(showBatchModal.itemId, batch); setShowBatchModal(null); }}
                      disabled={expired || batch.quantity <= 0}
                    >
                      <div className="batch-info">
                        <span className="batch-number">{batch.lotNumber}</span>
                        <span className="batch-expiry">{formatDate(batch.expiryDate)}</span>
                        <span className="batch-qty">{batch.quantity} {t('pos.inventory.availableQty')}</span>
                        {index === 0 && <span className="fefo-badge">{t('pos.inventory.fefoFirst')}</span>}
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {showUndoToast && (
        <div className="undo-toast" role="alert" aria-live="polite">
          <span>{showUndoToast.message}</span>
          <button className="undo-btn" onClick={showUndoToast.action}>
            <Undo2 size={16} /> {t('common.cancel')}
          </button>
        </div>
      )}

      {showCustomerSearch && (
        <CustomerSearchModal
          isOpen={showCustomerSearch}
          onClose={() => setShowCustomerSearch(false)}
          onSelect={onCustomerChange}
        />
      )}
    </section>
  );
}

interface CustomerSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (customer: Customer | null) => void;
}

function CustomerSearchModal({ isOpen, onClose, onSelect }: CustomerSearchModalProps) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  if (!isOpen) return null;

  const searchCustomers = async (q: string) => {
    setQuery(q);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setIsLoading(true);
    try {
      const response = await api.customers.list({ q, pageSize: 20 });
      setResults(response.items ?? []);
    } catch {
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && results[selectedIndex]) {
        onSelect(results[selectedIndex]);
        onClose();
      } else if (query.trim()) {
        onSelect(null);
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal customer-modal" onClick={e => e.stopPropagation()}>
        <header>
          <h3>{t('pos.customer.title')}</h3>
          <button onClick={onClose} aria-label={t('common.close')}>
            <X size={20} />
          </button>
        </header>
        <div className="customer-search">
          <input
            type="text"
            value={query}
            onChange={e => searchCustomers(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('pos.customer.searchPlaceholder')}
            autoFocus
            className="search-input"
          />
          {isLoading && <Loader2 className="spin" size={20} />}
        </div>
        <div className="customer-options">
          <button className="walk-in-btn" onClick={() => { onSelect(null); onClose(); }}>
            <span className="option-icon">
              <User size={18} />
            </span>
            <span>{t('pos.customer.walkIn')}</span>
            <span className="option-desc">{t('cashier.walkInDesc')}</span>
          </button>
          {results.map((customer, index) => (
            <button
              key={customer.id}
              className={`customer-option ${index === selectedIndex ? 'focused' : ''}`}
              onClick={() => { onSelect(customer); onClose(); }}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="customer-name">{customer.name}</span>
              {customer.phone && <span className="customer-phone">{customer.phone}</span>}
              {customer.loyaltyPoints > 0 && (
                <span className="loyalty-badge">
                  <Star size={12} /> {customer.loyaltyPoints}
                </span>
              )}
              {customer.currentBalance && Number(customer.currentBalance) !== 0 && (
                <span className={`balance ${Number(customer.currentBalance) > 0 ? 'debit' : 'credit'}`}>
                  {formatEGP(customer.currentBalance, locale === 'ar' ? 'ar-EG' : 'en-EG')}
                </span>
              )}
            </button>
          ))}
          {results.length === 0 && query.trim() && !isLoading && (
            <div className="no-results">
              <p>{t('pos.customer.noResults')}</p>
              <p className="hint">{t('pos.customer.createNewHint')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}