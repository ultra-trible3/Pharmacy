import { useState, useEffect } from 'react';

export function CashierPage(): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<any[]>([]);
  const [amountPaid, setAmountPaid] = useState('0');
  const [saleError, setSaleError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [total, setTotal] = useState('0');

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const addToCart = (product: any, qty: number = 1) => {
    setCart((prev: any[]) => {
      const existing = prev.find((i: any) => i.id === product.id);
      if (existing) {
        return prev.map((i: any) =>
          i.id === product.id ? { ...i, quantity: i.quantity + qty } : i
        );
      }
      return [...prev, { ...product, quantity: qty }];
    });
  };

  const removeFromCart = (id: string) => {
    setCart((c: any[]) => c.filter((i: any) => i.id !== id));
  };

  // حساب الإجمالي
  useEffect(() => {
    const sub = cart.reduce((sum: any, item: any) => sum + (item.price ?? 0) * item.quantity, 0);
    const tax = sub * 0.05;
    setTotal(String(sub + tax));
  }, [cart]);

  const completeSale = () => {
    setSaleError(null);
    setIsProcessing(true);
    setTimeout(() => {
      setCart([]);
      setIsProcessing(false);
      setSaleError(null);
      window.alert('تم إتمام البيع بنجاح');
    }, 1000);
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAmountPaid(e.target.value);
  };

  const printReceipt = () => {
    window.alert('تم طباعة الإيصال');
  };

  return (
    <div style={{ padding: '20px', direction: 'rtl' }}>
      <h2 style={{ textAlign: 'center', margin: '20px 0' }}>نقطة البيع (Cashier)</h2>

      <div style={{ marginBottom: '15px', textAlign: 'right' }}>
        <input
          type="text"
          placeholder="بحث..."
          value={searchQuery}
          onChange={handleSearch}
          style={{ width: '100%', padding: '8px', marginBottom: '8px', border: '1px solid #d5d8dc', borderRadius: '4px' }}
        />
        <button
          style={{
            padding: '8px 16px',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            float: 'right',
          }}
        >
          بحث
        </button>
      </div>

      <div style={{ margin: '20px 0', padding: '15px', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
        <h3 style={{ textAlign: 'right', marginBottom: '15px' }}>السلة ({cart.length} عنصر)</h3>
        {cart.length === 0 ? (
          <p style={{ color: '#6b7280', textAlign: 'right' }}>السلة فارغة</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                <th style={{ padding: '8px' }}>المنتج</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>الكمية</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>السعر</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>إجمالي</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>الحذف</th>
              </tr>
            </thead>
            <tbody>
              {cart.map((item: any, idx: number) => (
                <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb', padding: '8px 0' }}>
                  <td>{item.nameAr || item.name || 'منتج'}</td>
                  <td>
                    <input
                      type="number"
                      min="1"
                      value={item.quantity || 1}
                      onChange={(e: any) => addToCart(item, Number(e.target.value) || 1)}
                      style={{ width: '50px' }}
                    />
                  </td>
                  <td>{item.price || 0} جنيه</td>
                  <td>{(item.price || 0) * (item.quantity || 1)} جنيه</td>
                  <td>
                    <button
                      style={{
                        background: '#ef4145',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '4px 8px',
                        cursor: 'pointer',
                      }}
                      onClick={() => removeFromCart(item.id)}
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ margin: '20px 0' }}>
        <p style={{ textAlign: 'right', marginBottom: '8px' }}><strong>المجموع:</strong> {total} جنيه</p>
        <p style={{ textAlign: 'right', marginBottom: '8px' }}><strong>الضريبة (5%):</strong> {Number(total) * 0.05} جنيه</p>
        <div style={{ textAlign: 'right', marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>المبلغ المدفوع:</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amountPaid}
            onChange={handleAmountChange}
            style={{
              width: '100%',
              padding: '8px',
              marginBottom: '8px',
              border: '1px solid #d5d8dc',
              borderRadius: '4px',
            }}
          />
        </div>
        {total !== '0' && amountPaid && (
          <div>
            <p><strong>الباقي:</strong> {Number(amountPaid) - Number(total)} جنيه</p>
            <button
              style={{
                marginTop: '10px',
                padding: '10px 20px',
                background: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                width: '100%',
                cursor: 'pointer',
              }}
              onClick={completeSale}
              disabled={isProcessing}
            >
              {isProcessing ? 'جاري المعالجة...' : 'إتمام البيع'}
            </button>
          </div>
        )}
        {saleError && (
          <p style={{ color: '#ef4145', marginTop: '10px', textAlign: 'right' }}>{saleError}</p>
        )}
      </div>

      {total !== '0' && !isProcessing && (
        <button
          style={{
            marginTop: '15px',
            padding: '10px 20px',
            background: '#8884d6',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            width: '100%',
            cursor: 'pointer',
            textAlign: 'center',
          }}
          onClick={printReceipt}
        >
          طباعة إيصال
        </button>
      )}
    </div>
  );
}