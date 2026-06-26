import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, AlertTriangle } from "lucide-react";
import { format, differenceInHours } from "date-fns";
import SourceBadge from "./SourceBadge";
import { getStatusLabel, getStatusColor, isClosedStatus } from "./OrderStatusConfig";
import { detectShippingType, getShippingTypeBadge, isUrgentSameDay } from "./ShippingTypeHelper";
import { getNextActionLabel, getOrderVisualState } from "./orderUiHelpers";
import OrderDetailPanel from "./OrderDetailPanel";

export default function MobileOrderCard({ order, isExpanded, onToggle, onSms, onStatusChange, onShipment, onCreateInvoice, onCargoShipment, onGetPackageShipment, activeProviders }) {
  const statusColor = getStatusColor(order.source, order.status);
  const statusLabel = getStatusLabel(order.source, order.status);
  const isClosed = isClosedStatus(order.source, order.status);
  const hoursSince = order.order_date ? differenceInHours(new Date(), new Date(order.order_date)) : 0;
  const isOld = hoursSince > 24 && !isClosed;
  const isUrgent = isUrgentSameDay(order);
  const shippingBadge = getShippingTypeBadge(detectShippingType(order));
  const visual = getOrderVisualState(order);
  const nextAction = getNextActionLabel(order);

  const formatDate = (d) => {
    if (!d) return '';
    try { return format(new Date(d), "dd/MM HH:mm"); } catch { return ''; }
  };

  const productSummary = (order.products || []).slice(0, 2).map(p => p.name).join(', ');

  return (
    <Card className={`border border-gray-100 shadow-sm rounded-2xl overflow-hidden border-r-4 ${visual.border} ${visual.bg} ${isUrgent ? 'ring-2 ring-red-200' : ''} ${!isUrgent && isOld ? 'ring-2 ring-red-100' : ''} ${isClosed ? 'opacity-60' : ''} transition-all duration-200`}>
      {/* Clickable header */}
      <div
        onClick={onToggle}
        className={`p-3.5 cursor-pointer select-none transition-colors ${isExpanded ? 'bg-gradient-to-l from-purple-50/50 to-transparent' : 'hover:bg-gray-50/60'}`}
      >
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <SourceBadge source={order.source} />
            <span className="font-mono text-sm font-bold">#{order.order_number}</span>
            {isOld && <AlertTriangle className="w-3 h-3 text-red-500" />}
          </div>
          <div className="flex items-center gap-2">
            {isUrgent && <span className="bg-red-50 text-red-700 border border-red-100 px-1.5 py-0.5 rounded text-[10px] font-bold">דחוף</span>}
            {shippingBadge && <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${shippingBadge.className}`}>{shippingBadge.label}</span>}
            <Badge className={`${statusColor} text-[10px] shadow-none`}>{statusLabel}</Badge>
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
        <div className="flex items-center justify-between mt-1">
          <div className="text-[10px] text-gray-400">{formatDate(order.order_date)}</div>
          <div className={`text-[10px] font-bold ${visual.text}`}>פעולה הבאה: {nextAction}</div>
        </div>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <OrderDetailPanel
          order={order}
          onSms={() => onSms()}
          onStatusChange={onStatusChange}
          onShipment={(nextOrder) => onShipment(nextOrder || order)}
          onCreateInvoice={onCreateInvoice}
          onCargoShipment={onCargoShipment ? (nextOrder) => onCargoShipment(nextOrder || order) : undefined}
          onGetPackageShipment={onGetPackageShipment ? (nextOrder) => onGetPackageShipment(nextOrder || order) : undefined}
          activeProviders={activeProviders}
        />
      )}
    </Card>
  );
}