import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageCircle, Truck } from "lucide-react";
import SourceBadge from "./SourceBadge";
import { getStatusLabel, getStatusColor } from "./OrderStatusConfig";

export default function MobileOrderCard({ order, onSms, onStatusChange, onShipment }) {
  const statusColor = getStatusColor(order.source, order.status);
  const statusLabel = getStatusLabel(order.source, order.status);
  const isMiraklNew = order.source === 'mirakl' && order.status === 'WAITING_ACCEPTANCE';

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-2">
            <SourceBadge source={order.source} />
            <span className="font-mono text-sm font-bold">#{order.order_number}</span>
          </div>
          <Badge className={`${statusColor} text-xs`}>{statusLabel}</Badge>
        </div>
        <div className="text-sm space-y-1 text-gray-700">
          <p><strong>{order.customer_name}</strong></p>
          {order.customer_phone && (
            <a href={`tel:${order.customer_phone}`} className="text-blue-600">{order.customer_phone}</a>
          )}
          <p className="text-xs text-gray-500">
            {order.products?.slice(0, 2).map(p => `${p.name} ×${p.quantity}`).join(', ')}
            {(order.products?.length || 0) > 2 && ` + ${order.products.length - 2} עוד`}
          </p>
          <div className="flex justify-between items-center pt-2">
            <span className="font-bold">₪{(order.total || 0).toLocaleString()}</span>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onSms}>
                <MessageCircle className="w-4 h-4 text-blue-600" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onShipment}>
                <Truck className="w-4 h-4 text-purple-600" />
              </Button>
              {isMiraklNew && (
                <Button size="sm" className="bg-green-600 text-white text-xs h-7" onClick={() => onStatusChange(order, 'accept_mirakl')}>
                  אשר
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}