// Status configurations per source

export const WOO_STATUSES = {
  'processing': 'בטיפול',
  'on-hold': 'מושהה',
  'pending': 'ממתינה לתשלום',
  'completed': 'הושלמה',
  'cancelled': 'בוטלה',
  'refunded': 'הוחזרה',
  'failed': 'נכשלה',
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
  'חדשה': 'חדשה',
  'בטיפול': 'בטיפול',
  'נוצר משלוח': 'נוצר משלוח',
  'טופל': 'טופל'
};

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
  if (source === 'woocommerce') return ['completed', 'cancelled', 'refunded', 'failed'].includes(status);
  if (source === 'mirakl') return ['CLOSED', 'REFUSED', 'CANCELED', 'RECEIVED'].includes(status);
  if (source === 'linet') return status === 'טופל';
  return false;
}

export function getStatusColor(source, status) {
  if (source === 'woocommerce') {
    const map = {
      'processing': 'bg-blue-100 text-blue-800',
      'on-hold': 'bg-orange-100 text-orange-800',
      'pending': 'bg-yellow-100 text-yellow-800',
      'completed': 'bg-green-100 text-green-800',
      'cancelled': 'bg-red-100 text-red-800',
      'refunded': 'bg-pink-100 text-pink-800',
      'failed': 'bg-red-200 text-red-900',
    };
    return map[status] || 'bg-gray-100 text-gray-700';
  }
  if (source === 'mirakl') {
    const map = {
      'WAITING_ACCEPTANCE': 'bg-yellow-100 text-yellow-800',
      'SHIPPING': 'bg-blue-100 text-blue-800',
      'SHIPPED': 'bg-green-100 text-green-800',
      'CLOSED': 'bg-gray-200 text-gray-700',
      'REFUSED': 'bg-red-100 text-red-800',
      'CANCELED': 'bg-red-100 text-red-800',
    };
    return map[status] || 'bg-gray-100 text-gray-700';
  }
  if (source === 'linet') {
    const map = {
      'חדשה': 'bg-yellow-100 text-yellow-800',
      'בטיפול': 'bg-blue-100 text-blue-800',
      'נוצר משלוח': 'bg-purple-100 text-purple-800',
      'טופל': 'bg-green-100 text-green-800',
    };
    return map[status] || 'bg-gray-100 text-gray-700';
  }
  return 'bg-gray-100 text-gray-700';
}