import React, { useState } from "react";
import { serialLiveTest } from "@/functions/serialLiveTest";

export default function SerialLiveTest() {
  const [itemId, setItemId] = useState("53");
  const [sku, setSku] = useState("190198231642");
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  const runTest = async () => {
    setLoading(true);
    setLog(null);
    setError(null);
    setCopied(false);
    try {
      const res = await serialLiveTest({
        linet_item_id: Number(itemId),
        linet_sku: sku,
      });
      setLog(res.data?.log ?? res.data ?? res);
    } catch (e) {
      setError(e?.response?.data?.error ?? e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const logText = log ? JSON.stringify(log, null, 2) : "";

  const copyLog = () => {
    navigator.clipboard.writeText(logText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <div dir="rtl" className="min-h-screen bg-gray-950 text-green-300 font-mono p-6">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-green-400 mb-1">🔬 בדיקת סריאליים — סביבה חיה</h1>
          <p className="text-green-700 text-sm">קריאה בלבד מול Linet · אין כתיבה · admin only</p>
        </div>

        {/* Inputs */}
        <div className="flex flex-wrap gap-4 mb-6">
          <div className="flex flex-col gap-1">
            <label className="text-green-600 text-xs uppercase tracking-widest">Item ID (linet)</label>
            <input
              type="text"
              value={itemId}
              onChange={e => setItemId(e.target.value)}
              className="bg-gray-900 border border-green-800 text-green-200 rounded px-3 py-2 text-sm w-32 focus:outline-none focus:border-green-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-green-600 text-xs uppercase tracking-widest">SKU</label>
            <input
              type="text"
              value={sku}
              onChange={e => setSku(e.target.value)}
              className="bg-gray-900 border border-green-800 text-green-200 rounded px-3 py-2 text-sm w-52 focus:outline-none focus:border-green-500"
            />
          </div>
        </div>

        {/* Run button */}
        <button
          onClick={runTest}
          disabled={loading}
          className="mb-6 px-8 py-3 bg-green-700 hover:bg-green-600 disabled:bg-green-900 disabled:text-green-700 text-white font-bold rounded-lg text-base transition-colors"
        >
          {loading ? "⏳ מריץ בדיקה..." : "▶ הרץ בדיקה"}
        </button>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 bg-red-950 border border-red-700 rounded-lg text-red-300 text-sm">
            <span className="font-bold text-red-400">EXCEPTION: </span>{error}
          </div>
        )}

        {/* Log output */}
        {log && (
          <div className="relative">
            <div className="flex items-center justify-between mb-2">
              <span className="text-green-600 text-xs uppercase tracking-widest">לוג אבחון מלא</span>
              <button
                onClick={copyLog}
                className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 border border-green-800 text-green-400 hover:text-green-300 rounded text-xs font-bold transition-colors"
              >
                {copied ? "✓ הועתק!" : "📋 העתק לוג"}
              </button>
            </div>

            {/* Quick summary strip */}
            <div className="flex flex-wrap gap-3 mb-3">
              {[
                { label: "HTTP", value: log["4_HTTP_STATUS"], ok: log["4_HTTP_STATUS"] === 200 },
                { label: "Rows", value: log["6_SERIALS_FOUND"]?.inv_row_count },
                { label: "Serials", value: log["6_SERIALS_FOUND"]?.net_serials_count },
                { label: "login_id", value: log["2_AUTH_CHECK"]?.login_id_empty ? "EMPTY ⚠️" : log["2_AUTH_CHECK"]?.login_id, ok: !log["2_AUTH_CHECK"]?.login_id_empty },
                { label: "login_hash", value: log["2_AUTH_CHECK"]?.login_hash_empty ? "EMPTY ⚠️" : log["2_AUTH_CHECK"]?.login_hash, ok: !log["2_AUTH_CHECK"]?.login_hash_empty },
                { label: "company", value: log["2_AUTH_CHECK"]?.login_company_empty ? "EMPTY ⚠️" : log["2_AUTH_CHECK"]?.login_company, ok: !log["2_AUTH_CHECK"]?.login_company_empty },
              ].map(({ label, value, ok }) => (
                <div key={label} className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border ${
                  ok === false ? "bg-red-950 border-red-700 text-red-300" :
                  ok === true ? "bg-green-950 border-green-700 text-green-300" :
                  "bg-gray-900 border-gray-700 text-gray-300"
                }`}>
                  <span className="text-gray-500">{label}:</span>
                  <span className="font-bold">{String(value ?? "—")}</span>
                </div>
              ))}
            </div>

            {/* Full JSON log */}
            <pre
              className="bg-gray-900 border border-green-900 rounded-lg p-5 text-xs text-green-200 overflow-auto max-h-[60vh] whitespace-pre-wrap break-all select-all cursor-text"
            >
              {logText}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}