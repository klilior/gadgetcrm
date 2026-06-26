import React from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, AlertTriangle, Package, Truck, Store } from "lucide-react";
import { format, differenceInHours } from "date-fns";
import SourceBadge from "./SourceBadge";
import { getStatusLabel, getStatusColor, isClosedStatus } from "./OrderStatusConfig";
import { detectShippingType, getShippingTypeBadge, isUrgentSameDay } from "./ShippingTypeHelper";
import { getNextActionLabel, getOrderVisualState, isSerialWaiting } from "./orderUiHelpers";

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
  const productSummary = productsList.length > 0
    ? productsList.slice(0, 2).map(p => p.name).join(', ') + (productsList.length > 2 ? ` +${productsList.length - 2}` : '')
    : '-';

  const statusColor = getStatusColor(order.source, order.status);
  const statusLabel = getStatusLabel(order.source, order.status);

  const formatDate = (d) => {
    if (!d) return '-';
    try { return format(new Date(d), "dd/MM HH:mm"); } catch { return '-'; }
  };

  return (
    <TableRow
      onClick={onToggle}
      className={`cursor-pointer select-none border-r-4 ${visual.border} ${visual.bg} hover:bg-slate-50 transition-colors
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
      <TableCell className="text-xs text-gray-600 max-w-[220px] truncate">{productSummary}</TableCell>
      <TableCell className="font-mono text-sm font-bold whitespace-nowrap text-gray-900">₪{(order.total || 0).toLocaleString()}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge className={`${statusColor} text-xs shadow-none`}>{statusLabel}</Badge>
          {isSerialWaiting(order) && <Badge className="bg-purple-50 text-[#7D0F82] border border-purple-100 text-xs shadow-none">חסר סריאלי</Badge>}
          {shippingBadge && (
            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium ${shippingBadge.className}`}>
              {shippingType === 'self_pickup' && <Store className="w-3 h-3" />}
              {shippingType === 'ups' && <Package className="w-3 h-3" />}
              {shippingType === 'cargo' && <Truck className="w-3 h-3" />}
              {shippingType === 'getpackage' && <span>⚡</span>}
              {shippingType === 'self_pickup' ? 'איסוף עצמי' : shippingType === 'cargo' ? 'שליח' : shippingType === 'ups' ? 'איסוף' : 'היום'}
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
  );
}