import React from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, AlertTriangle, Package, Truck } from "lucide-react";
import { format, differenceInHours } from "date-fns";
import SourceBadge from "./SourceBadge";
import { getStatusLabel, getStatusColor, isClosedStatus } from "./OrderStatusConfig";
import { detectShippingType, getShippingTypeBadge, isUrgentSameDay } from "./ShippingTypeHelper";

export default function UnifiedOrderRow({ order, isExpanded, onToggle, onSelect, isSelected, canBulk }) {
  const isClosed = isClosedStatus(order.source, order.status);
  const hoursSinceOrder = order.order_date ? differenceInHours(new Date(), new Date(order.order_date)) : 0;
  const isOld = hoursSinceOrder > 24 && !isClosed;
  const shippingType = detectShippingType(order);
  const shippingBadge = getShippingTypeBadge(shippingType);
  const isUrgent = isUrgentSameDay(order);

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

  const sourceGlow = {
    woocommerce: 'hover:bg-purple-50/60',
    mirakl: 'hover:bg-blue-50/60',
    linet: 'hover:bg-amber-50/60',
  };

  return (
    <TableRow
      onClick={onToggle}
      className={`cursor-pointer transition-all duration-200 select-none
        ${isUrgent ? 'animate-pulse border-r-4 border-r-red-500 bg-red-50/40' : ''}
        ${!isUrgent && isOld ? 'border-r-4 border-r-red-400 bg-red-50/30' : ''}
        ${isClosed ? 'opacity-40' : ''}
        ${isExpanded ? 'bg-gradient-to-l from-purple-50/60 to-transparent border-b-0 shadow-sm' : (sourceGlow[order.source] || 'hover:bg-gray-50/80')}
      `}
    >
      {canBulk && (
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={isSelected} onCheckedChange={() => onSelect(order.id)} />
        </TableCell>
      )}
      <TableCell className="w-8 px-2">
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </TableCell>
      <TableCell><SourceBadge source={order.source} /></TableCell>
      <TableCell className="font-mono text-sm font-bold whitespace-nowrap">
        #{order.order_number}
        {isOld && <AlertTriangle className="w-3 h-3 text-red-500 inline mr-1" />}
      </TableCell>
      <TableCell className="text-xs text-gray-600 whitespace-nowrap">{formatDate(order.order_date)}</TableCell>
      <TableCell className="font-medium text-sm">{order.customer_name || '-'}</TableCell>
      <TableCell className="text-xs text-gray-600 max-w-[180px] truncate">{productSummary}</TableCell>
      <TableCell className="font-mono text-sm font-bold whitespace-nowrap">₪{(order.total || 0).toLocaleString()}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge className={`${statusColor} text-xs`}>{statusLabel}</Badge>
          {shippingBadge && (
            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${shippingBadge.className}`}>
              {shippingType === 'ups' && <Package className="w-3 h-3" />}
              {shippingType === 'cargo' && <Truck className="w-3 h-3" />}
              {shippingType === 'getpackage' && <span>⚡</span>}
              {shippingType === 'cargo' ? 'שליח' : shippingType === 'ups' ? 'איסוף' : 'היום'}
            </span>
          )}
          {isUrgent && (
            <span className="inline-flex items-center gap-0.5 bg-red-500 text-white px-1.5 py-0.5 rounded text-[10px] font-bold animate-pulse">
              🔥 דחוף
            </span>
          )}
          {order.tracking_number && (
            <span className="inline-flex items-center gap-0.5 bg-green-100 text-green-700 px-1.5 py-0.5 rounded text-[10px] font-medium">
              📦 {order.tracking_number.length > 12 ? order.tracking_number.slice(0, 12) + '...' : order.tracking_number}
            </span>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}