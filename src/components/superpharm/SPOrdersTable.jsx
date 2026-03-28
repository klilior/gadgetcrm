import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, Clock, AlertTriangle } from "lucide-react";

const STATE_CONFIG = {
  WAITING_ACCEPTANCE: { label: "ממתין לאישור", color: "bg-orange-100 text-orange-800 border-orange-200", icon: "⏳" },
  WAITING_DEBIT: { label: "ממתין לחיוב", color: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: "💳" },
  WAITING_DEBIT_PAYMENT: { label: "ממתין לתשלום", color: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: "💳" },
  SHIPPING: { label: "מוכן למשלוח", color: "bg-blue-100 text-blue-800 border-blue-200", icon: "📦" },
  SHIPPED: { label: "נשלח", color: "bg-green-100 text-green-800 border-green-200", icon: "🚚" },
  TO_COLLECT: { label: "לאיסוף", color: "bg-purple-100 text-purple-800 border-purple-200", icon: "🏪" },
  RECEIVED: { label: "התקבל", color: "bg-green-100 text-green-800 border-green-200", icon: "✅" },
  CLOSED: { label: "נסגר", color: "bg-gray-100 text-gray-800 border-gray-200", icon: "🔒" },
  REFUSED: { label: "נדחה", color: "bg-red-100 text-red-800 border-red-200", icon: "❌" },
  CANCELED: { label: "בוטל", color: "bg-red-100 text-red-800 border-red-200", icon: "🚫" },
};

function isUrgent(order) {
  if (order.order_state === "WAITING_ACCEPTANCE" && order.acceptance_decision_date) {
    const deadline = new Date(order.acceptance_decision_date);
    const hoursLeft = (deadline - new Date()) / (1000 * 60 * 60);
    return hoursLeft < 4;
  }
  if (order.order_state === "SHIPPING" && order.shipping_deadline) {
    const deadline = new Date(order.shipping_deadline);
    const hoursLeft = (deadline - new Date()) / (1000 * 60 * 60);
    return hoursLeft < 12;
  }
  return false;
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function SPOrdersTable({ orders, onSelectOrder }) {
  if (!orders || orders.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg">אין הזמנות להצגה</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50/50">
            <th className="text-right p-3 font-medium text-gray-600">הזמנה</th>
            <th className="text-right p-3 font-medium text-gray-600">לקוח</th>
            <th className="text-right p-3 font-medium text-gray-600">סטטוס</th>
            <th className="text-right p-3 font-medium text-gray-600">פריטים</th>
            <th className="text-right p-3 font-medium text-gray-600">סכום</th>
            <th className="text-right p-3 font-medium text-gray-600">תאריך</th>
            <th className="text-right p-3 font-medium text-gray-600">דד-ליין</th>
            <th className="text-center p-3 font-medium text-gray-600"></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const state = STATE_CONFIG[order.order_state] || { label: order.order_state, color: "bg-gray-100 text-gray-800", icon: "❓" };
            const urgent = isUrgent(order);
            const deadline = order.order_state === "WAITING_ACCEPTANCE" ? order.acceptance_decision_date : order.shipping_deadline;

            return (
              <tr
                key={order.id}
                className={`border-b hover:bg-gray-50 cursor-pointer transition-colors ${urgent ? "bg-red-50/50" : ""}`}
                onClick={() => onSelectOrder(order)}
              >
                <td className="p-3 font-mono text-xs">
                  <div className="flex items-center gap-1.5">
                    {urgent && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                    {order.mirakl_order_id}
                  </div>
                </td>
                <td className="p-3">
                  <div className="font-medium">{order.customer_first_name} {order.customer_last_name}</div>
                  <div className="text-xs text-gray-500">{order.shipping_city}</div>
                </td>
                <td className="p-3">
                  <Badge variant="outline" className={`text-xs ${state.color}`}>
                    {state.icon} {state.label}
                  </Badge>
                </td>
                <td className="p-3 text-center">{order.order_lines_count || 0}</td>
                <td className="p-3 font-medium">₪{(order.total_price || 0).toLocaleString()}</td>
                <td className="p-3 text-xs text-gray-600">{formatDate(order.created_at_mirakl)}</td>
                <td className="p-3">
                  {deadline ? (
                    <div className={`flex items-center gap-1 text-xs ${urgent ? "text-red-600 font-medium" : "text-gray-500"}`}>
                      <Clock className="w-3 h-3" />
                      {formatDate(deadline)}
                    </div>
                  ) : "-"}
                </td>
                <td className="p-3 text-center">
                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onSelectOrder(order); }}>
                    <Eye className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}