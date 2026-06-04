export const MAX_PICKUP_DISTANCE_KM = 2;

export function normalizeCityName(value) {
  return String(value || '')
    .replace(/[\"'׳״]/g, '')
    .replace(/[-–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function getPickupPointDistance(point) {
  const raw = point?.distance ?? point?.dist;
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(String(raw).replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

export function getPickupPointSafety(point, targetCity) {
  if (!point) return { allowed: false, reasons: ['לא נבחרה נקודת איסוף'] };

  const reasons = [];
  const pointCity = normalizeCityName(point.city);
  const orderCity = normalizeCityName(targetCity);
  const distance = getPickupPointDistance(point);

  if (pointCity && orderCity && pointCity !== orderCity) {
    reasons.push(`עיר נקודת האיסוף (${point.city}) שונה מעיר הלקוח (${targetCity})`);
  }

  if (distance !== null && distance > MAX_PICKUP_DISTANCE_KM) {
    reasons.push(`נקודת האיסוף רחוקה ${distance.toFixed(1)} ק״מ — מעל ${MAX_PICKUP_DISTANCE_KM} ק״מ`);
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    distance,
  };
}