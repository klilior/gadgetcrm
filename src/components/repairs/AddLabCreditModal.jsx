import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { base44 } from '@/api/base44Client';
import { Loader2, PackageMinus } from 'lucide-react';
import ProductSearchSelect from '@/components/vendor-report/ProductSearchSelect';

export default function AddLabCreditModal({ isOpen, onClose, onSaved, currentUser }) {
  const [form, setForm] = useState({
    taken_by: '',
    amount: '',
    notes: ''
  });
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setForm({ taken_by: '', amount: '', notes: '' });
    setSelectedProduct(null);
  };

  const handleSelectProduct = (product) => {
    const price = parseFloat(product.price || product.regular_price || 0) || 0;
    setSelectedProduct(product);
    setForm(f => ({ ...f, amount: price ? String(price) : f.amount }));
  };

  const canSave = form.taken_by && selectedProduct && form.amount;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    await base44.entities.LabCredit.create({
      taken_by: form.taken_by,
      product_description: selectedProduct.name,
      product_sku: selectedProduct.sku || '',
      product_woo_id: selectedProduct.woo_product_id || null,
      amount: parseFloat(form.amount),
      taken_date: new Date().toISOString(),
      recorded_by: currentUser?.employee_name || 'לא ידוע',
      notes: form.notes || ''
    });
    setSaving(false);
    resetForm();
    onSaved?.();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageMinus className="w-5 h-5 text-orange-600" />
            רישום מוצר שנלקח ע״י המעבדה
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>מי לקח *</Label>
            <Input
              placeholder="שם האדם שלקח"
              value={form.taken_by}
              onChange={e => setForm({ ...form, taken_by: e.target.value })}
            />
          </div>
          <div>
            <Label>מוצר שנלקח * (בחירה מהקטלוג בלבד)</Label>
            <ProductSearchSelect
              selected={selectedProduct}
              onSelect={handleSelectProduct}
              onClear={() => setSelectedProduct(null)}
            />
          </div>
          <div>
            <Label>שווי בש״ח *</Label>
            <Input
              type="number"
              placeholder="0"
              value={form.amount}
              readOnly
              className="bg-gray-50"
              onChange={e => setForm({ ...form, amount: e.target.value })}
            />
            <p className="text-xs text-gray-400 mt-1">מתמלא אוטומטית ממחיר המוצר בקטלוג</p>
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
            className="w-full"
            onClick={handleSave}
            disabled={saving || !canSave}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : null}
            שמור
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}