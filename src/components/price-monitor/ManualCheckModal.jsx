import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { base44 } from "@/api/base44Client";
import { FlaskConical, CheckCircle2, AlertTriangle } from "lucide-react";

export default function ManualCheckModal({ product, open, onClose, onComplete }) {
  const [form, setForm] = useState({
    my_position: "",
    total_competitors: "",
    my_price_on_site: "",
    my_price_on_zap: "",
    first_place_price: "",
    position_above_me_price: "",
    position_above_me_store: "",
    position_below_me_price: "",
    position_below_me_store: "",
    desired_position_price: "",
    desired_position_store: "",
  });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const numOrNull = (v) => {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };

  const handleRun = async () => {
    if (!form.my_position || !form.my_price_on_site) {
      alert("נא למלא מיקום ומחיר באתר");
      return;
    }
    setRunning(true);
    setResult(null);

    const payload = {
      product_id: product.id,
      my_position: parseInt(form.my_position),
      total_competitors: numOrNull(form.total_competitors),
      my_price_on_site: numOrNull(form.my_price_on_site),
      my_price_on_zap: numOrNull(form.my_price_on_zap),
      first_place_price: numOrNull(form.first_place_price),
      position_above_me_price: numOrNull(form.position_above_me_price),
      position_above_me_store: form.position_above_me_store || null,
      position_below_me_price: numOrNull(form.position_below_me_price),
      position_below_me_store: form.position_below_me_store || null,
      desired_position_price: numOrNull(form.desired_position_price),
      desired_position_store: form.desired_position_store || null,
    };

    const res = await base44.functions.invoke("manualPriceCheck", payload);
    const data = res.data || res;
    setResult(data);
    setRunning(false);
    if (data.success && onComplete) onComplete();
  };

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-purple-600" />
            בדיקה ידנית — {product.product_name}
          </DialogTitle>
        </DialogHeader>

        {result?.success ? (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <span className="font-bold text-green-800">הבדיקה הושלמה</span>
              </div>
              <pre className="text-sm text-green-900 whitespace-pre-wrap">{result.message}</pre>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>סגור</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {result?.error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5" />
                <span className="text-sm text-red-700">{result.error}</span>
              </div>
            )}

            <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500 space-y-1">
              <div>מחיר עלות: <b>₪{product.cost_price}</b> | מיקום רצוי: <b>{product.desired_position}</b> | רווח מינ': <b>{product.min_profit_margin ?? 15}%</b></div>
            </div>

            {/* Required */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">מיקום שלנו *</Label>
                <Input type="number" value={form.my_position} onChange={e => set("my_position", e.target.value)} placeholder="3" />
              </div>
              <div>
                <Label className="text-xs">סה״כ מתחרים</Label>
                <Input type="number" value={form.total_competitors} onChange={e => set("total_competitors", e.target.value)} placeholder="12" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">מחיר שלנו באתר (₪) *</Label>
                <Input type="number" value={form.my_price_on_site} onChange={e => set("my_price_on_site", e.target.value)} placeholder="1299" />
              </div>
              <div>
                <Label className="text-xs">מחיר שלנו ב-Zap (₪)</Label>
                <Input type="number" value={form.my_price_on_zap} onChange={e => set("my_price_on_zap", e.target.value)} placeholder="1299" />
              </div>
            </div>

            <div>
              <Label className="text-xs">מחיר מקום 1 (₪)</Label>
              <Input type="number" value={form.first_place_price} onChange={e => set("first_place_price", e.target.value)} placeholder="1199" />
            </div>

            {/* Above */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">מחיר מקום מעלינו (₪)</Label>
                <Input type="number" value={form.position_above_me_price} onChange={e => set("position_above_me_price", e.target.value)} placeholder="1249" />
              </div>
              <div>
                <Label className="text-xs">חנות מעלינו</Label>
                <Input value={form.position_above_me_store} onChange={e => set("position_above_me_store", e.target.value)} placeholder="KSP" />
              </div>
            </div>

            {/* Below */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">מחיר מקום מתחתינו (₪)</Label>
                <Input type="number" value={form.position_below_me_price} onChange={e => set("position_below_me_price", e.target.value)} placeholder="1349" />
              </div>
              <div>
                <Label className="text-xs">חנות מתחתינו</Label>
                <Input value={form.position_below_me_store} onChange={e => set("position_below_me_store", e.target.value)} placeholder="Ivory" />
              </div>
            </div>

            {/* Desired position */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">מחיר במיקום רצוי (₪)</Label>
                <Input type="number" value={form.desired_position_price} onChange={e => set("desired_position_price", e.target.value)} placeholder="1229" />
              </div>
              <div>
                <Label className="text-xs">חנות במיקום רצוי</Label>
                <Input value={form.desired_position_store} onChange={e => set("desired_position_store", e.target.value)} placeholder="Bug" />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>ביטול</Button>
              <Button onClick={handleRun} disabled={running} className="bg-purple-600 hover:bg-purple-700">
                <FlaskConical className="w-4 h-4 ml-1" />
                {running ? "מחשב..." : "🧪 הרץ בדיקה ידנית"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}