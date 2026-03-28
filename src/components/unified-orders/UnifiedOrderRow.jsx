import React from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, AlertTriangle } from "lucide-react";
import { format, differenceInHours } from "date-fns";
import SourceBadge from "./SourceBadge";
import { getStatusLabel, getStatusColor, isClosedStatus } from "./OrderStatusConfig";

export default function UnifiedOrderRow({ order, isExpanded, onToggle, onSelect, isSelected, canBulk }) {
  const isClosed = isClosedStatus(order.source, order.status);
  const hoursSinceOrder = order.order_date ? differenceInHours(new Date(), new Date(order.order_date)) : 0;
  const isOld = hoursSinceOrder > 24 && !isClosed;

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
      className={`cursor-pointer transition-all select-none
        ${isOld ? 'border-r-4 border-r-red-400 bg-red-50/30' : ''}
        ${isClosed ? 'opacity-50' : ''}
        ${isExpanded ? 'bg-indigo-50/50 border-b-0' : 'hover:bg-gray-50/80'}
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
        <Badge className={`${statusColor} text-xs`}>{statusLabel}</Badge>
      </TableCell>
    </TableRow>
  );
}