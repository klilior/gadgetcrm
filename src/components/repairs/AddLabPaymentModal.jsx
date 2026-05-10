import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { base44 } from '@/api/base44Client';
import { Loader2, Banknote } from 'lucide-react';

const paymentTypes = ["מזומן", "העברה בנקאית", "צ׳ק", "ביט", "פייבוקס", "אחר"];

export default function AddLabPaymentModal({ isOpen, onClose, onSaved, currentUser }) {
  const [form, setForm] = useState({
    payment_date: new Date().toISOString().split('T')[0],
    amount: '',
    payment_type: '',
    notes: ''
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.amount || !form.payment_type || !form.payment_date) return;
    setSaving(true);
    await base44.entities.LabPayment.create({
      payment_date: form.payment_date,
      amount: parseFloat(form.amount),
      payment_type: form.payment_type,
      recorded_by: currentUser?.employee_name || 'לא ידוע',
      notes: form.notes || ''
    });
    setSaving(false);
    setForm({ payment_date: new Date().toISOString().split('T')[0], amount: '', payment_type: '', notes: '' });
    onSaved?.();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="w-5 h-5 text-green-600" />
            רישום תשלום למעבדה
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>תאריך תשלום *</Label>
            <Input
              type="date"
              value={form.payment_date}
              onChange={e => setForm({ ...form, payment_date: e.target.value })}
            />
          </div>
          <div>
            <Label>סכום בש״ח *</Label>
            <Input
              type="number"
              placeholder="0"
              value={form.amount}
              onChange={e => setForm({ ...form, amount: e.target.value })}
            />
          </div>
          <div>
            <Label>סוג תשלום *</Label>
            <Select value={form.payment_type} onValueChange={v => setForm({ ...form, payment_type: v })}>
              <SelectTrigger>
                <SelectValue placeholder="בחר סוג תשלום..." />
              </SelectTrigger>
              <SelectContent>
                {paymentTypes.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>הערות</Label>
            <Textarea
              placeholder="הערות נוספות (אופציונלי)"
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              rows={2}
            />
          </div>
          <Button
            className="w-full bg-green-600 hover:bg-green-700"
            onClick={handleSave}
            disabled={saving || !form.amount || !form.payment_type || !form.payment_date}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : null}
            שמור תשלום
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}