// Status configurations per source

export const WOO_STATUSES = {
  'processing': 'בטיפול',
  'on-hold': 'מושהה',
  'pending': 'ממתינה לתשלום',
  'completed': 'הושלמה',
  'cancelled': 'בוטלה',
  'refunded': 'הוחזרה',
  'failed': 'נכשלה',
  'ordered': 'הוזמנה מהבשמים',
  'wc-awaiting-serial': 'ממתין למספר סידורי'
};

export const MIRAKL_STATUSES = {
  'WAITING_ACCEPTANCE': 'ממתינה לאישור',
  'WAITING_DEBIT': 'ממתינה לחיוב',
  'WAITING_DEBIT_PAYMENT': 'ממתינה לתשלום',
  'SHIPPING': 'ממתינה למשלוח',
  'SHIPPED': 'נשלחה',
  'TO_COLLECT': 'לאיסוף',
  'RECEIVED': 'התקבלה',
  'CLOSED': 'נסגרה',
  'REFUSED': 'נדחתה',
  'CANCELED': 'בוטלה'
};

export const LINET_STATUSES = {
  'ממתינה לאספקה': 'ממתינה לאספקה',
  'בטיפול': 'בטיפול',
  'נוצר משלוח': 'נוצר משלוח',
  'טופל': 'טופל'
};

// SKU that marks a Linet invoice as an "order" needing fulfillment
export const LINET_ORDER_SKUS = ['963258741'];

export function getStatusLabel(source, status) {
  if (source === 'woocommerce') return WOO_STATUSES[status] || status;
  if (source === 'mirakl') return MIRAKL_STATUSES[status] || status;
  if (source === 'linet') return LINET_STATUSES[status] || status;
  return status;
}

export function getStatusOptions(source) {
  if (source === 'woocommerce') return Object.entries(WOO_STATUSES);
  if (source === 'mirakl') return Object.entries(MIRAKL_STATUSES);
  if (source === 'linet') return Object.entries(LINET_STATUSES);
  return [];
}

export function isClosedStatus(source, status) {
  if (source === 'woocommerce') return ['refunded', 'failed'].includes(status);
  if (source === 'mirakl') return ['CLOSED', 'REFUSED', 'CANCELED', 'RECEIVED'].includes(status);
  if (source === 'linet') return status === 'טופל';
  return false;
}

export function isOpenStatus(source, status) {
  if (source === 'woocommerce') return ['processing', 'on-hold', 'ordered', 'wc-awaiting-serial'].includes(status);
  if (source === 'mirakl') return ['WAITING_ACCEPTANCE', 'WAITING_DEBIT', 'WAITING_DEBIT_PAYMENT', 'SHIPPING', 'TO_COLLECT'].includes(status);
  if (source === 'linet') return status !== 'טופל';
  return false;
}

export function getShipmentBlockReason(source, status) {
  if (source === 'woocommerce') {
    if (status === 'on-hold') return '⚠️ הזמנה מושהית — נדרש תשלום לפני יצירת משלוח';
    if (status === 'pending') return '⚠️ הזמנה ממתינה לתשלום — אין ליצור משלוח לפני שהתשלום התקבל';
    if (status === 'cancelled') return '⚠️ הזמנה בוטלה — אין ליצור משלוח להזמנה מבוטלת';
  }
  if (source === 'mirakl') {
    if (status === 'WAITING_DEBIT' || status === 'WAITING_DEBIT_PAYMENT') return '⚠️ הזמנה ממתינה לתשלום — אין ליצור משלוח לפני שהתשלום התקבל';
    if (status === 'CANCELED') return '⚠️ הזמנה בוטלה — אין ליצור משלוח להזמנה מבוטלת';
  }
  return null;
}

export function isShipmentBlocked(source, status) {
  return Boolean(getShipmentBlockReason(source, status));
}

export function getStatusColor(source, status) {
  if (source === 'woocommerce') {
    const map = {
      'processing': 'bg-purple-100 text-purple-800 border border-purple-200',
      'on-hold': 'bg-orange-100 text-orange-800 border border-orange-200',
      'pending': 'bg-yellow-100 text-yellow-800 border border-yellow-200',
      'completed': 'bg-green-100 text-green-800 border border-green-200',
      'cancelled': 'bg-red-100 text-red-800 border border-red-200',
      'refunded': 'bg-pink-100 text-pink-800 border border-pink-200',
      'failed': 'bg-red-200 text-red-900 border border-red-300',
      'wc-awaiting-serial': 'bg-violet-100 text-violet-800 border border-violet-200',
      'ordered': 'bg-indigo-100 text-indigo-800 border border-indigo-200',
    };
    return map[status] || 'bg-gray-100 text-gray-700';
  }
  if (source === 'mirakl') {
    const map = {
      'WAITING_ACCEPTANCE': 'bg-yellow-100 text-yellow-800 border border-yellow-200',
      'WAITING_DEBIT': 'bg-amber-100 text-amber-800 border border-amber-200',
      'WAITING_DEBIT_PAYMENT': 'bg-amber-100 text-amber-800 border border-amber-200',
      'SHIPPING': 'bg-blue-100 text-blue-800 border border-blue-200',
      'SHIPPED': 'bg-cyan-100 text-cyan-800 border border-cyan-200',
      'TO_COLLECT': 'bg-purple-100 text-purple-800 border border-purple-200',
      'RECEIVED': 'bg-emerald-100 text-emerald-800 border border-emerald-200',
      'CLOSED': 'bg-gray-200 text-gray-700',
      'REFUSED': 'bg-red-100 text-red-800 border border-red-200',
      'CANCELED': 'bg-red-100 text-red-800 border border-red-200',
    };
    return map[status] || 'bg-gray-100 text-gray-700';
  }
  if (source === 'linet') {
    const map = {
      'ממתינה לאספקה': 'bg-amber-100 text-amber-800 border border-amber-200',
      'בטיפול': 'bg-orange-100 text-orange-800 border border-orange-200',
      'נוצר משלוח': 'bg-violet-100 text-violet-800 border border-violet-200',
      'טופל': 'bg-green-100 text-green-800 border border-green-200',
    };
    return map[status] || 'bg-gray-100 text-gray-700';
  }
  return 'bg-gray-100 text-gray-700';
}