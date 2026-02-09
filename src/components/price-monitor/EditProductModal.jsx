import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

export default function EditProductModal({ product, open, onClose, onSave, onRemove }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (product) {
      setForm({
        product_name: product.product_name || "",
        my_woocommerce_url: product.my_woocommerce_url || "",
        zap_comparison_url: product.zap_comparison_url || "",
        cost_price: product.cost_price ?? "",
        desired_position: product.desired_position ?? "",
        min_profit_margin: product.min_profit_margin ?? 15,
        my_store_name_zap: product.my_store_name_zap || "GADGET TEAM",
        notes: product.notes || "",
        is_active: product.is_active !== false,
      });
    }
  }, [product]);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.product_name || !form.zap_comparison_url || !form.cost_price || !form.desired_position) {
      alert("נא למלא את כל השדות הנדרשים");
      return;
    }
    setSaving(true);
    await onSave(product.id, {
      product_name: form.product_name,
      my_woocommerce_url: form.my_woocommerce_url || "",
      zap_comparison_url: form.zap_comparison_url,
      cost_price: parseFloat(form.cost_price),
      desired_position: parseInt(form.desired_position),
      min_profit_margin: parseFloat(form.min_profit_margin) || 15,
      my_store_name_zap: form.my_store_name_zap || "GADGET TEAM",
      notes: form.notes || "",
      is_active: form.is_active,
    });
    setSaving(false);
    onClose();
  };

  const handleRemove = async () => {
    if (!confirm(`האם למחוק את "${product?.product_name}" מהניטור?`)) return;
    setSaving(true);
    await onRemove(product.id);
    setSaving(false);
    onClose();
  };

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle>עריכת מוצר</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>שם מוצר *</Label>
            <Input value={form.product_name} onChange={e => set("product_name", e.target.value)} />
          </div>
          <div>
            <Label>קישור WooCommerce</Label>
            <Input value={form.my_woocommerce_url} onChange={e => set("my_woocommerce_url", e.target.value)} dir="ltr" />
          </div>
          <div>
            <Label>קישור Zap השוואה *</Label>
            <Input value={form.zap_comparison_url} onChange={e => set("zap_comparison_url", e.target.value)} dir="ltr" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>מחיר עלות (₪) *</Label>
              <Input type="number" value={form.cost_price} onChange={e => set("cost_price", e.target.value)} />
            </div>
            <div>
              <Label>מיקום רצוי *</Label>
              <Input type="number" value={form.desired_position} onChange={e => set("desired_position", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>אחוז רווח מינימלי (%)</Label>
              <Input type="number" value={form.min_profit_margin} onChange={e => set("min_profit_margin", e.target.value)} />
            </div>
            <div>
              <Label>שם חנות ב-Zap</Label>
              <Input value={form.my_store_name_zap} onChange={e => set("my_store_name_zap", e.target.value)} />
            </div>
          </div>
          <div>
            <Label>הערות</Label>
            <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} />
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={form.is_active} onCheckedChange={v => set("is_active", v)} />
            <Label className="cursor-pointer">מוצר פעיל</Label>
          </div>
          <DialogFooter className="flex justify-between sm:justify-between">
            <Button type="button" variant="destructive" size="sm" onClick={handleRemove} disabled={saving}>
              הסר מניטור
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
              <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                {saving ? "שומר..." : "שמור שינויים"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}