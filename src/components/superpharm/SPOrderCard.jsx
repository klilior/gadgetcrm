import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, Truck, Package, MapPin, Phone, User, Clock, AlertTriangle, Receipt } from "lucide-react";

const STATE_CONFIG = {
  WAITING_ACCEPTANCE: { label: "ממתין לאישור", color: "bg-orange-100 text-orange-800 border-orange-200", icon: "⏳" },
  WAITING_DEBIT: { label: "ממתין לחיוב", color: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: "💳" },
  WAITING_DEBIT_PAYMENT: { label: "ממתין לתשלום", color: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: "💳" },
  SHIPPING: { label: "ממתין למשלוח", color: "bg-blue-100 text-blue-800 border-blue-200", icon: "📦" },
  SHIPPED: { label: "נשלח", color: "bg-green-100 text-green-800 border-green-200", icon: "✅" },
  TO_COLLECT: { label: "לאיסוף", color: "bg-purple-100 text-purple-800 border-purple-200", icon: "🏪" },
  RECEIVED: { label: "התקבל", color: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: "✅" },
  CLOSED: { label: "נסגר", color: "bg-gray-100 text-gray-800 border-gray-200", icon: "🔒" },
  REFUSED: { label: "נדחה", color: "bg-red-100 text-red-800 border-red-200", icon: "❌" },
  CANCELED: { label: "בוטל", color: "bg-red-100 text-red-800 border-red-200", icon: "🚫" },
};

function formatDate(dateStr) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function timeLeft(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  if (diff < 0) return "עבר!";
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 24) return `${Math.floor(hours / 24)} ימים`;
  return `${hours}:${String(mins).padStart(2, "0")} שעות`;
}

function isUrgent(order) {
  if (order.order_state === "WAITING_ACCEPTANCE" && order.acceptance_decision_date) {
    return (new Date(order.acceptance_decision_date) - new Date()) / 3600000 < 4;
  }
  if (order.order_state === "SHIPPING" && order.shipping_deadline) {
    return (new Date(order.shipping_deadline) - new Date()) / 3600000 < 12;
  }
  return false;
}

function detectPickup(order) {
  try {
    // Check raw Mirakl JSON for shipping_type_code at order level
    const raw = JSON.parse(order.raw_mirakl_json || "{}");
    if (raw.shipping_type_code === "pickup-locations") return true;
    const label = (raw.shipping_type_label || "").toLowerCase();
    if (label.includes("איסוף") || label.includes("pickup")) return true;
    return false;
  } catch {
    return false;
  }
}

export default function SPOrderCard({ order, onAccept, onShip, onCreateInvoice }) {
  const state = STATE_CONFIG[order.order_state] || { label: order.order_state, color: "bg-gray-100 text-gray-800", icon: "❓" };
  const urgent = isUrgent(order);
  const isPickup = detectPickup(order);

  const lines = (() => {
    try { return JSON.parse(order.order_lines_json || "[]"); } catch { return []; }
  })();

  const deadline = order.order_state === "WAITING_ACCEPTANCE" 
    ? order.acceptance_decision_date 
    : order.shipping_deadline;
  const remaining = timeLeft(deadline);

  return (
    <Card className={`transition-all hover:shadow-md ${urgent ? "ring-2 ring-red-300 bg-red-50/30" : ""}`}>
      <CardContent className="p-4 space-y-3">
        {/* Header: Order ID + Status + Date */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              {urgent && <AlertTriangle className="w-4 h-4 text-red-500" />}
              <span className="font-bold text-base font-mono">{order.mirakl_order_id}</span>
            </div>
            <div className="text-xs text-gray-500 mt-0.5">{formatDate(order.created_at_mirakl)}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant="outline" className={`text-xs ${state.color}`}>
              {state.icon} {state.label}
            </Badge>
            {remaining && (
              <span className={`text-xs flex items-center gap-1 ${urgent ? "text-red-600 font-bold" : "text-gray-500"}`}>
                <Clock className="w-3 h-3" />
                {remaining}
              </span>
            )}
          </div>
        </div>

        {/* Products */}
        <div className="space-y-1.5">
          {lines.map((line, idx) => (
            <div key={idx} className="flex items-start justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-medium break-words">{line.product_title || line.offer_sku}</div>
                <div className="text-xs text-gray-500">SKU: {line.offer_sku} · כמות: {line.quantity}</div>
              </div>
              <div className="font-semibold mr-3">₪{(line.total_price || line.price || 0).toLocaleString()}</div>
            </div>
          ))}
        </div>

        {/* Shipping type indicator */}
        <div className="flex items-center gap-2 text-sm">
          {isPickup ? (
            <span className="flex items-center gap-1 text-blue-700 bg-blue-50 px-2 py-1 rounded-lg">
              <Package className="w-3.5 h-3.5" /> 📦 UPS נקודת איסוף
            </span>
          ) : (
            <span className="flex items-center gap-1 text-orange-700 bg-orange-50 px-2 py-1 rounded-lg">
              <Truck className="w-3.5 h-3.5" /> 🚚 שליח עד הבית
            </span>
          )}
        </div>

        {/* Customer info */}
        {(order.customer_first_name || order.customer_phone || order.shipping_city) && (
          <div className="border-t pt-2 space-y-1 text-sm text-gray-600">
            {(order.customer_first_name || order.customer_last_name) && (
              <div className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-gray-400" />
                <span>{order.customer_first_name} {order.customer_last_name}</span>
              </div>
            )}
            {order.customer_phone && (
              <div className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-gray-400" />
                <span dir="ltr">{order.customer_phone}</span>
              </div>
            )}
            {(order.shipping_street || order.shipping_city) && (
              <div className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-gray-400" />
                <span>{order.shipping_street}{order.shipping_street && order.shipping_city ? ", " : ""}{order.shipping_city} {order.shipping_zip || ""}</span>
              </div>
            )}
          </div>
        )}

        {/* Total + Commission */}
        <div className="flex items-center justify-between border-t pt-2">
          <span className="text-lg font-bold">₪{(order.total_price || 0).toLocaleString()}</span>
          {order.total_commission > 0 && (
            <span className="text-xs text-gray-500">עמלה: ₪{order.total_commission.toLocaleString()}</span>
          )}
        </div>

        {/* Tracking info if shipped */}
        {order.tracking_number && (
          <div className="flex items-center gap-2 bg-green-50 px-3 py-2 rounded-lg text-sm text-green-800">
            <CheckCircle className="w-4 h-4" />
            <span>מעקב: <span className="font-mono font-medium">{order.tracking_number}</span></span>
            {order.carrier_name && <span className="text-xs text-green-600">({order.carrier_name})</span>}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2 pt-1">
          {order.order_state === "WAITING_ACCEPTANCE" && (
            <Button
              onClick={() => onAccept(order)}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              size="sm"
            >
              ✅ אשר הזמנה
            </Button>
          )}

          {order.order_state === "SHIPPING" && (
            <>
              {isPickup ? (
                <Button
                  onClick={() => onShip(order, "ups")}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                  size="sm"
                >
                  📦 שלח UPS
                </Button>
              ) : (
                <Button
                  onClick={() => onShip(order, "velo")}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                  size="sm"
                >
                  🚚 שלח Velo
                </Button>
              )}
            </>
          )}

          {order.order_state === "SHIPPING" && (
            <Button
              onClick={() => onCreateInvoice(order)}
              variant="outline"
              className="flex-1 border-purple-300 text-purple-700 hover:bg-purple-50"
              size="sm"
            >
              💳 צור חשבונית לינט
            </Button>
          )}

          {order.order_state === "SHIPPED" && (
            <Button
              onClick={() => onCreateInvoice(order)}
              variant="outline"
              className="flex-1 border-purple-300 text-purple-700 hover:bg-purple-50"
              size="sm"
            >
              💳 צור חשבונית לינט
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}