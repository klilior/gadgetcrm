import React, { useState } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { MessageCircle, Phone, Truck, ExternalLink, StickyNote, CheckCircle, AlertTriangle } from "lucide-react";
import { format, differenceInHours } from "date-fns";
import SourceBadge from "./SourceBadge";
import { getStatusLabel, getStatusOptions, getStatusColor, isClosedStatus } from "./OrderStatusConfig";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export default function UnifiedOrderRow({ order, onSms, onStatusChange, onShipment, onSelect, isSelected, canBulk }) {
  const isClosed = isClosedStatus(order.source, order.status);
  const hoursSinceOrder = order.order_date ? differenceInHours(new Date(), new Date(order.order_date)) : 0;
  const isOld = hoursSinceOrder > 24 && !isClosed;
  const isMiraklNew = order.source === 'mirakl' && order.status === 'WAITING_ACCEPTANCE';

  const productsList = order.products || [];
  const visibleProducts = productsList.slice(0, 2);
  const extraCount = productsList.length - 2;

  const statusColor = getStatusColor(order.source, order.status);
  const statusLabel = getStatusLabel(order.source, order.status);
  const statusOptions = getStatusOptions(order.source);

  const formatDate = (d) => {
    if (!d) return '-';
    try { return format(new Date(d), "dd/MM/yyyy HH:mm"); } catch { return '-'; }
  };

  return (
    <TableRow className={`${isOld ? 'border-r-4 border-r-red-400 bg-red-50/30' : ''} ${isClosed ? 'opacity-60' : ''} hover:bg-gray-50/80`}>
      {canBulk && (
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={isSelected} onCheckedChange={() => onSelect(order.id)} />
        </TableCell>
      )}
      <TableCell><SourceBadge source={order.source} /></TableCell>
      <TableCell className="font-mono text-sm font-bold">
        #{order.order_number}
        {isOld && <AlertTriangle className="w-3 h-3 text-red-500 inline mr-1" />}
      </TableCell>
      <TableCell className="text-xs text-gray-600">{formatDate(order.order_date)}</TableCell>
      <TableCell className="font-medium text-sm">{order.customer_name || '-'}</TableCell>
      <TableCell>
        {order.customer_phone ? (
          <div className="flex items-center gap-1">
            <a href={`tel:${order.customer_phone}`} className="text-blue-600 hover:underline text-sm">
              {order.customer_phone}
            </a>
            <button onClick={() => onSms(order)} className="text-gray-400 hover:text-blue-600 p-0.5">
              <MessageCircle className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : <span className="text-gray-400 text-sm">-</span>}
      </TableCell>
      <TableCell className="max-w-[200px]">
        <div className="text-xs space-y-0.5">
          {visibleProducts.map((p, i) => (
            <div key={i} className="truncate">{p.name} × {p.quantity}</div>
          ))}
          {extraCount > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-blue-600 cursor-pointer text-[11px]">עוד {extraCount} פריטים</span>
                </TooltipTrigger>
                <TooltipContent dir="rtl" className="max-w-xs">
                  {productsList.slice(2).map((p, i) => (
                    <div key={i} className="text-xs">{p.name} × {p.quantity}</div>
                  ))}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {productsList.length === 0 && <span className="text-gray-400">-</span>}
        </div>
      </TableCell>
      <TableCell className="font-mono text-sm font-bold">₪{(order.total || 0).toLocaleString()}</TableCell>
      <TableCell className="text-xs text-gray-600">{order.shipping_method || '-'}</TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        {isMiraklNew ? (
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700 text-white text-xs h-7 animate-pulse"
            onClick={() => onStatusChange(order, 'accept_mirakl')}
          >
            <CheckCircle className="w-3 h-3 ml-1" />
            אשר הזמנה
          </Button>
        ) : (
          <Select value={order.status} onValueChange={(val) => onStatusChange(order, val)}>
            <SelectTrigger className="h-7 text-xs w-[130px] border-0 p-0">
              <Badge className={`${statusColor} text-xs`}>{statusLabel}</Badge>
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </TableCell>
      <TableCell className="max-w-[120px]">
        {order.notes ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                  <StickyNote className="w-3 h-3" />
                  <span className="truncate max-w-[80px]">{order.notes}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent dir="rtl" className="max-w-xs whitespace-pre-wrap">{order.notes}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : <span className="text-gray-300 text-xs">-</span>}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onSms(order)} title="SMS">
            <MessageCircle className="w-3.5 h-3.5 text-blue-600" />
          </Button>
          {!isClosed && (
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onShipment(order)} title="משלוח">
              <Truck className="w-3.5 h-3.5 text-purple-600" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}