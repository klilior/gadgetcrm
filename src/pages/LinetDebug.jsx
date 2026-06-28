import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Loader2, Play, CheckCircle2, Info } from "lucide-react";
import { debugLinetSerial } from "@/functions/debugLinetSerial";

export default function LinetDebug() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const errorRef = useRef(null);

  const runProbe = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data } = await debugLinetSerial({});
      setResult(data);
    } catch (e) {
      setError(e?.response?.data || String(e));
    } finally {
      setLoading(false);
      if (errorRef.current) errorRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div dir="rtl" className="max-w-6xl mx-auto p-4 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">🔧 גילוי מלאי Linet
            <span className="inline-flex items-center gap-1 mr-2 text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-2.5 py-0.5 align-middle">
              <CheckCircle2 className="w-3 h-3" /> מנהל בלבד · קריאה בלבד
            </span>
          </h1>
          <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
            <Info className="w-3.5 h-3.5" />
            משתמש רק ב-endpoints מתועדים: POST /api/{'{action}/{model}/'}. לא נוגע ב-Linet או בישויות.
          </p>
        </div>
        <Button onClick={runProbe} disabled={loading} className="bg-[#7D0F82] hover:bg-[#6a0c6f] text-white">
          {loading ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Play className="w-4 h-4 ml-2" />}
          הרץ 4 קריאות
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div ref={errorRef} className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-800 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <pre className="whitespace-pre-wrap break-all font-mono text-xs">{JSON.stringify(error, null, 2)}</pre>
        </div>
      )}

      {/* Test Info Panel */}
      <Card className="bg-indigo-50 border border-indigo-200">
        <CardContent className="p-4 text-sm text-indigo-800">
          <strong>פרמטרי בדיקה:</strong>
          <ul className="mt-1 space-y-1 list-disc list-inside">
            <li>iPhone לטיפול סדרתי: item_id = <code className="bg-indigo-100 px-1.5 py-0.5 rounded text-xs font-mono">53</code>, SKU = <code className="bg-indigo-100 px-1.5 py-0.5 rounded text-xs font-mono">190198231642</code>, stockType = <code className="bg-indigo-100 px-1.5 py-0.5 rounded text-xs font-mono">2</code></li>
          </ul>
        </CardContent>
      </Card>

      {/* Results */}
      {loading && (
        <div className="text-center py-12 text-sm text-gray-500">
          <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin text-purple-600" />
          מריץ 4 קריאות ל-Linet...
        </div>
      )}

      {result && (
        <div className="space-y-6">
          {/* Call 1 */}
          <CallSection
            number="1"
            endpoint="POST /api/view/item/53/"
            title="פרטי הפריט הבודד"
            expected="פרטי iPhone 53"
            data={result.call1_view_item}
          />

          {/* Call 2 */}
          <CallSection
            number="2"
            endpoint="POST /api/search/item/  {sku: 190198231642}"
            title="חיפוש מסונן לפי SKU"
            expected={result.call2_search_item?.count !== null ? `חזרו ${result.call2_search_item.count} תוצאות` : "בודק"}
            data={result.call2_search_item}
          />

          {/* Call 3 */}
          <CallSection
            number="3"
            endpoint="POST /api/list/inventoryitem/"
            title="מבנה מודל המלאי"
            expected="מחפשים: serial, item_id, warehouse, זמינות/כמות/כיוון"
            data={result.call3_list_inventory}
          />

          {/* Call 4 */}
          <CallSection
            number="4"
            endpoint="POST /api/search/inventoryitem/  {item_id: 53}"
            title="תנועות מלאי של ה-iPhone"
            expected="כאן אמורים להופיע הסריאליים בפועל"
            data={result.call4_search_inventory}
          />
        </div>
      )}
    </div>
  );
}

function CallSection({ number, endpoint, title, expected, data }) {
  const empty = data?.raw === null || data?.raw === undefined;
  const arrayBody = Array.isArray(data?.raw?.body);
  const body = arrayBody ? data.raw.body : data?.raw?.body;
  const recordCount = arrayBody ? `body: array[${body.length}]` : typeof body === "string" ? `body: "${body}"` : typeof body === "object" && body !== null ? "body: object" : "body: null/string";
  const firstRecord = arrayBody && body.length > 0 ? body[0] : body;
  return (
    <Card className="border-r-[3px] border-r-purple-500 shadow-sm overflow-hidden">
      <CardHeader className="pb-1 pt-3 px-4 flex-row items-start justify-between">
        <div>
          <CardTitle className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <span className="bg-[#7D0F82] text-white text-[10px] font-bold rounded-full w-5 h-5 inline-flex items-center justify-center">#{number}</span>
            {title}
          </CardTitle>
          <p className="text-xs text-gray-500 mt-1 font-mono">{endpoint}</p>
          <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] border ${data?.status >= 200 && data?.status < 300 ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
            HTTP {data?.status || "?"}
          </span>
          <span className="mr-2 text-[10px] text-gray-500">{recordCount}</span>
        </div>
        {expected && <span className="text-[10px] text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5 max-w-[180px] text-left">{expected}</span>}
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-1">
        {/* Keys List */}
        {data?.keys?.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            <span className="text-[10px] font-semibold text-gray-500 self-center">מפתחות body[0]:</span>
            {data.keys.map((k) => (
              <span key={k} className="text-[10px] font-mono bg-slate-100 text-slate-600 border border-slate-200 rounded px-1.5 py-0.5">{k}</span>
            ))}
          </div>
        )}
        {!data?.keys && <div className="mb-2 text-[10px] text-gray-400">(body אינו array או ריק — מפתחות לא זמינים)</div>}
        {/* Raw */}
        <pre className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-mono leading-relaxed overflow-auto max-h-80 text-gray-800 whitespace-pre-wrap break-all">
          {empty ? "(ריק)" : JSON.stringify(data?.raw, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}