import React from "react";
import { Badge } from "@/components/ui/badge";
import { Clock, PackageCheck, Hash, Send, Receipt, ShoppingCart } from "lucide-react";
import { format } from "date-fns";

function formatDate(date) {
  if (!date) return "—";
  try { return format(new Date(date), "dd/MM/yyyy HH:mm"); } catch { return "—"; }
}

function item(key, icon, title, date, description, color) {
  if (!date && key !== "order") return null;
  return { key, icon, title, date, description, color };
}

export default function OrderTreatmentTimeline({ order }) {
  const invoiceNumber = order.linet_invoice_doc_number || order.linet_doc_number || order.order_number;
  const invoiceDate = order.linet_invoice_created_at || order.invoice_created_at || (order.source === "linet" ? order.order_date : null);
  const shipmentDate = order.shipment_created_at || order.shipped_at || null;
  const trackingDate = order.tracking_created_at || shipmentDate;

  const events = [
    item("order", ShoppingCart, "ההזמנה נוצרה", order.order_date, `מס׳ הזמנה ${order.order_number || ""}`, "bg-slate-50 text-slate-600"),
    item("shipment", PackageCheck, "נוצר משלוח", shipmentDate, [order.tracking_carrier, order.tracking_number && `מעקב ${order.tracking_number}`].filter(Boolean).join(" • "), "bg-blue-50 text-blue-600"),
    item("tracking", Hash, "מספר מעקב", trackingDate, order.tracking_number || "", "bg-green-50 text-green-600"),
    item("sms", Send, "נשלח SMS", order.sms_sent_at, [order.sms_event_type || "עדכון ללקוח", order.sms_status].filter(Boolean).join(" • "), "bg-teal-50 text-teal-600"),
    item("invoice", Receipt, "יצאה חשבונית", invoiceDate, invoiceNumber ? `מס׳ חשבונית ${invoiceNumber}` : "", "bg-purple-50 text-purple-600"),
  ].filter(Boolean).sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  if (events.length <= 1) return null;

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-gray-100 shadow-sm">
      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1 mb-3">
        <Clock className="w-3.5 h-3.5" /> ציר זמן טיפול בהזמנה
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        {events.map((event, index) => {
          const Icon = event.icon;
          return (
            <div key={event.key} className="relative rounded-xl border border-gray-100 bg-gray-50/60 p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center ${event.color}`}>
                  <Icon className="w-3.5 h-3.5" />
                </span>
                <Badge variant="outline" className="text-[10px] bg-white">{index + 1}</Badge>
              </div>
              <p className="font-semibold text-sm text-gray-900">{event.title}</p>
              <p className="text-xs text-gray-500 mt-1">{formatDate(event.date)}</p>
              {event.description && <p className="text-xs text-gray-600 mt-1 break-words">{event.description}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}