import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Truck, Copy, ExternalLink, Printer, Loader2, MessageCircle } from "lucide-react";
import { printShipmentLabel } from "@/functions/printShipmentLabel";
import { cargoApi } from "@/functions/cargoApi";
import { sendTrackingSms } from "@/functions/sendTrackingSms";
import { toast } from "sonner";

function getTrackingUrl(carrier, trackingNumber, existingUrl) {
  if (existingUrl) return existingUrl;
  if (!trackingNumber) return null;
  const c = (carrier || '').toLowerCase();
  if (c === 'cargo' || c === 'קארגו') return `https://www.cargo.co.il/he/tracking?trackingNumber=${trackingNumber}`;
  if (c === 'ups') return `https://www.ups.com/track?trackNums=${trackingNumber}&loc=he_IL`;
  if (c === 'velo') return `https://www.velodelivery.com/tracking/${trackingNumber}`;
  return null;
}

function getCarrierDisplay(carrier) {
  const c = (carrier || '').toLowerCase();
  if (c === 'cargo' || c === 'קארגו') return { name: 'קארגו', color: 'bg-blue-100 text-blue-700' };
  if (c === 'ups') return { name: 'UPS', color: 'bg-amber-100 text-amber-700' };
  if (c === 'getpackage') return { name: 'GetPackage', color: 'bg-red-100 text-red-700' };
  if (c === 'velo') return { name: 'Velo', color: 'bg-green-100 text-green-700' };
  return { name: carrier || 'משלוח', color: 'bg-gray-100 text-gray-700' };
}

function copyText(text) {
  navigator.clipboard.writeText(text);
  toast.success('הועתק ללוח');
}

export default function TrackingSection({ order }) {
  const [printingLabel, setPrintingLabel] = useState(false);
  const [sendingSms, setSendingSms] = useState(false);

  const trackingNumber = order.tracking_number;
  const trackingCarrier = order.tracking_carrier;
  const trackingUrl = getTrackingUrl(trackingCarrier, trackingNumber, order.tracking_url);
  const carrierInfo = getCarrierDisplay(trackingCarrier);

  if (!trackingNumber) return null;

  const handlePrintLabel = async () => {
    const c = (trackingCarrier || '').toLowerCase();
    setPrintingLabel(true);
    try {
      if (c === 'cargo' || c === 'קארגו') {
        const { data } = await cargoApi({ action: 'print_label', shipment_id: trackingNumber });
        if (data.label_url) {
          window.open(data.label_url, '_blank');
          toast.success('תווית קארגו נפתחה');
        } else if (data.label_base64) {
          const byteChars = atob(data.label_base64);
          const byteArray = new Uint8Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
          const blob = new Blob([byteArray], { type: 'application/pdf' });
          window.open(URL.createObjectURL(blob), '_blank');
          toast.success('תווית קארגו נפתחה');
        } else {
          toast.error(data.error || 'שגיאה בהדפסת תווית קארגו');
        }
      } else if (c === 'ups' || c === 'velo') {
        const { data } = await printShipmentLabel({ tracking_number: trackingNumber, label_format: 'a4' });
        if (data.success && data.pdf_base64) {
          const byteChars = atob(data.pdf_base64);
          const byteArray = new Uint8Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
          const blob = new Blob([byteArray], { type: 'application/pdf' });
          const blobUrl = URL.createObjectURL(blob);
          const htmlContent = `<!DOCTYPE html><html><head><title>שטר מטען - ${trackingNumber}</title><style>html,body{margin:0;padding:0;height:100%;overflow:hidden;}iframe{width:100%;height:100%;border:none;}</style></head><body><iframe src="${blobUrl}#toolbar=1&navpanes=0"></iframe></body></html>`;
          const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
          window.open(URL.createObjectURL(htmlBlob), '_blank');
          toast.success('שטר מטען נפתח');
        } else {
          toast.error(data.error || 'שגיאה בהורדת שטר מטען');
        }
      } else if (c === 'getpackage' && trackingUrl) {
        window.open(trackingUrl, '_blank');
      }
    } catch (e) {
      toast.error('שגיאה: ' + (e?.response?.data?.error || e.message));
    } finally {
      setPrintingLabel(false);
    }
  };

  const handleSendTrackingSms = async () => {
    if (!order.customer_phone) {
      toast.error('חסר מספר טלפון ללקוח');
      return;
    }
    setSendingSms(true);
    try {
      const { data } = await sendTrackingSms({
        order_id: order.raw_id || order.id,
        customer_phone: order.customer_phone,
        customer_name: order.customer_name,
        tracking_number: trackingNumber,
        tracking_carrier: trackingCarrier,
        tracking_url: trackingUrl || '',
        order_number: order.order_number || order.external_order_number,
      });
      if (data.success) {
        toast.success('הודעת SMS עם מספר מעקב נשלחה ללקוח');
      } else {
        toast.error(data.error || 'שגיאה בשליחת SMS');
      }
    } catch (e) {
      toast.error('שגיאה: ' + (e?.response?.data?.error || e.message));
    } finally {
      setSendingSms(false);
    }
  };

  return (
    <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Truck className="w-5 h-5 text-green-600" />
        <span className="font-bold text-green-800 text-sm">פרטי מעקב משלוח</span>
        <Badge className={`${carrierInfo.color} text-xs`}>{carrierInfo.name}</Badge>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="bg-white rounded-xl px-4 py-2 border border-green-200 flex items-center gap-2">
          <span className="text-xs text-gray-500">מספר מעקב:</span>
          <span className="font-mono font-bold text-gray-900 text-base">{trackingNumber}</span>
          <button onClick={() => copyText(trackingNumber)} className="text-gray-400 hover:text-gray-600">
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>

        {trackingUrl && (
          <a href={trackingUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-green-200 text-green-700 hover:bg-green-50 text-sm font-medium transition-colors">
            <ExternalLink className="w-3.5 h-3.5" />
            עקוב אחר המשלוח
          </a>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          className="rounded-full border-green-300 text-green-700 hover:bg-green-50 text-xs"
          disabled={printingLabel}
          onClick={handlePrintLabel}
        >
          {printingLabel ? <Loader2 className="w-3.5 h-3.5 animate-spin ml-1" /> : <Printer className="w-3.5 h-3.5 ml-1" />}
          הדפס שטר מטען
        </Button>

        {order.customer_phone && (
          <Button
            size="sm"
            className="rounded-full text-xs bg-green-600 hover:bg-green-700 text-white"
            disabled={sendingSms}
            onClick={handleSendTrackingSms}
          >
            {sendingSms ? <Loader2 className="w-3.5 h-3.5 animate-spin ml-1" /> : <MessageCircle className="w-3.5 h-3.5 ml-1" />}
            📱 שלח SMS מעקב ללקוח
          </Button>
        )}
      </div>
    </div>
  );
}