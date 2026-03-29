import React from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, AlertTriangle, Package, Truck } from "lucide-react";

function detectMiraklPickup(order) {
  if (order.source !== 'mirakl') return null;
  try {
    const raw = JSON.parse(order.raw_mirakl_json || '{}');
    if (raw.shipping_type_code === 'pickup-locations') return true;
    const label = (raw.shipping_type_label || '').toLowerCase();
    if (label.includes('איסוף') || label.includes('pickup')) return true;
    return false;
  } catch { return false; }
}
import { format, differenceInHours } from "date-fns";
import SourceBadge from "./SourceBadge";
import { getStatusLabel, getStatusColor, isClosedStatus } from "./OrderStatusConfig";

export default function UnifiedOrderRow({ order, isExpanded, onToggle, onSelect, isSelected, canBulk }) {
  const isClosed = isClosedStatus(order.source, order.status);
  const miraklPickup = detectMiraklPickup(order);
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

  const sourceGlow = {
    woocommerce: 'hover:bg-purple-50/60',
    mirakl: 'hover:bg-blue-50/60',
    linet: 'hover:bg-amber-50/60',
  };

  return (
    <TableRow
      onClick={onToggle}
      className={`cursor-pointer transition-all duration-200 select-none
        ${isOld ? 'border-r-4 border-r-red-400 bg-red-50/30' : ''}
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
        <div className="flex items-center gap-1.5">
          <Badge className={`${statusColor} text-xs`}>{statusLabel}</Badge>
          {miraklPickup === true && (
            <span className="inline-flex items-center gap-0.5 text-amber-800 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded text-[10px] font-medium" title="UPS נקודת איסוף">
              <Package className="w-3 h-3" /> UPS
            </span>
          )}
          {miraklPickup === false && (
            <span className="inline-flex items-center gap-0.5 text-blue-800 bg-blue-100 border border-blue-200 px-1.5 py-0.5 rounded text-[10px] font-medium" title="Velo שליח עד הבית">
              <Truck className="w-3 h-3" /> Velo
            </span>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}