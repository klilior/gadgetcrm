/**
 * Detects the shipping type the customer chose.
 * Returns: 'cargo' | 'ups' | 'getpackage' | null
 *
 * cargo (blue)       = שליח עד הבית
 * ups (brown/amber)  = נקודות איסוף / pickup
 * getpackage (red)   = משלוח מהיום להיום / express / same-day
 */

export function detectShippingType(order) {
  if (!order) return null;
  const method = (order.shipping_method || '').toLowerCase();
  const notes = (order.notes || '').toLowerCase();

  // Mirakl orders
  if (order.source === 'mirakl') {
    try {
      const raw = JSON.parse(order.raw_mirakl_json || '{}');
      if (raw.shipping_type_code === 'pickup-locations') return 'ups';
      const label = (raw.shipping_type_label || '').toLowerCase();
      if (label.includes('איסוף') || label.includes('pickup')) return 'ups';
    } catch {}
    return 'cargo'; // default for Mirakl is home delivery
  }

  // WooCommerce / Linet orders - detect from shipping method text
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
 * Returns the styling config for a shipping type badge
 */
export function getShippingTypeBadge(type) {
  switch (type) {
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