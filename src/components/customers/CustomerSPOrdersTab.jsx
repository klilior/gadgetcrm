import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Package, MapPin, FileText, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

const SP_STATUS_MAP = {
  WAITING_ACCEPTANCE: { label: 'ממתין לאישור', color: 'bg-yellow-100 text-yellow-800' },
  WAITING_DEBIT: { label: 'ממתין לחיוב', color: 'bg-orange-100 text-orange-800' },
  WAITING_DEBIT_PAYMENT: { label: 'ממתין לתשלום', color: 'bg-orange-100 text-orange-800' },
  SHIPPING: { label: 'בהכנה למשלוח', color: 'bg-blue-100 text-blue-800' },
  SHIPPED: { label: 'נשלח', color: 'bg-indigo-100 text-indigo-800' },
  TO_COLLECT: { label: 'לאיסוף', color: 'bg-purple-100 text-purple-800' },
  RECEIVED: { label: 'התקבל', color: 'bg-green-100 text-green-800' },
  CLOSED: { label: 'נסגר', color: 'bg-gray-100 text-gray-700' },
  REFUSED: { label: 'סורב', color: 'bg-red-100 text-red-800' },
  CANCELED: { label: 'בוטל', color: 'bg-red-100 text-red-800' },
};

function formatDate(d) {
  if (!d) return '';
  try { return format(new Date(d), 'dd/MM/yyyy HH:mm', { locale: he }); } catch { return ''; }
}

export default function CustomerSPOrdersTab({ spOrders }) {
  if (!spOrders || spOrders.length === 0) {
    return (
      <div className="text-center py-10 text-gray-500">
        <Package className="w-16 h-16 mx-auto mb-4 text-gray-400" />
        <p>אין הזמנות סופר-פארם ללקוח זה</p>
      </div>
    );
  }

  const totalAmount = spOrders.reduce((s, o) => s + (o.total_price || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <Badge variant="outline" className="bg-emerald-50 border-emerald-200 text-emerald-700 px-3 py-1">
          {spOrders.length} הזמנות
        </Badge>
        <Badge variant="outline" className="bg-green-50 border-green-200 text-green-700 px-3 py-1">
          סה"כ ₪{Math.round(totalAmount).toLocaleString()}
        </Badge>
      </div>

      {spOrders.map(order => {
        const st = SP_STATUS_MAP[order.order_state] || { label: order.order_state, color: 'bg-gray-100 text-gray-700' };
        let lines = [];
        try { lines = JSON.parse(order.order_lines_json || '[]'); } catch {}

        return (
          <Card key={order.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">#{order.mirakl_order_id}</span>
                    <Badge className={`text-[10px] ${st.color}`}>{st.label}</Badge>
                  </div>
                  
                  {/* Products */}
                  {lines.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {lines.map((line, i) => (
                        <div key={i} className="flex justify-between text-xs">
                          <span className="text-gray-700 truncate flex-1">{line.product_title || line.offer_sku}</span>
                          <div className="flex gap-2 mr-2 flex-shrink-0">
                            <span className="text-gray-500">×{line.quantity || 1}</span>
                            <span className="font-medium">₪{line.total_price || line.price || 0}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span>{formatDate(order.created_at_mirakl)}</span>
                    {order.shipping_city && (
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{order.shipping_city}</span>
                    )}
                    {order.tracking_number && (
                      <span>מעקב: <span className="font-mono">{order.tracking_number}</span></span>
                    )}
                    {order.linet_invoice_doc_number && (
                      <span className="flex items-center gap-1">
                        <FileText className="w-3 h-3" />חשבונית #{order.linet_invoice_doc_number}
                        {order.linet_invoice_pdf_url && (
                          <a href={order.linet_invoice_pdf_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="w-3 h-3 text-blue-600" />
                          </a>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-left flex-shrink-0">
                  <p className="text-xl font-bold text-green-600">₪{order.total_price || 0}</p>
                  {order.total_commission > 0 && (
                    <p className="text-[10px] text-gray-400">עמלה: ₪{order.total_commission}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}