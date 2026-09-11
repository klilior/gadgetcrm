import React, { useState, useEffect, useCallback, useRef } from "react";
import { getAvailableSerials } from "@/functions/getAvailableSerials";
import { refreshSerialsForItem } from "@/functions/refreshSerialsForItem";
import { verifySerial } from "@/functions/verifySerial";
import { updateOrderSerialLine } from "@/functions/updateOrderSerialLine";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertCircle, PackageSearch, ScanLine, RefreshCw } from "lucide-react";

/**
 * SerialPicker — מסך נציג לבחירת/סריקת סריאליים
 * Props:
 *   line: OrderSerialLine record
 *   onUpdated: callback(updatedLine) — נקרא אחרי עדכון ב-DB
 */
export default function SerialPicker({ line, onUpdated }) {
  const [serials, setSerials] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(line?.assigned_serials ?? []);
  const [saving, setSaving] = useState(false);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveAt, setLiveAt] = useState(null);

  // שדה סריקה/הקלדה ידנית
  const [scanInput, setScanInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null); // { ok: bool, message: string }
  const scanRef = useRef(null);

  const required = (line?.serials_required_count ?? 1);
  const skip = !line || !line.requires_serial;
  const isReady = selected.length >= required;

  const statusLabel = isReady
    ? "מוכן ✓"
    : selected.length > 0
    ? `נבחרו ${selected.length} מתוך ${required}`
    : "חסר סריאלי";

  const statusColor = isReady
    ? "bg-green-100 text-green-800 border-green-300"
    : selected.length > 0
    ? "bg-amber-100 text-amber-800 border-amber-300"
    : "bg-red-100 text-red-800 border-red-300";

  // טעינה אוטומטית של הסריאליים
  const loadSerials = useCallback(async () => {
    if (skip) return;
    if (!line.mapped_linet_item_id) {
      setError("אין מיפוי ל-Linet לפריט זה");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await getAvailableSerials({ linet_item_id: line.mapped_linet_item_id, exclude_line_id: line.id });
      const data = res?.data ?? res;
      if (data?.error) {
        setError(data.error);
        setSerials([]);
      } else {
        setSerials(data?.serials ?? []);
      }
    } catch (e) {
      setError(e.message ?? "שגיאה בטעינת סריאליים");
      setSerials([]);
    } finally {
      setLoading(false);
    }
  }, [line?.mapped_linet_item_id, skip]);

  // שליפה חיה מלינט — לסחורה שנקלטה ממש עכשיו
  const liveRefresh = useCallback(async () => {
    if (skip || !line?.mapped_linet_item_id) return;
    setLiveLoading(true);
    setError(null);
    try {
      const res = await refreshSerialsForItem({ linet_item_id: line.mapped_linet_item_id, exclude_line_id: line.id });
      const data = res?.data ?? res;
      if (data?.error) setError(data.error);
      else {
        setSerials(data?.serials ?? []);
        setLiveAt(data?.synced_at ?? new Date().toISOString());
      }
    } catch (e) {
      setError("שליפה חיה מלינט נכשלה. נסה שוב.");
    } finally {
      setLiveLoading(false);
    }
  }, [line?.mapped_linet_item_id, line?.id, skip]);

  useEffect(() => {
    loadSerials();
  }, [loadSerials]);

  // אין מלאי מקומי מספיק → שליפה חיה אוטומטית פעם אחת
  useEffect(() => {
    if (loading || liveLoading || liveAt || skip) return;
    if (selected.length >= required) return;
    if (serials.length >= required - selected.length) return;
    liveRefresh();
  }, [loading, liveLoading, liveAt, serials.length, selected.length, required, skip, liveRefresh]);

  if (skip) return null;

  // בחירה/ביטול בחירה מהרשימה
  const toggleSerial = async (serial) => {
    let next;
    if (selected.includes(serial)) {
      next = selected.filter((s) => s !== serial);
    } else {
      if (selected.length >= required) return;
      next = [...selected, serial];
    }
    setSelected(next);
    await persistSelection(next);
  };

  const persistSelection = async (nextSelected) => {
    setSaving(true);
    try {
      const newStatus = nextSelected.length >= required ? "selected" : "required_missing";
      await updateOrderSerialLine({ line_id: line.id, assigned_serials: nextSelected, serial_status: newStatus });
      if (onUpdated) {
        onUpdated({ ...line, assigned_serials: nextSelected, serial_status: newStatus });
      }
    } catch (e) {
      console.error("שמירת סריאלי נכשלה:", e);
    } finally {
      setSaving(false);
    }
  };

  // אימות סריאלי ידני/סרוק
  const handleVerify = async () => {
    const trimmed = scanInput.trim();
    if (!trimmed) return;
    if (selected.includes(trimmed)) {
      setVerifyResult({ ok: false, message: "הסריאלי כבר נבחר." });
      return;
    }
    if (selected.length >= required) {
      setVerifyResult({ ok: false, message: `כבר נבחרו ${required} סריאליים נדרשים.` });
      return;
    }

    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await verifySerial({ linet_item_id: line.mapped_linet_item_id, serial: trimmed, exclude_line_id: line.id });
      const data = res?.data ?? res;

      if (data?.valid) {
        const next = [...selected, trimmed];
        setSelected(next);
        await persistSelection(next);
        setVerifyResult({ ok: true, message: "סריאלי אומת ונוסף ✓" });
        setScanInput(""); // מנקה לסריקה הבאה
        scanRef.current?.focus();
      } else {
        let msg = "שגיאה באימות. נסה שוב.";
        if (data?.reason === "belongs_to_other_item") {
          msg = `הסריאלי שייך לפריט אחר${data.found_item_name ? `: ${data.found_item_name}` : ""}. לא נוסף.`;
        } else if (data?.reason === "assigned_to_other_order") {
          msg = `הסריאלי כבר משויך להזמנה אחרת${data.conflicting_order_id ? ` (${data.conflicting_order_id})` : ""}. בחר סריאלי אחר.`;
        } else if (data?.reason === "not_found_in_stock") {
          msg = "הסריאלי לא נמצא במלאי Linet. בדוק את המספר או את קליטת המלאי.";
        } else if (data?.reason === "linet_error") {
          msg = "שגיאה באימות מול Linet. נסה שוב.";
        }
        setVerifyResult({ ok: false, message: msg });
      }
    } catch (e) {
      setVerifyResult({ ok: false, message: "שגיאה באימות מול Linet. נסה שוב." });
    } finally {
      setVerifying(false);
    }
  };

  const handleScanKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleVerify();
    }
  };

  const formatDate = (d) => {
    if (!d) return "";
    try { return new Date(d).toLocaleDateString("he-IL"); } catch { return d; }
  };

  return (
    <div dir="rtl" className="border border-gray-200 rounded-xl bg-white shadow-sm p-4 space-y-3">
      {/* כותרת + סטטוס */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-gray-800 text-sm">
            {line.source_product_name}
          </div>
          {line.mapped_linet_item_name && (
            <div className="text-xs text-gray-500 mt-0.5">
              Linet: {line.mapped_linet_item_name}
            </div>
          )}
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${statusColor} whitespace-nowrap`}>
          {statusLabel}
        </span>
      </div>

      {/* ספירת זמינות */}
      <div className="flex items-center gap-2 text-xs text-gray-600">
        <PackageSearch className="w-4 h-4 text-purple-500 flex-shrink-0" />
        {loading ? (
          <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> טוען מלאי...</span>
        ) : error ? (
          <span className="text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {error}</span>
        ) : (
          <span>
            <strong className={serials.length === 0 ? "text-red-600" : "text-purple-700"}>
              {serials.length}
            </strong>{" "}
            סריאליים זמינים במלאי
            {serials.length === 0 && (
              <span className="mr-1 text-red-500">(אין מלאי זמין לפריט זה)</span>
            )}
          </span>
        )}
        {saving && <Loader2 className="w-3 h-3 animate-spin text-purple-500" />}
        <button
          onClick={liveRefresh}
          disabled={liveLoading || !line.mapped_linet_item_id}
          className="mr-auto flex items-center gap-1 text-xs font-medium text-purple-700 hover:text-purple-900 disabled:opacity-40"
          title="שליפה חיה של המלאי מלינט (לסחורה שנקלטה עכשיו)"
        >
          {liveLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {liveLoading ? "שולף מלינט..." : "שליפה חיה מלינט"}
        </button>
      </div>

      {liveAt && !liveLoading && (
        <div className="text-[11px] text-gray-400">
          מלאי חי מלינט · {new Date(liveAt).toLocaleTimeString("he-IL")}
        </div>
      )}

      {/* רשימת סריאליים */}
      {!loading && !error && serials.length > 0 && (
        <div className="space-y-1 max-h-52 overflow-y-auto">
          {serials.map((s) => {
            const isSelected = selected.includes(s.serial);
            const isDisabled = !isSelected && selected.length >= required;
            return (
              <button
                key={s.serial}
                onClick={() => toggleSerial(s.serial)}
                disabled={isDisabled}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-right transition-all border
                  ${isSelected
                    ? "bg-purple-50 border-purple-400 text-purple-800 font-medium"
                    : isDisabled
                    ? "bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed"
                    : "bg-white border-gray-200 hover:border-purple-300 hover:bg-purple-50/50 text-gray-700"
                  }`}
              >
                <span className="font-mono tracking-wide">{s.serial}</span>
                <span className="flex items-center gap-2">
                  {s.created && (
                    <span className="text-xs text-gray-400">{formatDate(s.created)}</span>
                  )}
                  {isSelected && <CheckCircle2 className="w-4 h-4 text-purple-600" />}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* הודעה אם ריק */}
      {!loading && !error && serials.length === 0 && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          לא נמצאו סריאליים זמינים במלאי לפריט זה. יש לבדוק מלאי ב-Linet.
        </div>
      )}

      {/* שדה סריקה/הקלדה ידנית */}
      {selected.length < required && (
        <div className="border-t border-gray-100 pt-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <ScanLine className="w-3.5 h-3.5" />
            <span>סריקה או הקלדה ידנית</span>
          </div>
          <div className="flex gap-2">
            <input
              ref={scanRef}
              type="text"
              value={scanInput}
              onChange={(e) => { setScanInput(e.target.value); setVerifyResult(null); }}
              onKeyDown={handleScanKeyDown}
              placeholder="סרוק או הקלד מספר סידורי"
              disabled={verifying}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent disabled:opacity-50"
              autoComplete="off"
              dir="ltr"
            />
            <button
              onClick={handleVerify}
              disabled={verifying || !scanInput.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              אמת
            </button>
          </div>

          {/* תוצאת אימות */}
          {verifyResult && (
            <div className={`flex items-start gap-1.5 text-xs px-3 py-2 rounded-lg border ${
              verifyResult.ok
                ? "bg-green-50 border-green-200 text-green-800"
                : "bg-red-50 border-red-200 text-red-700"
            }`}>
              {verifyResult.ok
                ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              }
              <span>{verifyResult.message}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}