const PICKING_BASE = 'https://api.ship.co.il';
const MAX_PICKUP_DISTANCE_KM = 2;

function normalizeCityName(value) {
  return String(value || '')
    .replace(/[\"'׳״]/g, '')
    .replace(/[-–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toNumber(value) {
  const num = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

async function getPickingToken() {
  const body = new URLSearchParams({
    username: Deno.env.get('SHIP_USERNAME'),
    password: Deno.env.get('SHIP_PASSWORD'),
    scope: Deno.env.get('SHIP_SCOPE'),
    grant_type: 'password'
  });

  const res = await fetch(`${PICKING_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000)
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Failed to get picking token: ' + JSON.stringify(data));
  }
  return data.access_token;
}

Deno.serve(async (req) => {
  try {
    const { city, street, point_types, num_points } = await req.json();

    if (!city) {
      return Response.json({ success: false, error: 'חסרה עיר לחיפוש' }, { status: 400 });
    }

    const token = await getPickingToken();

    // pointTypes: 1=stores, 2=lockers, 3=both
    const params = new URLSearchParams({
      city,
      street: street || '',
      houseNumber: '',
      pointTypes: String(point_types || 3),
      points: String(num_points || 10)
    });

    const url = `${PICKING_BASE}/api/v1/pickups/getclosestpoints?${params}`;
    console.log(`GET ${url}`);

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });

    const data = await res.json();
    console.log(`Status: ${res.status}, Points: ${data.Points?.length || 0}`);

    if (data.IsSuccessful === false) {
      return Response.json({ success: false, error: data.ErrorMSG || 'לא נמצאו נקודות' });
    }

    const requestedCity = normalizeCityName(city);
    const points = (data.Points || []).map(p => {
      const pointCity = normalizeCityName(p.CityName);
      const distance = toNumber(p.Distance);
      const warnings = [];
      if (requestedCity && pointCity && requestedCity !== pointCity) {
        warnings.push(`עיר נקודת האיסוף (${p.CityName}) שונה מעיר הלקוח (${city})`);
      }
      if (distance !== null && distance > MAX_PICKUP_DISTANCE_KM) {
        warnings.push(`נקודת האיסוף רחוקה ${distance.toFixed(1)} ק״מ — מעל ${MAX_PICKUP_DISTANCE_KM} ק״מ`);
      }

      return {
        id: p.PointID,
        name: p.PointName,
        name_en: p.PointNameEn,
        city: p.CityName,
        street: p.StreetName,
        house: p.HouseNumber,
        phone: p.Phone,
        type: p.PointType === 1 ? 'store' : 'locker',
        distance: p.Distance,
        hours: p.Description,
        lat: p.Latitude,
        lng: p.Longitude,
        allowed: warnings.length === 0,
        warnings
      };
    });

    return Response.json({ success: true, points });
  } catch (error) {
    console.error('[ERROR]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});