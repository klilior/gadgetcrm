/**
 * Detects the shipping type the customer chose.
 * Returns: 'self_pickup' | 'cargo' | 'ups' | 'getpackage' | null
 *
 * self_pickup (green) = איסוף עצמי מהחנות / מהמוכר
 * cargo (blue)        = שליח עד הבית
 * ups (brown/amber)   = נקודות איסוף / pickup points
 * getpackage (red)    = משלוח מהיום להיום / express / same-day
 */

export function detectShippingType(order) {
  if (!order) return null;
  const method = (order.shipping_method || '').toLowerCase();

  // Mirakl orders
  if (order.source === 'mirakl') {
    try {
      const raw = JSON.parse(order.raw_mirakl_json || '{}');
      const typeCode = raw.shipping_type_code || '';
      const label = (raw.shipping_type_label || '').toLowerCase();
      // Self pickup from seller
      if (typeCode === 'pickup-seller' || label.includes('איסוף עצמי') || label.includes('מהמוכר')) return 'self_pickup';
      if (typeCode === 'pickup-locations') return 'ups';
      if (label.includes('נקודת') || label.includes('pickup')) return 'ups';
    } catch {}
    return 'cargo'; // default for Mirakl is home delivery
  }

  // WooCommerce / Linet orders - detect from shipping method text
  // IMPORTANT: Check self_pickup FIRST — "איסוף מקניון" or "איסוף עצמי" means customer picks up from store
  // These contain "איסוף" which would otherwise match 'ups'
  if (method.includes('איסוף מ') || method.includes('איסוף עצמי') || method.includes('self pickup') || method.includes('איסוף מהחנות')) {
    return 'self_pickup';
  }
  // IMPORTANT: Check getpackage BEFORE cargo — "משלוח היום" contains "משלוח" which would match cargo first
  if (method.includes('מהיום') || method.includes('משלוח היום') || method.includes('express') || method.includes('same') || method.includes('דחוף') || method.includes('getpackage')) {
    return 'getpackage';
  }
  if (method.includes('נקודת') || method.includes('pickup') || method.includes('איסוף') || method.includes('picku') || method.includes('ups')) {
    return 'ups';
  }
  if (method.includes('שליח') || method.includes('עד הבית') || method.includes('cargo') || method.includes('delivery') || method.includes('משלוח')) {
    return 'cargo';
  }

  return null;
}

/**
 * איסוף עצמי — הלקוח מגיע לחנות. אין שלב משלוח:
 * ההזמנה נסגרת בשלב הנפקת החשבונית.
 */
export function isSelfPickup(order) {
  return detectShippingType(order) === 'self_pickup';
}

/**
 * Returns the styling config for a shipping type badge
 */
export function getShippingTypeBadge(type) {
  switch (type) {
    case 'self_pickup':
      return {
        label: '🏪 איסוף עצמי מהחנות',
        className: 'bg-green-200 text-green-900 border-2 border-green-500 font-bold',
        buttonMatch: 'self_pickup',
      };
    case 'cargo':
      return {
        label: '🚚 שליח עד הבית',
        className: 'bg-blue-100 text-blue-800 border border-blue-300',
        buttonMatch: 'cargo',
      };
    case 'ups':
      return {
        label: '📦 נקודות איסוף',
        className: 'bg-amber-100 text-amber-900 border border-amber-300',
        buttonMatch: 'ups',
      };
    case 'getpackage':
      return {
        label: '⚡ מהיום להיום',
        className: 'bg-red-100 text-red-800 border border-red-300',
        buttonMatch: 'getpackage',
      };
    default:
      return null;
  }
}

/**
 * Checks if order is a same-day urgent delivery that should flash
 * Conditions: getpackage shipping + paid + status "processing"/"בטיפול"
 */
export function isUrgentSameDay(order) {
  const type = detectShippingType(order);
  if (type !== 'getpackage') return false;
  
  const status = (order.status || '').toLowerCase();
  // WooCommerce "processing" or Linet "בטיפול" or "ממתינה לאספקה"
  return status === 'processing' || status === 'בטיפול' || status === 'ממתינה לאספקה' || status === 'shipping';
}