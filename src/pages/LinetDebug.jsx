import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Loader2, Play } from "lucide-react";
import { debugLinetSerial } from "@/functions/debugLinetSerial";

export default function LinetDebug() {
  const [sku, setSku] = useState("663973249");
  const [warehouseId, setWarehouseId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const errorRef = useRef(null);

  const runProbe = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const payload = { sku: sku.trim() || "663973249" };
      if (warehouseId.trim()) payload.warehouse_id = warehouseId.trim();
      const { data } = await debugLinetSerial(payload);
      setResult(data);
    } catch (e) {
      setError(e?.response?.data || String(e));
    } finally {
      setLoading(false);
      if (errorRef.current) errorRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div dir="rtl" className="max-w-5xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">🔧 Linet Debug — גילוי מבנה API</h1>
        <p className="text-sm text-gray-500 mt-1">
          קריאות קריאה בלבד ל-Linet. אין יצירה או שינוי נתונים.
        </p>
      </div>

      {/* Input Section */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div>
            <Label htmlFor="sku" className="text-sm font-semibold text-gray-700">SKU לבדיקה</Label>
            <Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="663973249" className="max-w-xs mt-1" />
          </div>
          <div>
            <Label htmlFor="warehouse" className="text-sm font-semibold text-gray-700">warehouse_id (אופציונלי)</Label>
            <Input id="warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} placeholder="1" className="max-w-xs mt-1" />
          </div>
          <Button onClick={runProbe} disabled={loading} className="bg-[#7D0F82] hover:bg-[#6a0c6f] text-white">
            {loading ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Play className="w-4 h-4 ml-2" />}
            הרץ בדיקה
          </Button>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div ref={errorRef} className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-800 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <pre className="whitespace-pre-wrap break-all font-mono text-xs">{JSON.stringify(error, null, 2)}</pre>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          <ResultSection title="item.raw_item_full — תשובת Linet המלאה (קריאת פרטי הפריט)" data={result.item?.raw_item_full} />
          <ResultSection title="item.raw_item_body0 — הפריט הבודד (data.body[0])" data={result.item?.raw_item_body0} />
          <ResultSection title="item.item_field_names — שמות כל השדות בפריט" data={result.item?.item_field_names} />
          <ResultSection title="item.http_status / item.error" data={{ http_status: result.item?.http_status, error: result.item?.error }} />
          <ResultSection title="mutex.raw_mutex_full — תשובת Linet המלאה (קריאת סריאליים זמינים)" data={result.mutex?.raw_mutex_full} />
          <ResultSection title="mutex.mutex_field_names — שמות השדות בתוצאה הראשונה" data={result.mutex?.mutex_field_names} />
          <ResultSection title="mutex.http_status / mutex.error" data={{ http_status: result.mutex?.http_status, error: result.mutex?.error }} />
        </div>
      )}
    </div>
  );
}

function ResultSection({ title, data }) {
  const display = data ?? null;
  return (
    <Card className="border-l-4 border-l-purple-400 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-gray-700">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs font-mono leading-relaxed overflow-auto max-h-96 text-gray-800 whitespace-pre-wrap break-all">
          {display === null ? "(אין נתונים)" : JSON.stringify(display, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}