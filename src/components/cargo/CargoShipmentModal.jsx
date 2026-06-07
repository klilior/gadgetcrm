import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Truck, Package, RefreshCw, Loader2, AlertTriangle, CheckCircle, Printer, Copy } from "lucide-react";
import { cargoApi } from "@/functions/cargoApi";
import { updateSuperPharmOrder } from "@/functions/updateSuperPharmOrder";
import { updateWooOrderStatus } from "@/functions/updateWooOrderStatus";
import { sendTrackingSms } from "@/functions/sendTrackingSms";
import { toast } from "sonner";

const SHIPMENT_TYPES = [
  { value: 'delivery', label: '🚚 משלוח רגיל', desc: 'שליחה ללקוח', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  { value: 'return', label: '📦 החזרה מלקוח', desc: 'איסוף מהלקוח', color: 'bg-orange-100 text-orange-800 border-orange-300' },
  { value: 'exchange', label: '🔄 החלפה', desc: 'שליחה + איסוף חזרה', color: 'bg-purple-100 text-purple-800 border-purple-300' },
];

const CARGO_STATUS_MAP = {
  1: 'פתוח', 2: 'הועבר לשליח', 3: 'נמסר', 4: 'נאסף על ידי קארגו',
  5: 'חזרה ממשלוח כפול', 7: 'אושר לביצוע', 8: 'בוטל', 9: 'משלוח שני',
  12: 'ממתין למשלוח', 25: 'במחסן', 50: 'בדרך למסירה',
  51: 'בדרך לנקודת חלוקה', 52: 'נקודת חלוקה', 55: 'בנקודת חלוקה',
};

export default function CargoShipmentModal({ open, onClose, order, client }) {
  const [shipmentType, setShipmentType] = useState('delivery');
  const [toName, setToName] = useState('');
  const [toPhone, setToPhone] = useState('');
  const [toStreet, setToStreet] = useState('');
  const [toCity, setToCity] = useState('');
  const [toFloor, setToFloor] = useState('');
  const [toApartment, setToApartment] = useState('');
  const [toEntrance, setToEntrance] = useState('');
  const [notes, setNotes] = useState('');
  const [numParcels, setNumParcels] = useState(1);
  const [showCOD, setShowCOD] = useState(false);
  const [codAmount, setCodAmount] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  
  // Result state
  const [result, setResult] = useState(null);
  const [statusResult, setStatusResult] = useState(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [printingLabel, setPrintingLabel] = useState(false);
  
  // Duplicate warning
  const [existingShipmentId, setExistingShipmentId] = useState(null);
  const [confirmedDuplicate, setConfirmedDuplicate] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Auto-fill from order/client
    const name = client?.full_name || order?.customer_name || '';
    const phone = client?.phone || order?.customer_phone || '';
    setToName(name);
    setToPhone(phone);
    
    // Try to extract address - prefer order address, then client
    if (order?.shipping_address_full) {
      setToStreet(order.shipping_address_full);
    } else if (order?.shipping_street) {
      setToStreet(order.shipping_street);
    } else if (client?.full_address) {
      setToStreet(client.full_address);
    }
    setToCity(order?.shipping_city || client?.city || '');
    setNotes(order?.notes || order?.customer_note || '');
    setResult(null);
    setError(null);
    setExistingShipmentId(null);
    setConfirmedDuplicate(false);
  }, [open, order, client]);

  // Check for existing cargo shipment on this order
  useEffect(() => {
    if (!open || !order) return;
    const orderNum = order.order_number || order.external_order_number || '';
    if (!orderNum) return;
    // We'll check via the API if needed - for now just check if order already has cargo data
    if (order.cargo_shipment_id) {
      setExistingShipmentId(order.cargo_shipment_id);
    }
  }, [open, order]);

  const handleSubmit = async () => {
    if (!toName || !toPhone || !toCity) {
      setError('נא למלא שם, טלפון ועיר');
      return;
    }
    if (existingShipmentId && !confirmedDuplicate) {
      setError(`להזמנה זו כבר קיים משלוח קארגו #${existingShipmentId}. לחץ שוב לאישור יצירת משלוח נוסף.`);
      setConfirmedDuplicate(true);
      return;
    }
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      const res = await cargoApi({
        action: 'create_shipment',
        shipment_type: shipmentType,
        to_name: toName,
        to_phone: toPhone,
        to_street: toStreet,
        to_city: toCity,
        to_floor: toFloor,
        to_apartment: toApartment,
        to_entrance: toEntrance,
        notes,
        number_of_parcels: numParcels,
        cash_on_delivery: showCOD ? codAmount : 0,
        order_id: order?.raw_id || order?.id || '',
        order_number: order?.order_number || order?.external_order_number || '',
      });
      
      const data = res.data || res;
      if (data.success) {
        setResult(data);
        toast.success(`משלוח קארגו נוצר בהצלחה! #${data.shipment_id}`);
        
        // Auto-update order status in external platform
        if (data.shipment_id) {
          if (order?.source === 'mirakl') {
            try {
              const miraklId = order.mirakl_order_id || order.order_number;
              await updateSuperPharmOrder({
                action: 'ship',
                order_id: miraklId,
                tracking_number: String(data.shipment_id),
                carrier_code: 'deliv_cargoexp',
                carrier_name: 'Cargo-Ship',
              });
              toast.success('הזמנה עודכנה ל-"נשלחה" ב-Mirakl');
            } catch (e) {
              console.error('[Cargo] Failed to update Mirakl:', e.message);
              toast.error('משלוח נוצר אך עדכון Mirakl נכשל - יעודכן בסנכרון הבא');
            }
          } else if (order?.source === 'woocommerce') {
            try {
              await updateWooOrderStatus({ order_id: order.raw_id, new_status: 'completed' });
              toast.success('הזמנה עודכנה ל-"הושלמה" בווקומרס');
            } catch (e) {
              console.error('[Cargo] Failed to update WooCommerce:', e.message);
            }
          }

          try {
            await sendTrackingSms({
              order_id: order?.raw_id || order?.id || order?.mirakl_order_id || order?.order_number || '',
              customer_phone: toPhone,
              customer_name: toName,
              tracking_number: String(data.shipment_id),
              tracking_carrier: 'cargo',
              order_number: order?.order_number || order?.external_order_number || order?.mirakl_order_id || '',
            });
            toast.success('SMS מעקב נשלח לפי משלוח קארגו');
          } catch (smsErr) {
            console.error('[Cargo] Failed to send tracking SMS:', smsErr.message);
            toast.error('משלוח נוצר, אבל שליחת SMS נכשלה');
          }
        }
      } else {
        setError(data.error || 'שגיאה ביצירת משלוח');
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'שגיאת רשת');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCheckStatus = async () => {
    if (!result?.shipment_id) return;
    setCheckingStatus(true);
    try {
      const res = await cargoApi({ action: 'get_status', shipment_id: result.shipment_id });
      const data = res.data || res;
      setStatusResult(data);
    } catch (e) {
      toast.error('שגיאה בבדיקת סטטוס: ' + e.message);
    } finally {
      setCheckingStatus(false);
    }
  };

  const handlePrintLabel = async () => {
    if (!result?.shipment_id) return;
    // Open window immediately on user click to avoid popup blocker
    const printWindow = window.open('about:blank', '_blank');
    setPrintingLabel(true);
    try {
      const res = await cargoApi({ action: 'print_label', shipment_id: result.shipment_id });
      const data = res.data || res;
      console.log('📦 Label response:', JSON.stringify(data).slice(0, 500));
      
      if (data.success === false) {
        if (printWindow) printWindow.close();
        toast.error(data.error || 'שגיאה בהדפסת תווית');
        return;
      }
      
      if (data.label_url) {
        if (printWindow) {
          printWindow.location.href = data.label_url;
        } else {
          window.location.href = data.label_url;
        }
        toast.success('התווית נפתחה');
      } else if (data.label_base64) {
        const byteChars = atob(data.label_base64);
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        if (printWindow) {
          printWindow.location.href = url;
        } else {
          const a = document.createElement('a');
          a.href = url;
          a.download = `cargo-label-${result.shipment_id}.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        toast.success('התווית נפתחה');
      } else {
        if (printWindow) printWindow.close();
        toast.error('לא התקבלה תווית מקארגו. נסה שוב בעוד רגע.');
        console.error('📦 No label data in response:', data);
      }
    } catch (e) {
      if (printWindow) printWindow.close();
      toast.error('שגיאה בהדפסת תווית: ' + (e.response?.data?.error || e.message));
      console.error('📦 Label error:', e);
    } finally {
      setPrintingLabel(false);
    }
  };

  // Success view
  if (result) {
    const closeWithResult = () => onClose(result);
    return (
      <Dialog open={open} onOpenChange={closeWithResult}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              <CheckCircle className="w-6 h-6" />
              משלוח נוצר בהצלחה!
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
              <p className="text-sm text-green-700 mb-1">מספר מעקב קארגו</p>
              <div className="flex items-center justify-center gap-2">
                <span className="text-2xl font-bold font-mono text-green-900">{result.shipment_id}</span>
                <button onClick={() => { navigator.clipboard.writeText(String(result.shipment_id)); toast.success('הועתק!'); }}>
                  <Copy className="w-4 h-4 text-green-600" />
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handlePrintLabel} disabled={printingLabel} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl">
                {printingLabel ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Printer className="w-4 h-4 ml-1" />}
                הדפס תווית
              </Button>
              <Button onClick={handleCheckStatus} disabled={checkingStatus} variant="outline" className="flex-1 rounded-xl">
                {checkingStatus ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <RefreshCw className="w-4 h-4 ml-1" />}
                בדוק סטטוס
              </Button>
            </div>

            {statusResult && (
              <div className="bg-gray-50 border rounded-xl p-3 text-sm">
                <p className="font-medium">סטטוס: <span className="text-blue-700">{statusResult.status_text || 'לא ידוע'}</span></p>
                {statusResult.status_code && <p className="text-gray-500 text-xs">קוד: {statusResult.status_code}</p>}
              </div>
            )}

            <Button variant="outline" onClick={closeWithResult} className="w-full rounded-xl">סגור</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-blue-600" />
            שלח עם קארגו
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Duplicate warning */}
          {existingShipmentId && (
            <div className="bg-yellow-50 border border-yellow-300 rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-yellow-800">להזמנה זו כבר קיים משלוח קארגו #{existingShipmentId}</p>
                <p className="text-yellow-700">אם תמשיך, ייווצר משלוח נוסף.</p>
              </div>
            </div>
          )}

          {/* Shipment type */}
          <div>
            <Label className="mb-2 block font-semibold">סוג משלוח</Label>
            <div className="grid grid-cols-3 gap-2">
              {SHIPMENT_TYPES.map(t => (
                <button
                  key={t.value}
                  onClick={() => setShipmentType(t.value)}
                  className={`p-3 rounded-xl border-2 text-center transition-all ${
                    shipmentType === t.value
                      ? t.color + ' border-current shadow-md scale-[1.02]'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <div className="text-lg">{t.label.split(' ')[0]}</div>
                  <div className="text-xs font-medium mt-1">{t.label.split(' ').slice(1).join(' ')}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Address fields */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>שם הנמען *</Label>
              <Input value={toName} onChange={e => setToName(e.target.value)} placeholder="שם מלא" />
            </div>
            <div className="col-span-2">
              <Label>טלפון *</Label>
              <Input value={toPhone} onChange={e => setToPhone(e.target.value)} placeholder="050-1234567" />
            </div>
            <div className="col-span-2">
              <Label>רחוב + מספר</Label>
              <Input value={toStreet} onChange={e => setToStreet(e.target.value)} placeholder="שדרות הציונות 5" />
            </div>
            <div>
              <Label>עיר *</Label>
              <Input value={toCity} onChange={e => setToCity(e.target.value)} placeholder="תל אביב" />
            </div>
            <div>
              <Label>קומה</Label>
              <Input value={toFloor} onChange={e => setToFloor(e.target.value)} placeholder="3" />
            </div>
            <div>
              <Label>דירה</Label>
              <Input value={toApartment} onChange={e => setToApartment(e.target.value)} placeholder="7" />
            </div>
            <div>
              <Label>כניסה</Label>
              <Input value={toEntrance} onChange={e => setToEntrance(e.target.value)} placeholder="א" />
            </div>
          </div>

          {/* Notes and parcels */}
          <div>
            <Label>הערות לשליח</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="הערות שיופיעו על התווית..." />
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>מספר חבילות</Label>
              <Input type="number" min={1} value={numParcels} onChange={e => setNumParcels(parseInt(e.target.value) || 1)} />
            </div>
            <div className="flex items-end">
              <Button variant={showCOD ? "default" : "outline"} size="sm" className="rounded-xl h-9" onClick={() => setShowCOD(!showCOD)}>
                {showCOD ? '✅' : '💰'} גבייה במזומן
              </Button>
            </div>
          </div>

          {showCOD && (
            <div>
              <Label>סכום לגבייה (₪)</Label>
              <Input type="number" min={0} value={codAmount} onChange={e => setCodAmount(parseFloat(e.target.value) || 0)} />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Submit */}
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSubmit} disabled={isSubmitting} className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl shadow-lg">
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Truck className="w-4 h-4 ml-1" />}
              {isSubmitting ? 'יוצר משלוח...' : 'צור משלוח קארגו'}
            </Button>
            <Button variant="outline" onClick={onClose} disabled={isSubmitting} className="rounded-xl">ביטול</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}