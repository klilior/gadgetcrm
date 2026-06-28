import React, { useState } from "react";
import { serialLiveTest } from "@/functions/serialLiveTest";
import { debugIdcodeSearch } from "@/functions/debugIdcodeSearch";
import { debugLinetDocStructure } from "@/functions/debugLinetDocStructure";

export default function SerialLiveTest() {
  const [itemId, setItemId] = useState("53");
  const [sku, setSku] = useState("190198231642");
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  const [idcodeLog, setIdcodeLog] = useState(null);
  const [idcodeLoading, setIdcodeLoading] = useState(false);
  const [idcodeError, setIdcodeError] = useState(null);
  const [idcodeSerial, setIdcodeSerial] = useState("190199098572");

  // Doc Structure probe
  const [docLog, setDocLog] = useState(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState(null);
  const [docId, setDocId] = useState("");

  const runDocProbe = async () => {
    setDocLoading(true);
    setDocLog(null);
    setDocError(null);
    try {
      const res = await debugLinetDocStructure({ doc_id: docId.trim() || undefined });
      setDocLog(res.data ?? res);
    } catch (e) {
      setDocError(e?.response?.data?.error ?? e?.message ?? String(e));
    } finally {
      setDocLoading(false);
    }
  };

  const runIdcodeTest = async () => {
    setIdcodeLoading(true);
    setIdcodeLog(null);
    setIdcodeError(null);
    try {
      const res = await debugIdcodeSearch({ serial: idcodeSerial, item_id: Number(itemId) });
      setIdcodeLog(res.data ?? res);
    } catch (e) {
      setIdcodeError(e?.response?.data?.error ?? e?.message ?? String(e));
    } finally {
      setIdcodeLoading(false);
    }
  };

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

        {/* Doc Structure Probe */}
        <div className="mb-8 border border-cyan-800 rounded-lg p-4 bg-cyan-950/20">
          <h2 className="text-cyan-400 font-bold text-sm mb-1">🔬 אבחון מבנה מסמך Linet (idcode בחשבונית)</h2>
          <p className="text-cyan-700 text-xs mb-3">קריאה בלבד · לא מפיק מסמך · מחפש איפה הסריאלי יושב בתוך שורת מסמך קיים</p>
          <div className="flex flex-wrap gap-3 mb-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-cyan-600 text-xs uppercase tracking-widest">Doc ID (אופציונלי)</label>
              <input
                type="text"
                value={docId}
                onChange={e => setDocId(e.target.value)}
                placeholder="ריק = ראשון שיחזור"
                className="bg-gray-900 border border-cyan-800 text-cyan-200 rounded px-3 py-2 text-sm w-52 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
            <button
              onClick={runDocProbe}
              disabled={docLoading}
              className="px-6 py-2 bg-cyan-700 hover:bg-cyan-600 disabled:bg-cyan-900 disabled:text-cyan-800 text-white font-bold rounded-lg text-sm transition-colors"
            >
              {docLoading ? "⏳ בודק..." : "▶ הרץ אבחון מסמך"}
            </button>
          </div>
          {docError && (
            <div className="p-3 bg-red-950 border border-red-700 rounded text-red-300 text-xs mb-2">
              <span className="font-bold">EXCEPTION: </span>{docError}
            </div>
          )}
          {docLog && (
            <div className="space-y-3 text-xs">
              {/* Step 1 */}
              <div className="border border-cyan-900 rounded p-3 bg-gray-900">
                <div className="font-bold text-cyan-400 mb-1">שלב 1 — probe מודלים (docs / document)</div>
                <div>working model: <span className="text-white font-bold">{docLog.step1_working_model ?? "—"}</span></div>
                <div>docs: HTTP {docLog.step1_model_probe?.docs?.http_status} · rows {docLog.step1_model_probe?.docs?.row_count}</div>
                <div>document: HTTP {docLog.step1_model_probe?.document?.http_status} · rows {docLog.step1_model_probe?.document?.row_count}</div>
                {docLog.note && <div className="text-yellow-400 mt-1">⚠️ {docLog.note}</div>}
              </div>
              {/* Step 2 */}
              {docLog.step2_doc_top_level_keys && (
                <div className="border border-cyan-900 rounded p-3 bg-gray-900">
                  <div className="font-bold text-cyan-400 mb-1">שלב 2 — מבנה מסמך ראשון</div>
                  <div>שדות עליונים: <span className="text-white">{docLog.step2_doc_top_level_keys.join(", ")}</span></div>
                  {docLog.step2_array_fields_in_doc?.length > 0 && (
                    <div className="mt-1">
                      מערכים בתוך המסמך:
                      {docLog.step2_array_fields_in_doc.map(af => (
                        <div key={af.field} className="mr-3 text-yellow-300">
                          [{af.field}] len={af.length} · keys: {af.first_item_keys.join(", ")}
                        </div>
                      ))}
                    </div>
                  )}
                  <details className="mt-2">
                    <summary className="text-cyan-600 cursor-pointer">מסמך מלא גולמי</summary>
                    <pre className="mt-1 text-gray-400 overflow-auto max-h-48 whitespace-pre-wrap break-all">{JSON.stringify(docLog.step2_doc_sample, null, 2)}</pre>
                  </details>
                </div>
              )}
              {/* Step 3 */}
              <div className="border border-cyan-900 rounded p-3 bg-gray-900">
                <div className="font-bold text-cyan-400 mb-1">שלב 3 — שורת פריט סריאלית</div>
                {docLog.step3_serial_doc_found ? (
                  <>
                    <div>doc_id: <span className="text-white">{docLog.step3_serial_doc_id}</span> · שדה שורות: <span className="text-yellow-300">{docLog.step3_serial_line_field}</span></div>
                    <div className="mt-1">שדות בשורה: <span className="text-white">{docLog.step3_serial_line_keys?.join(", ")}</span></div>
                    <pre className="mt-1 text-green-300 overflow-auto max-h-48 whitespace-pre-wrap break-all">{JSON.stringify(docLog.step3_serial_line_full, null, 2)}</pre>
                  </>
                ) : (
                  <div className="text-yellow-400">לא נמצאה שורה עם פריט סריאלי ידוע ב-20 המסמכים הראשונים.</div>
                )}
              </div>
              {/* Step 4 */}
              {docLog.step4_single_doc_probe && (
                <div className="border border-cyan-900 rounded p-3 bg-gray-900">
                  <div className="font-bold text-cyan-400 mb-1">שלב 4 — מסמך בודד + חיפוש סריאלי עמוק</div>
                  <div>HTTP: {docLog.step4_single_doc_probe.http_status} · rows: {docLog.step4_single_doc_probe.row_count}</div>
                  {docLog.step4_serial_candidates_in_doc?.length > 0 ? (
                    <div className="mt-1">
                      <div className="text-green-400 font-bold">🔑 מועמדים לסריאלי שנמצאו:</div>
                      {docLog.step4_serial_candidates_in_doc.map((c, i) => (
                        <div key={i} className="mr-3 font-mono text-yellow-200">{c.path}: <span className="text-white">{c.value}</span></div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-gray-500 mt-1">לא נמצאו מחרוזות בפורמט סריאלי.</div>
                  )}
                  <details className="mt-2">
                    <summary className="text-cyan-600 cursor-pointer">מסמך מלא גולמי</summary>
                    <pre className="mt-1 text-gray-400 overflow-auto max-h-48 whitespace-pre-wrap break-all">{JSON.stringify(docLog.step4_single_doc_probe.full_doc, null, 2)}</pre>
                  </details>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Idcode Search Diagnostic */}
        <div className="mb-8 border border-yellow-800 rounded-lg p-4 bg-yellow-950/30">
          <h2 className="text-yellow-400 font-bold text-sm mb-3">🔍 בדיקת חיפוש ישיר לפי idcode (זמני)</h2>
          <div className="flex flex-wrap gap-3 mb-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-yellow-600 text-xs uppercase tracking-widest">Serial (idcode)</label>
              <input
                type="text"
                value={idcodeSerial}
                onChange={e => setIdcodeSerial(e.target.value)}
                className="bg-gray-900 border border-yellow-800 text-yellow-200 rounded px-3 py-2 text-sm w-52 focus:outline-none focus:border-yellow-500 font-mono"
              />
            </div>
            <button
              onClick={runIdcodeTest}
              disabled={idcodeLoading}
              className="px-6 py-2 bg-yellow-700 hover:bg-yellow-600 disabled:bg-yellow-900 disabled:text-yellow-800 text-white font-bold rounded-lg text-sm transition-colors"
            >
              {idcodeLoading ? "⏳ בודק..." : "▶ הרץ 3 בדיקות idcode"}
            </button>
          </div>
          {idcodeError && (
            <div className="p-3 bg-red-950 border border-red-700 rounded text-red-300 text-xs mb-2">
              <span className="font-bold">EXCEPTION: </span>{idcodeError}
            </div>
          )}
          {idcodeLog && (
            <div className="space-y-2">
              <div className={`px-4 py-2 rounded-lg text-sm font-bold border ${
                idcodeLog.conclusion?.includes("✓") ? "bg-green-950 border-green-700 text-green-300" : "bg-gray-900 border-gray-700 text-gray-300"
              }`}>
                📋 {idcodeLog.conclusion}
              </div>
              {["probe_1_idcode_only", "probe_2_idcode_and_item", "probe_3_serial_field"].map((key, i) => {
                const p = idcodeLog[key];
                if (!p) return null;
                const isDirectMatch = p.row_count === 1 && p.first_idcode === idcodeLog.tested_serial;
                return (
                  <div key={key} className={`border rounded p-3 text-xs space-y-1 ${
                    isDirectMatch ? "border-green-700 bg-green-950/40" : "border-gray-700 bg-gray-900"
                  }`}>
                    <div className="font-bold text-yellow-400">Probe {i+1}: query={JSON.stringify(p.query_sent)}</div>
                    <div>HTTP: <span className={p.http_status === 200 ? "text-green-400" : "text-red-400"}>{p.http_status}</span> | rows: <span className="text-white">{p.row_count ?? "N/A"}</span> | first_idcode: <span className="font-mono text-white">{p.first_idcode ?? "—"}</span> {isDirectMatch ? "✅ direct match!" : ""}</div>
                    {p.raw_sample && (
                      <pre className="text-gray-400 overflow-auto max-h-24 whitespace-pre-wrap break-all">{JSON.stringify(p.raw_sample, null, 2)}</pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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