import React, { useState, useEffect, useCallback } from "react";
import { getAvailableSerials } from "@/functions/getAvailableSerials";
import { updateOrderSerialLine } from "@/functions/updateOrderSerialLine";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertCircle, PackageSearch } from "lucide-react";

/**
 * SerialPicker — מסך נציג לבחירת סריאליים
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
      const res = await getAvailableSerials({ linet_item_id: line.mapped_linet_item_id });
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

  useEffect(() => {
    loadSerials();
  }, [loadSerials]);

  // לא מציג כלום אם לא נדרש סריאלי — אחרי כל ה-hooks
  if (skip) return null;

  // בחירה/ביטול בחירה
  const toggleSerial = async (serial) => {
    let next;
    if (selected.includes(serial)) {
      next = selected.filter((s) => s !== serial);
    } else {
      if (selected.length >= required) return; // לא ניתן לבחור יותר מהנדרש
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
        {saving && <Loader2 className="w-3 h-3 animate-spin text-purple-500 mr-auto" />}
      </div>

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
    </div>
  );
}