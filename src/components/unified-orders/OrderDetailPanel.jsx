import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageCircle, Phone, Truck, CheckCircle, Copy, MapPin, StickyNote, Package, Clock } from "lucide-react";
import { format, differenceInHours } from "date-fns";
import SourceBadge from "./SourceBadge";
import { getStatusLabel, getStatusOptions, getStatusColor } from "./OrderStatusConfig";

function copyText(text) {
  navigator.clipboard.writeText(text);
}

function formatDate(d) {
  if (!d) return '-';
  try { return format(new Date(d), "dd/MM/yyyy HH:mm"); } catch { return '-'; }
}

export default function OrderDetailPanel({ order, onSms, onStatusChange, onShipment }) {
  const statusColor = getStatusColor(order.source, order.status);
  const statusLabel = getStatusLabel(order.source, order.status);
  const statusOptions = getStatusOptions(order.source);
  const isMiraklNew = order.source === 'mirakl' && order.status === 'WAITING_ACCEPTANCE';
  const hoursSince = order.order_date ? differenceInHours(new Date(), new Date(order.order_date)) : 0;

  const sourceBg = {
    woocommerce: 'from-purple-50/80 via-white to-white border-purple-100',
    mirakl: 'from-blue-50/80 via-white to-white border-blue-100',
    linet: 'from-amber-50/80 via-white to-white border-amber-100',
  };

  return (
    <div dir="rtl" className={`bg-gradient-to-br ${sourceBg[order.source] || 'from-slate-50 to-white border-gray-100'} p-4 md:p-5 space-y-4 border-t`}>
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
          <Badge className="bg-red-100 text-red-700 text-[10px]">⚠ ישנה</Badge>
        )}
      </div>

      {/* Main info grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Customer */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-gray-100 shadow-sm space-y-2 hover:shadow-md transition-shadow">
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
          {order.shipping_city && (
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <MapPin className="w-3 h-3" />
              {order.shipping_city}
            </div>
          )}
        </div>

        {/* Products */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-gray-100 shadow-sm space-y-2 hover:shadow-md transition-shadow">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
            <Package className="w-3 h-3" /> מוצרים ({order.products?.length || 0})
          </h4>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {(order.products || []).map((p, i) => (
              <div key={i} className="flex justify-between items-center text-sm">
                <span className="text-gray-800 truncate flex-1">{p.name}</span>
                <div className="flex items-center gap-2 flex-shrink-0 mr-2">
                  <span className="text-gray-500">×{p.quantity}</span>
                  {p.total > 0 && <span className="font-mono text-gray-700">₪{p.total.toLocaleString()}</span>}
                </div>
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
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-gray-100 shadow-sm space-y-2 hover:shadow-md transition-shadow">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">סטטוס ומשלוח</h4>
          <div className="flex items-center gap-2">
            <Badge className={`${statusColor} text-sm px-3`}>{statusLabel}</Badge>
          </div>
          {order.shipping_method && (
            <div className="flex items-center gap-1 text-sm text-gray-600">
              <Truck className="w-3.5 h-3.5" />
              {order.shipping_method}
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
          {order.tracking_number && (
            <div className="text-xs text-gray-500">
              <span className="font-semibold">מעקב:</span> {order.tracking_number}
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

      {/* Actions row */}
      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-100">
        {isMiraklNew ? (
          <Button
            className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white rounded-full px-5 shadow-lg shadow-green-200 animate-pulse"
            onClick={() => onStatusChange(order, 'accept_mirakl')}
          >
            <CheckCircle className="w-4 h-4 ml-1" />
            אשר הזמנה
          </Button>
        ) : (
          <Select value={order.status} onValueChange={(val) => onStatusChange(order, val)}>
            <SelectTrigger className="h-9 w-[160px] text-sm rounded-full border-gray-200">
              <SelectValue placeholder="שנה סטטוס" />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button variant="outline" className="rounded-full hover:bg-purple-50 hover:border-purple-300 hover:text-purple-700 transition-colors" onClick={() => onSms(order)}>
          <MessageCircle className="w-4 h-4 ml-1" />
          שלח SMS
        </Button>

        {order.customer_phone && (
          <Button variant="outline" className="rounded-full hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors" asChild>
            <a href={`tel:${order.customer_phone}`}>
              <Phone className="w-4 h-4 ml-1" />
              התקשר
            </a>
          </Button>
        )}

        {order.customer_phone && (
          <Button variant="outline" className="rounded-full text-green-700 border-green-200 hover:bg-green-50 hover:shadow-md transition-all" asChild>
            <a href={`https://wa.me/972${order.customer_phone.replace(/^0/, '')}`} target="_blank" rel="noopener noreferrer">
              💬 וואטסאפ
            </a>
          </Button>
        )}

        <Button variant="outline" className="rounded-full hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 transition-colors" onClick={() => onShipment(order)}>
          <Truck className="w-4 h-4 ml-1" />
          צור משלוח
        </Button>
      </div>
    </div>
  );
}