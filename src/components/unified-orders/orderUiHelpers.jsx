import { getShipmentBlockReason, isClosedStatus } from "./OrderStatusConfig";

export function isSerialWaiting(order) {
  if (order?.has_pending_serial) return true;
  return order?.status === "wc-awaiting-serial" || String(order?.status || "").includes("סידורי");
}

export function isVisuallyClosed(order) {
  if (!order) return false;
  return isClosedStatus(order.source, order.status) || ["completed", "SHIPPED", "RECEIVED", "CLOSED", "טופל"].includes(order.status);
}

export function isBlockedOrder(order) {
  if (!order) return false;
  const status = String(order.status || "");
  return Boolean(getShipmentBlockReason(order.source, order.status)) ||
    ["cancelled", "failed", "CANCELED", "REFUSED"].includes(status);
}

export function isReadyForAction(order) {
  if (!order || isBlockedOrder(order) || isVisuallyClosed(order) || isSerialWaiting(order)) return false;
  if (order.source === "woocommerce") return ["processing", "ordered"].includes(order.status);
  if (order.source === "mirakl") return ["WAITING_ACCEPTANCE", "SHIPPING"].includes(order.status);
  if (order.source === "linet") return order.status !== "טופל";
  return false;
}

export function getNextActionLabel(order) {
  if (!order) return "לטיפול ידני";
  if (isVisuallyClosed(order)) return order.status === "cancelled" || order.status === "CANCELED" ? "לביטול" : "הושלם";
  if (isSerialWaiting(order)) return "בחר סריאלי";
  if (["on-hold", "pending", "WAITING_DEBIT", "WAITING_DEBIT_PAYMENT"].includes(order.status)) return "ממתין לתשלום";
  if (["cancelled", "failed", "CANCELED", "REFUSED"].includes(order.status)) return "לביטול";
  if (order.tracking_number || order.status === "נוצר משלוח" || order.status === "SHIPPED") return "הושלם";
  if (isReadyForAction(order)) return "להוציא משלוח";
  return "לטיפול ידני";
}

export function getOrderVisualState(order) {
  if (isVisuallyClosed(order)) {
    return { key: "closed", border: "border-r-gray-300", bg: "bg-gray-50/60", dot: "bg-gray-400", text: "text-gray-600" };
  }
  if (isBlockedOrder(order)) {
    return { key: "blocked", border: "border-r-red-400", bg: "bg-red-50/30", dot: "bg-red-500", text: "text-red-700" };
  }
  if (isSerialWaiting(order)) {
    return { key: "serial", border: "border-r-[#7D0F82]", bg: "bg-purple-50/30", dot: "bg-[#7D0F82]", text: "text-[#7D0F82]" };
  }
  if (isReadyForAction(order)) {
    return { key: "ready", border: "border-r-emerald-400", bg: "bg-emerald-50/30", dot: "bg-emerald-500", text: "text-emerald-700" };
  }
  return { key: "waiting", border: "border-r-amber-300", bg: "bg-amber-50/30", dot: "bg-amber-400", text: "text-amber-700" };
}

export function getBlockingItems(order) {
  if (!order) return [];
  const items = [];
  if (isSerialWaiting(order)) items.push("מספר סידורי");
  if (["on-hold", "pending", "WAITING_DEBIT", "WAITING_DEBIT_PAYMENT"].includes(order.status)) items.push("תשלום");
  if (["cancelled", "failed", "CANCELED", "REFUSED"].includes(order.status)) items.push("טיפול בסטטוס הזמנה");
  return items;
}

export function getPrimaryActionLabel(order) {
  if (!order) return "המשך טיפול";
  if (isVisuallyClosed(order)) return "השלם הזמנה";
  if (isBlockedOrder(order) || isSerialWaiting(order) || order.source === "mirakl" && order.status === "WAITING_ACCEPTANCE") return "המשך טיפול";
  if (order.tracking_number || order.status === "נוצר משלוח" || order.status === "SHIPPED") return "השלם הזמנה";
  return "צור משלוח";
}

export function getSourceLabel(source) {
  if (source === "woocommerce") return "אתר";
  if (source === "mirakl") return "Super‑Pharm";
  if (source === "linet") return "ידני";
  return source || "-";
}