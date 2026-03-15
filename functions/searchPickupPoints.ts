import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const PICKING_BASE = 'https://api.ship.co.il';

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
    throw new Error('Failed to get picking token');
  }
  return data.access_token;
}

Deno.serve(async (req) => {
  try {
  const base44 = createClientFromRequest(req);
  const isAuth = await base44.auth.isAuthenticated();
  if (!isAuth) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { city, street, point_types, num_points } = await req.json();

  if (!city) {
    return Response.json({ error: 'חסרה עיר לחיפוש' }, { status: 400 });
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

  const points = (data.Points || []).map(p => ({
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
    lng: p.Longitude
  }));

  return Response.json({ success: true, points });
  } catch (error) {
    console.error('[ERROR]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});