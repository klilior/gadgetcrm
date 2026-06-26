import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MessageCircle, Phone, Truck, CheckCircle, Copy, MapPin, StickyNote, Package, Clock, Receipt, Store, RotateCcw, Repeat, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import GetPackageOrderCard from "../getpackage/GetPackageOrderCard";
import TrackingSection from "./TrackingSection";
import { format, differenceInHours } from "date-fns";
import SourceBadge from "./SourceBadge";
import { getStatusLabel, getStatusOptions, getStatusColor, getShipmentBlockReason } from "./OrderStatusConfig";
import { detectShippingType, getShippingTypeBadge } from "./ShippingTypeHelper";
import { getBlockingItems, getNextActionLabel, getPrimaryActionLabel, getSourceLabel, isSerialWaiting } from "./orderUiHelpers";
import ProductMetaBadges from "./ProductMetaBadges";
import OrderTreatmentTimeline from "./OrderTreatmentTimeline";
import MarkSerialMenu from "../serial/MarkSerialMenu";
import SerialFulfillmentPanel from "../serial/SerialFulfillmentPanel";

function copyText(text) {
  navigator.clipboard.writeText(text);
}

function formatDate(d) {
  if (!d) return '-';
  try { return format(new Date(d), "dd/MM/yyyy HH:mm"); } catch { return '-'; }
}

// Wrapper that only shows GetPackage card if there are existing shipments for this order
function GetPackageOrderCardWrapper({ order, isManager, isShiftManager }) {
  const [show, setShow] = React.useState(false);

  // Listen for external event to show the card
  React.useEffect(() => {
    const handler = () => {
      setShow(true);
      // Re-dispatch the event after a short delay so the card's own listener picks it up
      setTimeout(() => window.dispatchEvent(new CustomEvent('openGetPackageQuoteForm')), 100);
    };
    window.addEventListener('openGetPackageQuoteForm', handler);
    return () => window.removeEventListener('openGetPackageQuoteForm', handler);
  }, []);

  // Always render if explicitly opened, let the card itself handle loading/checking
  if (show) {
    return (
      <div data-getpackage-card>
        <GetPackageOrderCard order={order} isManager={isManager} isShiftManager={isShiftManager} />
      </div>
    );
  }

  // Otherwise, render a "lazy" version that checks if shipments exist
  return <GetPackageCardLazy order={order} isManager={isManager} isShiftManager={isShiftManager} />;
}

function GetPackageCardLazy({ order, isManager, isShiftManager }) {
  const [hasShipments, setHasShipments] = React.useState(false);
  const [checked, setChecked] = React.useState(false);
  const orderId = order.id || order.order_number || order.external_order_number;

  React.useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const { getPackageApi } = await import("@/functions/getPackageApi");
        const { data } = await getPackageApi({ action: "getShipmentsForOrder", order_id: orderId });
        if (!cancelled) {
          const shipments = data?.shipments || [];
          setHasShipments(shipments.length > 0 && shipments.some(s => !['draft', 'cancelled', 'failed'].includes(s.status)));
          setChecked(true);
        }
      } catch {
        if (!cancelled) setChecked(true);
      }
    };
    check();
    return () => { cancelled = true; };
  }, [orderId]);

  if (!checked || !hasShipments) return null;

  return (
    <div data-getpackage-card>
      <GetPackageOrderCard order={order} isManager={isManager} isShiftManager={isShiftManager} />
    </div>
  );
}

export default function OrderDetailPanel({ order, onSms, onStatusChange, onShipment, onCreateInvoice, onCargoShipment, onGetPackageShipment, activeProviders = {}, isManager = false, isShiftManager = false }) {
  const statusColor = getStatusColor(order.source, order.status);
  const statusLabel = getStatusLabel(order.source, order.status);
  const statusOptions = getStatusOptions(order.source);
  const shippingType = detectShippingType(order);
  const shippingBadge = getShippingTypeBadge(shippingType);
  const shipmentBlockReason = getShipmentBlockReason(order.source, order.status);
  const hasShipment = Boolean(order.tracking_number || order.shipment_created_at || order.status === 'completed' || order.status === 'SHIPPED' || order.status === 'נוצר משלוח');
  const blockingItems = getBlockingItems(order);
  const nextActionLabel = getNextActionLabel(order);
  const primaryActionLabel = getPrimaryActionLabel(order);

  const isMiraklNew = order.source === 'mirakl' && order.status === 'WAITING_ACCEPTANCE';
  const hoursSince = order.order_date ? differenceInHours(new Date(), new Date(order.order_date)) : 0;
  const [serialRefreshKey, setSerialRefreshKey] = React.useState(0);
  const orderIdForSerial = order.id || order.order_number || order.external_order_number;

  const runPrimaryAction = () => {
    if (isMiraklNew) {
      onStatusChange(order, 'accept_mirakl');
      return;
    }
    if (shipmentBlockReason || isSerialWaiting(order)) return;
    if (shippingType === 'cargo') {
      onCargoShipment ? onCargoShipment(order) : onShipment({ ...order, _shipCarrier: 'velo' });
      return;
    }
    if (shippingType === 'getpackage' && onGetPackageShipment) {
      onGetPackageShipment(order);
      window.dispatchEvent(new CustomEvent('openGetPackageQuoteForm'));
      return;
    }
    onShipment({ ...order, _shipCarrier: 'ups' });
  };

  return (
    <div dir="rtl" className="bg-slate-50/70 p-4 md:p-5 space-y-4 border-t border-gray-100">
      {/* Self-pickup alert banner */}
      {shippingType === 'self_pickup' && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <Store className="w-5 h-5 text-emerald-700" />
          </div>
          <div>
            <p className="text-emerald-900 font-bold text-base">איסוף עצמי מהחנות</p>
            <p className="text-emerald-700 text-sm font-medium">
              {order.shipping_method || 'הלקוח בחר איסוף עצמי — אין צורך במשלוח'}
            </p>
          </div>
        </div>
      )}

      {/* Top row - source, order number, time */}
      <div className="flex flex-wrap items-center gap-3">
        <SourceBadge source={order.source} />
        <span className="font-mono text-lg font-bold text-gray-900">#{order.order_number}</span>
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <Clock className="w-3.5 h-3.5" />
          {formatDate(order.order_date)}
          {hoursSince > 0 && <span className="text-gray-400">(לפני {hoursSince > 48 ? `${Math.round(hoursSince/24)} ימים` : `${hoursSince} שעות`})</span>}
        </div>
        {hoursSince > 24 && (
          <Badge className="bg-red-50 text-red-700 border border-red-100 text-[10px] shadow-none">ישנה</Badge>
        )}
        <Badge className="bg-white text-gray-700 border border-gray-200 text-[10px] shadow-none">הפעולה הבאה: {nextActionLabel}</Badge>
      </div>

      {/* Main info grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Customer */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm space-y-2">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">לקוח</h4>
          <p className="font-bold text-gray-900 text-base">{order.customer_name || 'לא ידוע'}</p>
          {order.customer_phone && (
            <div className="flex items-center gap-2">
              <a href={`tel:${order.customer_phone}`} className="text-blue-600 hover:underline text-sm font-mono">
                {order.customer_phone}
              </a>
              <button onClick={() => copyText(order.customer_phone)} className="text-gray-400 hover:text-gray-600" title="העתק">
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="text-xs text-gray-500">
            <span className="font-semibold">מקור הזמנה:</span> {getSourceLabel(order.source)}
          </div>
          {(order.shipping_address_full || order.shipping_street || order.shipping_city) && (
            <div className="flex items-start gap-1 text-xs text-gray-500">
              <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>{order.shipping_address_full || [order.shipping_street, order.shipping_city, order.shipping_zip].filter(Boolean).join(', ')}</span>
              <button onClick={() => copyText(order.shipping_address_full || [order.shipping_street, order.shipping_city, order.shipping_zip].filter(Boolean).join(', '))} className="text-gray-400 hover:text-gray-600 flex-shrink-0" title="העתק כתובת">
                <Copy className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {/* Products */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm space-y-2">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
            <Package className="w-3 h-3" /> מוצרים ({order.products?.length || 0})
          </h4>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {(order.products || []).map((p, i) => (
              <div key={i} className="text-sm">
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-gray-800 break-words">{p.name}</span>
                    {p.sku && <div className="text-[11px] text-gray-400 font-mono">SKU: {p.sku}</div>}
                    {isSerialWaiting(order) && <Badge className="mt-1 bg-purple-50 text-[#7D0F82] border border-purple-100 text-[10px] shadow-none">סריאלי בהמשך</Badge>}
                    {p.sku && (
                      <div className="mt-0.5">
                        <MarkSerialMenu
                          sku={p.sku}
                          orderItemId={`${orderIdForSerial}__${p.sku || i}`}
                          currentlySerial={false}
                          onChanged={() => setSerialRefreshKey((k) => k + 1)}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 mr-2">
                    <span className="text-gray-500">×{p.quantity}</span>
                    {p.total > 0 && <span className="font-mono text-gray-700">₪{p.total.toLocaleString()}</span>}
                  </div>
                </div>
                <ProductMetaBadges metaData={p.meta_data} />
              </div>
            ))}
            {(!order.products || order.products.length === 0) && (
              <p className="text-gray-400 text-sm">אין פריטים</p>
            )}
          </div>
          <div className="border-t pt-2 flex justify-between items-center">
            <span className="text-sm text-gray-500">סה״כ</span>
            <span className="font-bold text-lg text-gray-900">₪{(order.total || 0).toLocaleString()}</span>
          </div>
        </div>

        {/* Status + Shipping */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm space-y-2">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">טיפול</h4>
          <div className="flex items-center gap-2">
            <Badge className={`${statusColor} text-sm px-3`}>{statusLabel}</Badge>
          </div>
          {/* Shipping type indicator */}
          {shippingBadge && (
            <div className="mt-1">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium text-sm ${shippingBadge.className}`}>
                <Truck className="w-4 h-4" /> {shippingBadge.label}
              </span>
            </div>
          )}
          {!shippingBadge && order.shipping_method && (
            <div className="flex items-center gap-1 text-sm text-gray-600">
              <Truck className="w-3.5 h-3.5" />
              {order.shipping_method}
            </div>
          )}
          {order.tracking_number && (
            <div className="text-xs text-gray-500">
              <span className="font-semibold">מספר מעקב:</span> {order.tracking_number}
            </div>
          )}
          {(order.linet_invoice_doc_number || order.linet_invoice_doc_id) && (
            <div className="text-xs text-gray-500">
              <span className="font-semibold">חשבונית:</span> {order.linet_invoice_doc_number || order.linet_invoice_doc_id}
            </div>
          )}
          {blockingItems.length > 0 && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">
              <span className="font-semibold">חסימות:</span> {blockingItems.join(' / ')}
            </div>
          )}
          {isSerialWaiting(order) && (
            <div className="text-xs text-[#7D0F82] bg-purple-50 border border-purple-100 rounded-lg p-2">
              רכיב סריאלי עתידי יוצג כאן.
            </div>
          )}
          {order.sales_rep && (
            <div className="text-xs text-gray-500">
              <span className="font-semibold">נציג:</span> {order.sales_rep}
            </div>
          )}
          {order.linet_doc_id && (
            <div className="text-xs text-gray-500">
              <span className="font-semibold">מזהה לינט:</span> {order.linet_doc_id}
            </div>
          )}
          {order.notes && (
            <div className="mt-2 bg-yellow-50 rounded-lg p-2 text-xs text-yellow-800 border border-yellow-200">
              <div className="flex items-center gap-1 font-semibold mb-0.5"><StickyNote className="w-3 h-3" /> הערת לקוח:</div>
              <p className="whitespace-pre-wrap">{order.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Tracking Section - shown when tracking exists */}
      {order.tracking_number && (
        <TrackingSection order={order} />
      )}

      {/* GetPackage Shipment Card - shown only when there's an active GP shipment or user clicked GP button */}
      <GetPackageOrderCardWrapper order={order} isManager={isManager} isShiftManager={isShiftManager} />

      <OrderTreatmentTimeline order={order} />

      {/* Serial handling area (Steps 7,10,12) — only renders if a line requires a serial */}
      <SerialFulfillmentPanel key={serialRefreshKey} order={order} />

      {(shipmentBlockReason || blockingItems.length > 0) && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-3 text-sm text-red-800">
          <div className="font-bold mb-1">כדי להמשיך חסר: {blockingItems.length > 0 ? blockingItems.join(' / ') : shipmentBlockReason}</div>
          {shipmentBlockReason && <div className="text-xs text-red-700">{shipmentBlockReason}</div>}
        </div>
      )}

      {/* Actions row */}
      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-100">
        <Button
          className="bg-[#7D0F82] hover:bg-[#6a0c6f] text-white rounded-xl px-5 shadow-sm"
          disabled={Boolean(shipmentBlockReason) || isSerialWaiting(order) || (hasShipment && primaryActionLabel === 'השלם הזמנה')}
          onClick={runPrimaryAction}
        >
          <CheckCircle className="w-4 h-4 ml-1" />
          {isMiraklNew ? 'אשר הזמנה' : primaryActionLabel}
        </Button>

        {!isMiraklNew && (
          <Select value={order.status} onValueChange={(val) => onStatusChange(order, val)}>
            <SelectTrigger className="h-9 w-[160px] text-sm rounded-xl border-gray-200 bg-white">
              <SelectValue placeholder="שינוי סטטוס" />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button variant="outline" className="rounded-xl border-gray-200 bg-white hover:bg-purple-50 hover:border-purple-200 hover:text-[#7D0F82] transition-colors" onClick={() => onSms(order)}>
          <MessageCircle className="w-4 h-4 ml-1" />
          שלח SMS
        </Button>

        {order.customer_phone && (
          <Button variant="outline" className="rounded-xl border-gray-200 bg-white hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-colors" asChild>
            <a href={`tel:${order.customer_phone}`}>
              <Phone className="w-4 h-4 ml-1" />
              התקשר
            </a>
          </Button>
        )}

        {order.customer_phone && (
          <Button variant="outline" className="rounded-xl text-emerald-700 border-gray-200 bg-white hover:bg-emerald-50 hover:border-emerald-200 transition-colors" asChild>
            <a href={`https://wa.me/972${order.customer_phone.replace(/^0/, '')}`} target="_blank" rel="noopener noreferrer">
              💬 וואטסאפ
            </a>
          </Button>
        )}

        {/* Shipping buttons - blocked when the order was not paid or was cancelled */}
        {shipmentBlockReason ? (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2 flex items-center gap-2 text-red-800 text-sm font-medium">
            <Truck className="w-4 h-4" />
            {shipmentBlockReason}
          </div>
        ) : (
        <div className="flex flex-wrap items-center gap-2">
          {/* Cargo - Blue - שליח עד הבית */}
          <Button
            variant="outline"
            className={`rounded-xl bg-white transition-colors ${
              shippingType === 'cargo'
                ? 'border-[#7D0F82] text-[#7D0F82] bg-purple-50'
                : 'border-gray-200 text-gray-700 hover:bg-slate-50'
            }`}
            onClick={() => onCargoShipment ? onCargoShipment(order) : onShipment({ ...order, _shipCarrier: 'velo' })}
          >
            <Truck className="w-4 h-4 ml-1" />
            🚚 קארגו
            {shippingType === 'cargo' && <span className="text-[10px] mr-1 opacity-80">• הלקוח בחר</span>}
          </Button>

          {/* UPS - Brown/Amber - נקודות איסוף */}
          <Button
            variant="outline"
            className={`rounded-xl bg-white transition-colors ${
              shippingType === 'ups'
                ? 'border-[#7D0F82] text-[#7D0F82] bg-purple-50'
                : 'border-gray-200 text-gray-700 hover:bg-slate-50'
            }`}
            onClick={() => onShipment({ ...order, _shipCarrier: 'ups' })}
          >
            <Package className="w-4 h-4 ml-1" />
            📦 UPS
            {shippingType === 'ups' && <span className="text-[10px] mr-1 opacity-80">• הלקוח בחר</span>}
          </Button>

          {/* GetPackage - Red - מהיום להיום */}
          <Button
            variant="outline"
            className={`rounded-xl bg-white transition-colors ${
              shippingType === 'getpackage'
                ? 'border-[#7D0F82] text-[#7D0F82] bg-purple-50'
                : 'border-gray-200 text-gray-700 hover:bg-slate-50'
            }`}
            onClick={() => {
              // Scroll to the GetPackage card and auto-open the quote form
              if (onGetPackageShipment) onGetPackageShipment(order);
              // Dispatch custom event to open the quote form
              window.dispatchEvent(new CustomEvent('openGetPackageQuoteForm'));
            }}
          >
            <Truck className="w-4 h-4 ml-1" />
            ⚡ GetPackage
            {shippingType === 'getpackage' && <span className="text-[10px] mr-1 opacity-80">• הלקוח בחר</span>}
          </Button>
        </div>
        )}

        {((hasShipment && !shipmentBlockReason) || (onCreateInvoice && (order.source === 'mirakl' || order.linet_invoice_doc_id))) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="rounded-xl border-gray-200 bg-white text-gray-700 hover:bg-slate-50">
                <MoreHorizontal className="w-4 h-4 ml-1" />
                עוד פעולות
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {hasShipment && !shipmentBlockReason && (
                <>
                  <DropdownMenuItem onSelect={() => onCargoShipment ? onCargoShipment({ ...order, _cargoShipmentType: 'exchange' }) : undefined}>
                    <Repeat className="w-4 h-4 ml-2" /> החלפה קארגו
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onCargoShipment ? onCargoShipment({ ...order, _cargoShipmentType: 'return' }) : undefined}>
                    <RotateCcw className="w-4 h-4 ml-2" /> החזרת קארגו
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onShipment({ ...order, _shipCarrier: 'ups', _upsShipmentType: 'pickup_drop' })}>
                    <Package className="w-4 h-4 ml-2" /> PICKUP DROP UPS
                  </DropdownMenuItem>
                </>
              )}
              {onCreateInvoice && (order.source === 'mirakl' || order.linet_invoice_doc_id) && (
                <DropdownMenuItem onSelect={() => {
                  const spOrder = {
                    mirakl_order_id: order.mirakl_order_id || order.order_number,
                    customer_first_name: order.customer_first_name || order.customer_name?.split(' ')[0] || '',
                    customer_last_name: order.customer_last_name || order.customer_name?.split(' ').slice(1).join(' ') || '',
                    customer_phone: order.customer_phone || '',
                    order_lines_json: order.order_lines_json || JSON.stringify(order.products?.map(p => ({ product_title: p.name, offer_sku: '', quantity: p.quantity, total_price: p.total, price: p.total })) || []),
                    total_price: order.total || 0,
                    linet_invoice_doc_id: order.linet_invoice_doc_id || '',
                    linet_invoice_doc_number: order.linet_invoice_doc_number || '',
                    linet_invoice_pdf_url: order.linet_invoice_pdf_url || '',
                    linet_invoice_email_sent: order.linet_invoice_email_sent || false,
                  };
                  onCreateInvoice(spOrder);
                }}>
                  <Receipt className="w-4 h-4 ml-2" />
                  {order.linet_invoice_doc_id ? `חשבונית #${order.linet_invoice_doc_number || order.linet_invoice_doc_id}` : 'חשבונית לינט'}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}