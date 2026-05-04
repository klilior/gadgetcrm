import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, AlertTriangle } from "lucide-react";
import { format, differenceInHours } from "date-fns";
import SourceBadge from "./SourceBadge";
import { getStatusLabel, getStatusColor, isClosedStatus } from "./OrderStatusConfig";
import { detectShippingType, getShippingTypeBadge, isUrgentSameDay } from "./ShippingTypeHelper";
import OrderDetailPanel from "./OrderDetailPanel";

export default function MobileOrderCard({ order, isExpanded, onToggle, onSms, onStatusChange, onShipment, onCreateInvoice, onCargoShipment, onGetPackageShipment, activeProviders }) {
  const statusColor = getStatusColor(order.source, order.status);
  const statusLabel = getStatusLabel(order.source, order.status);
  const isClosed = isClosedStatus(order.source, order.status);
  const hoursSince = order.order_date ? differenceInHours(new Date(), new Date(order.order_date)) : 0;
  const isOld = hoursSince > 24 && !isClosed;
  const isUrgent = isUrgentSameDay(order);
  const shippingBadge = getShippingTypeBadge(detectShippingType(order));

  const formatDate = (d) => {
    if (!d) return '';
    try { return format(new Date(d), "dd/MM HH:mm"); } catch { return ''; }
  };

  const productSummary = (order.products || []).slice(0, 2).map(p => p.name).join(', ');

  const sourceBorder = {
    woocommerce: 'border-r-purple-500',
    mirakl: 'border-r-blue-500',
    linet: 'border-r-amber-500',
  };

  return (
    <Card className={`border-0 shadow-lg rounded-2xl overflow-hidden border-r-4 ${sourceBorder[order.source] || 'border-r-gray-300'} ${isUrgent ? 'ring-2 ring-red-400 animate-pulse' : ''} ${!isUrgent && isOld ? 'ring-2 ring-red-200' : ''} ${isClosed ? 'opacity-40' : ''} transition-all duration-200 hover:shadow-xl`}>
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
            {isUrgent && <span className="bg-red-500 text-white px-1.5 py-0.5 rounded text-[10px] font-bold">🔥 דחוף</span>}
            {shippingBadge && <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${shippingBadge.className}`}>{shippingBadge.label}</span>}
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
          onCreateInvoice={onCreateInvoice}
          onCargoShipment={onCargoShipment ? () => onCargoShipment() : undefined}
          onGetPackageShipment={onGetPackageShipment ? () => onGetPackageShipment() : undefined}
          activeProviders={activeProviders}
        />
      )}
    </Card>
  );
}