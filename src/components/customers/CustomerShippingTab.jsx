import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Truck, MapPin, ExternalLink, Package } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

const SHIPMENT_STATUS_MAP = {
  pending: { label: 'ממתין', color: 'bg-yellow-100 text-yellow-800' },
  created: { label: 'נוצר', color: 'bg-blue-100 text-blue-800' },
  picked_up: { label: 'נאסף', color: 'bg-indigo-100 text-indigo-800' },
  in_transit: { label: 'בדרך', color: 'bg-purple-100 text-purple-800' },
  delivered: { label: 'נמסר', color: 'bg-green-100 text-green-800' },
  cancelled: { label: 'בוטל', color: 'bg-red-100 text-red-800' },
  failed: { label: 'נכשל', color: 'bg-red-100 text-red-800' },
};

const CARRIER_NAMES = {
  ups: 'UPS', velo: 'Velo', cargo: 'קארגו', other: 'אחר',
};

function formatDate(d) {
  if (!d) return '';
  try { return format(new Date(d), 'dd/MM/yyyy HH:mm', { locale: he }); }
  catch { return ''; }
}

function ShipmentCard({ shipment }) {
  const st = SHIPMENT_STATUS_MAP[shipment.status] || { label: shipment.status, color: 'bg-gray-100 text-gray-700' };
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-3 sm:p-4">
        <div className="flex justify-between items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Truck className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <span className="font-semibold text-sm">
                {shipment.reference ? `הזמנה #${shipment.reference}` : `משלוח #${shipment.id?.slice(-6)}`}
              </span>
              <Badge className={`text-[10px] ${st.color}`}>{st.label}</Badge>
              {shipment.carrier && (
                <Badge variant="outline" className="text-[10px]">{CARRIER_NAMES[shipment.carrier] || shipment.carrier}</Badge>
              )}
            </div>
            <div className="mt-2 space-y-1 text-xs text-gray-600">
              {shipment.tracking_number && (
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">מעקב:</span>
                  <span className="font-mono font-medium">{shipment.tracking_number}</span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <MapPin className="w-3 h-3 text-gray-400" />
                <span>{[shipment.consignee_street, shipment.consignee_house, shipment.consignee_city].filter(Boolean).join(', ') || 'אין כתובת'}</span>
              </div>
              {shipment.consignee_name && (
                <div className="text-gray-500">נמען: {shipment.consignee_name} {shipment.consignee_phone ? `(${shipment.consignee_phone})` : ''}</div>
              )}
              {shipment.pickup_point_name && (
                <div className="text-gray-500">נקודת איסוף: {shipment.pickup_point_name}</div>
              )}
            </div>
          </div>
          <div className="text-left flex-shrink-0 text-xs text-gray-500">
            {formatDate(shipment.created_date)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OrderShippingInfo({ order }) {
  let billingData = {};
  try { billingData = JSON.parse(order.raw_data_billing || '{}'); } catch {}
  let pickupData = {};
  try { pickupData = JSON.parse(order.pickup_point_data || '{}'); } catch {}

  const address = [billingData.address_1, billingData.address_2, billingData.city, billingData.postcode].filter(Boolean).join(', ');
  const hasPickup = pickupData?.point_id || pickupData?.name;
  const hasTracking = order.tracking_number;

  if (!address && !hasPickup && !hasTracking && !order.shipping_method) return null;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-3 sm:p-4">
        <div className="flex justify-between items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Package className="w-4 h-4 text-green-600 flex-shrink-0" />
              <span className="font-semibold text-sm">הזמנה #{order.external_order_number}</span>
              <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700">WooCommerce</Badge>
            </div>
            <div className="mt-2 space-y-1 text-xs text-gray-600">
              {order.shipping_method && <div>שיטת משלוח: {order.shipping_method}</div>}
              {address && (
                <div className="flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-gray-400" />
                  <span>{address}</span>
                </div>
              )}
              {hasPickup && (
                <div className="text-purple-600">נקודת איסוף: {pickupData.name || pickupData.point_id}</div>
              )}
              {hasTracking && (
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">מעקב:</span>
                  <span className="font-mono font-medium">{order.tracking_number}</span>
                  {order.tracking_url && (
                    <a href={order.tracking_url} target="_blank" rel="noopener noreferrer" className="text-blue-600">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="text-left flex-shrink-0 text-xs text-gray-500">
            {formatDate(order.order_date)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SPOrderShippingInfo({ spOrder }) {
  const address = [spOrder.shipping_street, spOrder.shipping_city, spOrder.shipping_zip].filter(Boolean).join(', ');
  const name = `${spOrder.customer_first_name || ''} ${spOrder.customer_last_name || ''}`.trim();

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-3 sm:p-4">
        <div className="flex justify-between items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Package className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span className="font-semibold text-sm">הזמנה #{spOrder.mirakl_order_id}</span>
              <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700">סופר-פארם</Badge>
              {spOrder.order_state && (
                <Badge className={`text-[10px] ${
                  spOrder.order_state === 'SHIPPED' || spOrder.order_state === 'CLOSED' || spOrder.order_state === 'RECEIVED' ? 'bg-green-100 text-green-800' :
                  spOrder.order_state === 'CANCELED' || spOrder.order_state === 'REFUSED' ? 'bg-red-100 text-red-800' :
                  'bg-blue-100 text-blue-800'
                }`}>{spOrder.order_state}</Badge>
              )}
            </div>
            <div className="mt-2 space-y-1 text-xs text-gray-600">
              {address && (
                <div className="flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-gray-400" />
                  <span>{address}</span>
                </div>
              )}
              {spOrder.tracking_number && (
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">מעקב:</span>
                  <span className="font-mono font-medium">{spOrder.tracking_number}</span>
                </div>
              )}
              {spOrder.carrier_name && <div>שליח: {spOrder.carrier_name}</div>}
              {spOrder.linet_invoice_doc_number && (
                <div>חשבונית לינט: #{spOrder.linet_invoice_doc_number}</div>
              )}
            </div>
          </div>
          <div className="text-left flex-shrink-0">
            <div className="text-xs text-gray-500">{formatDate(spOrder.created_at_mirakl)}</div>
            {spOrder.total_price > 0 && (
              <div className="font-bold text-green-600 mt-1">₪{spOrder.total_price}</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CustomerShippingTab({ shipments, orders, spOrders }) {
  const shipmentsList = shipments || [];
  const ordersList = orders || [];
  const spOrdersList = spOrders || [];

  // Orders that have shipping data
  const ordersWithShipping = ordersList.filter(o =>
    o.tracking_number || o.shipping_method || o.raw_data_billing || o.pickup_point_data
  );

  const totalItems = shipmentsList.length + ordersWithShipping.length + spOrdersList.length;

  if (totalItems === 0) {
    return (
      <div className="text-center py-10 text-gray-500">
        <Truck className="w-16 h-16 mx-auto mb-4 text-gray-400" />
        <p>אין נתוני משלוח ללקוח זה</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {shipmentsList.length > 0 && (
          <Badge variant="outline" className="bg-blue-50 border-blue-200 text-blue-700 px-3 py-1">
            <Truck className="w-3.5 h-3.5 ml-1" />{shipmentsList.length} משלוחים
          </Badge>
        )}
        {spOrdersList.length > 0 && (
          <Badge variant="outline" className="bg-emerald-50 border-emerald-200 text-emerald-700 px-3 py-1">
            {spOrdersList.length} הזמנות סופר-פארם
          </Badge>
        )}
        {ordersWithShipping.length > 0 && (
          <Badge variant="outline" className="bg-purple-50 border-purple-200 text-purple-700 px-3 py-1">
            {ordersWithShipping.length} הזמנות אתר
          </Badge>
        )}
      </div>

      {/* System shipments */}
      {shipmentsList.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">משלוחים מהמערכת</h3>
          {shipmentsList.map(s => <ShipmentCard key={s.id} shipment={s} />)}
        </div>
      )}

      {/* SP orders */}
      {spOrdersList.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">הזמנות סופר-פארם</h3>
          {spOrdersList.map(sp => <SPOrderShippingInfo key={sp.id} spOrder={sp} />)}
        </div>
      )}

      {/* WooCommerce orders with shipping */}
      {ordersWithShipping.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">משלוחים מהאתר (WooCommerce)</h3>
          {ordersWithShipping.map(o => <OrderShippingInfo key={o.id} order={o} />)}
        </div>
      )}
    </div>
  );
}