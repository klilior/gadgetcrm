import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, AlertTriangle } from "lucide-react";
import { format, differenceInHours } from "date-fns";
import SourceBadge from "./SourceBadge";
import { getStatusLabel, getStatusColor, isClosedStatus } from "./OrderStatusConfig";
import OrderDetailPanel from "./OrderDetailPanel";

export default function MobileOrderCard({ order, isExpanded, onToggle, onSms, onStatusChange, onShipment }) {
  const statusColor = getStatusColor(order.source, order.status);
  const statusLabel = getStatusLabel(order.source, order.status);
  const isClosed = isClosedStatus(order.source, order.status);
  const hoursSince = order.order_date ? differenceInHours(new Date(), new Date(order.order_date)) : 0;
  const isOld = hoursSince > 24 && !isClosed;

  const formatDate = (d) => {
    if (!d) return '';
    try { return format(new Date(d), "dd/MM HH:mm"); } catch { return ''; }
  };

  const productSummary = (order.products || []).slice(0, 2).map(p => p.name).join(', ');

  return (
    <Card className={`border-0 shadow-sm overflow-hidden ${isOld ? 'border-r-4 border-r-red-400' : ''} ${isClosed ? 'opacity-50' : ''}`}>
      {/* Clickable header */}
      <div
        onClick={onToggle}
        className={`p-3 cursor-pointer select-none ${isExpanded ? 'bg-indigo-50/50' : 'hover:bg-gray-50'}`}
      >
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <SourceBadge source={order.source} />
            <span className="font-mono text-sm font-bold">#{order.order_number}</span>
            {isOld && <AlertTriangle className="w-3 h-3 text-red-500" />}
          </div>
          <div className="flex items-center gap-2">
            <Badge className={`${statusColor} text-[10px]`}>{statusLabel}</Badge>
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </div>
        </div>
        <div className="flex justify-between items-center mt-1.5">
          <div className="text-sm text-gray-700 truncate flex-1">
            <strong>{order.customer_name || '-'}</strong>
            {productSummary && <span className="text-xs text-gray-500 mr-2">• {productSummary}</span>}
          </div>
          <span className="font-mono font-bold text-sm mr-2">₪{(order.total || 0).toLocaleString()}</span>
        </div>
        <div className="text-[10px] text-gray-400 mt-0.5">{formatDate(order.order_date)}</div>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <OrderDetailPanel
          order={order}
          onSms={() => onSms()}
          onStatusChange={onStatusChange}
          onShipment={() => onShipment()}
        />
      )}
    </Card>
  );
}