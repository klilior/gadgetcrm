import React from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, AlertTriangle, Package, Truck, Store } from "lucide-react";
import { format, differenceInHours } from "date-fns";
import SourceBadge from "./SourceBadge";
import { getStatusLabel, getStatusColor, isClosedStatus } from "./OrderStatusConfig";
import { detectShippingType, getShippingTypeBadge, isUrgentSameDay } from "./ShippingTypeHelper";
import { getNextActionLabel, getOrderVisualState } from "./orderUiHelpers";

export default function UnifiedOrderRow({ order, isExpanded, onToggle, onSelect, isSelected, canBulk }) {
  const isClosed = isClosedStatus(order.source, order.status);
  const hoursSinceOrder = order.order_date ? differenceInHours(new Date(), new Date(order.order_date)) : 0;
  const isOld = hoursSinceOrder > 24 && !isClosed;
  const shippingType = detectShippingType(order);
  const shippingBadge = getShippingTypeBadge(shippingType);
  const isUrgent = isUrgentSameDay(order);
  const visual = getOrderVisualState(order);
  const nextAction = getNextActionLabel(order);

  const productsList = order.products || [];
  const hasMultiQty = productsList.some(p => (p.quantity || 1) > 1);
  const productSummary = productsList.length > 0
    ? productsList.slice(0, 2).map(p => `${p.name}${(p.quantity || 1) > 1 ? ` ×${p.quantity}` : ''}`).join(', ') + (productsList.length > 2 ? ` +${productsList.length - 2}` : '')
    : '-';

  const statusColor = getStatusColor(order.source, order.status);
  const statusLabel = getStatusLabel(order.source, order.status);

  const formatDate = (d) => {
    if (!d) return '-';
    try { return format(new Date(d), "dd/MM HH:mm"); } catch { return '-'; }
  };

  return (
    <>
    {isUrgent && !order.tracking_number && (
      <tr className="animate-pulse">
        <td colSpan={10} className="px-3 py-1 bg-red-600 text-white text-xs font-bold text-center">
          🚨 משלוח מהיום להיום! — יש לטפל בהזמנה #{order.order_number} בדחיפות לפני שתוקף השליח יפוג 🚨
        </td>
      </tr>
    )}
    <TableRow
      onClick={onToggle}
      className={`cursor-pointer select-none border-r-4 ${isUrgent && !order.tracking_number ? 'border-r-red-500' : visual.border} hover:bg-slate-50 transition-colors
        ${isClosed ? 'opacity-60' : ''}
        ${isExpanded ? 'bg-purple-50/40 border-b-0' : ''}
      `}
    >
      <TableCell className="font-mono text-sm font-bold whitespace-nowrap text-gray-900">
        #{order.order_number}
        {(isOld || isUrgent) && <AlertTriangle className="w-3 h-3 text-red-500 inline mr-1" />}
      </TableCell>
      <TableCell><SourceBadge source={order.source} /></TableCell>
      <TableCell className="text-xs text-gray-600 whitespace-nowrap">{formatDate(order.order_date)}</TableCell>
      <TableCell className="font-medium text-sm text-gray-900 max-w-[150px] truncate">{order.customer_name || '-'}</TableCell>
      <TableCell className="text-xs max-w-[220px] truncate text-gray-600">
        {productSummary}
      </TableCell>
      <TableCell className="font-mono text-sm font-bold whitespace-nowrap text-gray-900">₪{(order.total || 0).toLocaleString()}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge className={`${statusColor} text-xs shadow-none`}>{statusLabel}</Badge>

          {shippingBadge && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-gray-50 text-gray-600 border border-gray-200">
              {shippingType === 'self_pickup' && <Store className="w-3 h-3" />}
              {shippingType === 'ups' && <Package className="w-3 h-3" />}
              {shippingType === 'cargo' && <Truck className="w-3 h-3" />}
              {shippingType === 'getpackage' && <Truck className="w-3 h-3" />}
              {shippingType === 'self_pickup' ? 'איסוף עצמי' : shippingType === 'cargo' ? 'שליח' : shippingType === 'ups' ? 'איסוף' : 'היום'}
            </span>
          )}
          {isUrgent && !order.tracking_number && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200">
              דחוף — היום
            </span>
          )}
          {order.tracking_number && (
            <span className="inline-flex items-center gap-0.5 bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-md border border-emerald-100 text-[10px] font-medium">
              {order.tracking_number.length > 12 ? order.tracking_number.slice(0, 12) + '...' : order.tracking_number}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <span className={`inline-flex items-center gap-1 text-xs font-bold ${visual.text}`}>
          <span className={`w-2 h-2 rounded-full ${visual.dot}`} />
          {nextAction}
        </span>
      </TableCell>
      <TableCell className="w-8 px-2">
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </TableCell>
      {canBulk && (
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={isSelected} onCheckedChange={() => onSelect(order.id)} />
        </TableCell>
      )}
    </TableRow>
    </>
  );
}