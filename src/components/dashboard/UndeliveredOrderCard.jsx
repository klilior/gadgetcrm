import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Package, Phone, MessageCircle, Truck, Clock, MapPin, User, X, CheckCircle, Zap } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import CreateShipmentModal from '@/components/shipping/CreateShipmentModal';
import CargoShipmentModal from '@/components/cargo/CargoShipmentModal';
import GetPackageOrderCard from '@/components/getpackage/GetPackageOrderCard';

function parseProducts(productsJson) {
  try { return JSON.parse(productsJson || '[]'); } catch { return []; }
}

function normalizePhone(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/[^\d]/g, '');
  if (digits.length === 12 && digits.startsWith('972')) digits = '0' + digits.slice(3);
  if (digits.length === 9 && !digits.startsWith('0')) digits = '0' + digits;
  return digits || null;
}

const reasonLabels = {
  Cargo: 'נשלח בקארגו',
  UPS: 'נשלח UPS',
  GetPackage: 'נשלח GetPackage',
  Pickup: 'איסוף עצמי',
  Cancelled: 'בוטל',
};

export default function UndeliveredOrderCard({ task, currentUser, isManager, onTaskUpdated }) {
  const [client, setClient] = useState(null);
  const [upsOpen, setUpsOpen] = useState(false);
  const [cargoOpen, setCargoOpen] = useState(false);
  const [getPackageOpen, setGetPackageOpen] = useState(false);
  const [closeModal, setCloseModal] = useState({ open: false, reason: null });
  const [closeNote, setCloseNote] = useState('');
  const products = parseProducts(task.products_list);
  const ageDays = task.created_date ? differenceInDays(new Date(), new Date(task.created_date)) : 0;

  useEffect(() => {
    let cancelled = false;
    const loadClient = async () => {
      const phone = normalizePhone(task.customer_phone);
      if (!phone && !task.client_id) return;
      let rows = [];
      if (task.client_id) rows = await base44.entities.Client.filter({ id: task.client_id }, null, 1);
      if (rows.length === 0 && phone) rows = await base44.entities.Client.filter({ phone }, null, 1);
      if (!cancelled) setClient(rows[0] || null);
    };
    loadClient();
    return () => { cancelled = true; };
  }, [task.client_id, task.customer_phone]);

  const ageColor = ageDays <= 1 ? 'bg-green-100 text-green-700' : ageDays <= 3 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700';
  const phone = normalizePhone(task.customer_phone || client?.phone);
  const address = client?.full_address || task.customer_address || '';
  const city = client?.city || task.customer_city || '';

  const shipmentOrder = {
    id: null,
    raw_id: null,
    source: 'linet',
    order_number: task.source_doc_number,
    external_order_number: task.source_doc_number,
    client_id: client?.id || task.client_id || null,
    customer_name: task.customer_name,
    customer_phone: phone,
    customer_email: client?.email || '',
    shipping_city: city,
    shipping_street: address,
    shipping_address_full: address,
    notes: `חשבונית לינט #${task.source_doc_number}`,
    products: products.map(p => ({ name: p.product_name, quantity: p.qty || 1, total: 0 })),
    total: 0,
  };

  const closeTask = async (reason, note = '') => {
    const now = new Date().toISOString();
    const existingLog = task.activity_log ? JSON.parse(task.activity_log) : [];
    await base44.entities.UndeliveredOrderTask.update(task.id, {
      status: 'Closed',
      close_reason: reason,
      close_note: note || null,
      closed_at: now,
      activity_log: JSON.stringify([
        ...existingLog,
        { action: `סגירה: ${reasonLabels[reason] || reason}`, user: currentUser?.employee_name || currentUser?.email || 'משתמש', timestamp: now, note: note || null },
      ]),
    });
    setCloseModal({ open: false, reason: null });
    setCloseNote('');
    onTaskUpdated?.();
  };

  return (
    <Card className="overflow-hidden border-orange-200 bg-white shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-0">
        <div className="bg-gradient-to-l from-orange-500 to-amber-500 text-white p-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            <span className="font-bold">חשבונית #{task.source_doc_number}</span>
            <Badge className="bg-white/20 text-white border-white/30">{task.source_doc_date ? format(new Date(task.source_doc_date), 'dd/MM/yy') : '-'}</Badge>
          </div>
          <Badge className={`${ageColor} border-0`}><Clock className="w-3 h-3 ml-1" />{ageDays} ימים פתוחה</Badge>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
              <div className="text-xs text-slate-400 mb-1 flex items-center gap-1"><User className="w-3 h-3" /> לקוח</div>
              <div className="font-bold text-slate-900">{task.customer_name || 'לקוח'}</div>
              {phone && <a href={`tel:${phone}`} className="text-sm text-blue-700 font-mono hover:underline">{phone}</a>}
              {address && <div className="text-xs text-slate-500 mt-1 flex gap-1"><MapPin className="w-3 h-3 mt-0.5" />{address}</div>}
            </div>

            <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 md:col-span-2">
              <div className="text-xs text-slate-400 mb-2 flex items-center gap-1"><Package className="w-3 h-3" /> פריטים למשלוח</div>
              <div className="space-y-1">
                {products.length > 0 ? products.map((p, idx) => (
                  <div key={idx} className="flex justify-between gap-2 text-sm bg-white rounded-lg px-2 py-1 border border-slate-100">
                    <span className="text-slate-800">{p.product_name}</span>
                    <span className="text-slate-500 font-mono">×{p.qty}</span>
                  </div>
                )) : <div className="text-sm text-slate-400">אין פריטים</div>}
              </div>
            </div>
          </div>

          {isManager && task.owner_name && <div className="text-xs text-slate-500">נציג מטפל: {task.owner_name}</div>}

          <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-3">
            <div className="text-sm font-bold text-blue-900 mb-2">טיפול והנפקת תעודת משלוח</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white rounded-full" onClick={() => setCargoOpen(true)}>
                <Truck className="w-4 h-4 ml-1" /> קארגו
              </Button>
              <Button size="sm" className="bg-amber-700 hover:bg-amber-800 text-white rounded-full" onClick={() => setUpsOpen(true)}>
                <Package className="w-4 h-4 ml-1" /> UPS / נקודות איסוף
              </Button>
              <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white rounded-full" onClick={() => setGetPackageOpen(v => !v)}>
                <Zap className="w-4 h-4 ml-1" /> GetPackage
              </Button>
              {phone && <Button size="sm" variant="outline" className="rounded-full" asChild><a href={`https://wa.me/972${phone.replace(/^0/, '')}`} target="_blank" rel="noreferrer"><MessageCircle className="w-4 h-4 ml-1" /> וואטסאפ</a></Button>}
              {phone && <Button size="sm" variant="outline" className="rounded-full" asChild><a href={`tel:${phone}`}><Phone className="w-4 h-4 ml-1" /> התקשר</a></Button>}
            </div>
          </div>

          {getPackageOpen && <GetPackageOrderCard order={shipmentOrder} isManager={isManager} isShiftManager={isManager} onAddNote={(note) => closeTask('GetPackage', note)} />}

          <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
            <Button size="sm" variant="outline" className="border-green-200 text-green-700 rounded-full" onClick={() => setCloseModal({ open: true, reason: 'Pickup' })}>
              <CheckCircle className="w-4 h-4 ml-1" /> נסגר באיסוף עצמי
            </Button>
            <Button size="sm" variant="outline" className="border-red-200 text-red-700 rounded-full" onClick={() => setCloseModal({ open: true, reason: 'Cancelled' })}>
              <X className="w-4 h-4 ml-1" /> ביטול
            </Button>
          </div>
        </div>
      </CardContent>

      <CreateShipmentModal
        open={upsOpen}
        onClose={() => setUpsOpen(false)}
        order={shipmentOrder}
        client={client}
        initialType="standard"
        onSuccess={(result) => closeTask('UPS', result?.tracking_number ? `שטר מטען UPS: ${result.tracking_number}` : 'נוצר שטר מטען UPS')}
      />

      <CargoShipmentModal
        open={cargoOpen}
        onClose={(result) => {
          setCargoOpen(false);
          if (result?.shipment_id) closeTask('Cargo', `משלוח קארגו: ${result.shipment_id}`);
        }}
        order={shipmentOrder}
        client={client}
        initialShipmentType="delivery"
      />

      <Dialog open={closeModal.open} onOpenChange={(open) => !open && setCloseModal({ open: false, reason: null })}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader><DialogTitle>סגירת טיפול</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-700">לאשר סגירה כ־<strong>{reasonLabels[closeModal.reason]}</strong>?</p>
            <Textarea value={closeNote} onChange={e => setCloseNote(e.target.value)} placeholder={closeModal.reason === 'Cancelled' ? 'סיבת הביטול (חובה)' : 'הערה'} rows={3} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCloseModal({ open: false, reason: null })}>ביטול</Button>
            <Button disabled={closeModal.reason === 'Cancelled' && !closeNote.trim()} onClick={() => closeTask(closeModal.reason, closeNote)} className="bg-orange-600 hover:bg-orange-700">אישור</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}