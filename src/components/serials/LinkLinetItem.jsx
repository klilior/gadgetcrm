import React, { useState, useRef } from "react";
import { resolveSerialToItem } from "@/functions/resolveSerialToItem";
import { searchLinetItemsByName } from "@/functions/searchLinetItemsByName";
import { linkOrderLineToLinetItem } from "@/functions/linkOrderLineToLinetItem";
import { ScanLine, Search, CheckCircle2, AlertCircle, Loader2, Link2 } from "lucide-react";

/**
 * LinkLinetItem — מוצג כשאין mapped_linet_item_id לשורת הזמנה
 * Props:
 *   line: OrderSerialLine record
 *   onLinked: callback(updatedData) — נקרא אחרי שמירת שיוך מוצלח
 */
export default function LinkLinetItem({ line, onLinked }) {
  // --- סריקה ראשית ---
  const [scanInput, setScanInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null); // { found, item, serial, error }
  const scanRef = useRef(null);

  // --- חיפוש לפי שם ---
  const [nameQuery, setNameQuery] = useState(line?.source_product_name ?? "");
  const [searching, setSearching] = useState(false);
  const [searchMatches, setSearchMatches] = useState(null); // array | null
  const [searchError, setSearchError] = useState(null);
  const [pendingItem, setPendingItem] = useState(null); // פריט ממתין לאישור

  // --- שמירה ---
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // === סריקה ===
  const handleScan = async () => {
    const trimmed = scanInput.trim();
    if (!trimmed) return;
    setScanning(true);
    setScanResult(null);
    try {
      const res = await resolveSerialToItem({ serial: trimmed });
      const data = res?.data ?? res;
      if (data?.found) {
        setScanResult({ found: true, item: data, serial: trimmed });
      } else {
        setScanResult({ found: false, serial: trimmed });
      }
    } catch (e) {
      setScanResult({ found: false, error: e.message, serial: trimmed });
    } finally {
      setScanning(false);
    }
  };

  const handleScanKeyDown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); handleScan(); }
  };

  // שיוך מסריקה — פריט + סריאלי בלחיצה אחת
  const handleLinkFromScan = async () => {
    if (!scanResult?.found || !scanResult.item) return;
    const { item, serial } = scanResult;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await linkOrderLineToLinetItem({
        line_id: line.id,
        linet_item_id: item.linet_item_id,
        linet_item_name: item.linet_item_name,
        linet_sku: item.linet_sku,
        also_assign_serial: serial,
      });
      const data = res?.data ?? res;
      if (data?.ok && onLinked) {
        onLinked({
          mapped_linet_item_id: item.linet_item_id,
          mapped_linet_item_name: item.linet_item_name,
          mapped_linet_sku: item.linet_sku,
          assigned_serials: data.assigned_serials,
          serial_status: data.serial_status,
        });
      }
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // === חיפוש לפי שם ===
  const handleSearch = async () => {
    if (!nameQuery.trim()) return;
    setSearching(true);
    setSearchMatches(null);
    setSearchError(null);
    setPendingItem(null);
    try {
      const res = await searchLinetItemsByName({ name: nameQuery.trim() });
      const data = res?.data ?? res;
      setSearchMatches(Array.isArray(data?.matches) ? data.matches : []);
      if (data?.error) setSearchError(data.error);
    } catch (e) {
      setSearchError(e.message);
      setSearchMatches([]);
    } finally {
      setSearching(false);
    }
  };

  // שיוך מחיפוש — רק אחרי אישור מפורש
  const handleLinkFromSearch = async () => {
    if (!pendingItem) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await linkOrderLineToLinetItem({
        line_id: line.id,
        linet_item_id: pendingItem.linet_item_id,
        linet_item_name: pendingItem.linet_item_name,
        linet_sku: pendingItem.linet_sku,
      });
      const data = res?.data ?? res;
      if (data?.ok && onLinked) {
        onLinked({
          mapped_linet_item_id: pendingItem.linet_item_id,
          mapped_linet_item_name: pendingItem.linet_item_name,
          mapped_linet_sku: pendingItem.linet_sku,
          assigned_serials: data.assigned_serials,
          serial_status: data.serial_status,
        });
      }
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div dir="rtl" className="border border-amber-300 rounded-xl bg-amber-50 p-4 space-y-4">
      {/* כותרת */}
      <div className="flex items-center gap-2">
        <Link2 className="w-4 h-4 text-amber-600 flex-shrink-0" />
        <div>
          <div className="font-semibold text-amber-900 text-sm">שיוך לפריט Linet</div>
          <div className="text-xs text-amber-700">{line.source_product_name}</div>
        </div>
      </div>

      {/* ===== סריקה ראשית ===== */}
      <div className="bg-white rounded-lg border border-amber-200 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          <ScanLine className="w-4 h-4 text-purple-600" />
          סרוק מספר סידורי לזיהוי הפריט
        </div>
        <div className="text-xs text-gray-500">הדרך הוודאית — הפריט יזוהה אוטומטית מהסריאלי</div>

        <div className="flex gap-2">
          <input
            ref={scanRef}
            type="text"
            value={scanInput}
            onChange={(e) => { setScanInput(e.target.value); setScanResult(null); }}
            onKeyDown={handleScanKeyDown}
            placeholder="סרוק ברקוד או הקלד מספר סידורי"
            disabled={scanning || saving}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-400 disabled:opacity-50"
            autoComplete="off"
            dir="ltr"
          />
          <button
            onClick={handleScan}
            disabled={scanning || !scanInput.trim() || saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 transition-colors flex items-center gap-1.5"
          >
            {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5" />}
            זהה
          </button>
        </div>

        {/* תוצאת סריקה */}
        {scanResult && (
          <div className={`rounded-lg border px-3 py-2 text-sm space-y-2 ${
            scanResult.found ? "bg-green-50 border-green-300" : "bg-red-50 border-red-200"
          }`}>
            {scanResult.found ? (
              <>
                <div className="flex items-start gap-1.5 text-green-800">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-green-600" />
                  <div>
                    <div className="font-semibold">{scanResult.item.linet_item_name}</div>
                    <div className="text-xs text-green-700 font-mono">
                      item_id: {scanResult.item.linet_item_id}
                      {scanResult.item.linet_sku && ` · מק"ט: ${scanResult.item.linet_sku}`}
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleLinkFromScan}
                  disabled={saving}
                  className="w-full py-2 rounded-lg text-sm font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                  שייך פריט זה (+ הוסף סריאלי)
                </button>
              </>
            ) : (
              <div className="flex items-center gap-1.5 text-red-700">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                הסריאלי לא נמצא במלאי. נסה חיפוש לפי שם למטה.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===== חיפוש לפי שם (גיבוי) ===== */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
          <Search className="w-3.5 h-3.5" />
          חיפוש לפי שם (גיבוי)
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={nameQuery}
            onChange={(e) => { setNameQuery(e.target.value); setSearchMatches(null); setPendingItem(null); }}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="שם מוצר לחיפוש..."
            disabled={searching || saving}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
            dir="rtl"
          />
          <button
            onClick={handleSearch}
            disabled={searching || !nameQuery.trim() || saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 transition-colors flex items-center gap-1.5"
          >
            {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            חפש
          </button>
        </div>

        {searchError && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{searchError}</div>
        )}

        {/* רשימת התאמות */}
        {searchMatches !== null && (
          <div className="space-y-1">
            {searchMatches.length === 0 ? (
              <div className="text-xs text-gray-500 px-2">לא נמצאו התאמות</div>
            ) : (
              searchMatches.map((item) => (
                <button
                  key={item.linet_item_id}
                  onClick={() => setPendingItem(item)}
                  disabled={saving}
                  className={`w-full text-right flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-all ${
                    pendingItem?.linet_item_id === item.linet_item_id
                      ? "bg-amber-100 border-amber-400 text-amber-900"
                      : "bg-white border-gray-200 hover:border-amber-300 hover:bg-amber-50 text-gray-700"
                  }`}
                >
                  <div>
                    <div className="font-medium">{item.linet_item_name}</div>
                    <div className="text-xs text-gray-500 font-mono">
                      {item.linet_sku && `מק"ט: ${item.linet_sku} · `}item_id: {item.linet_item_id}
                    </div>
                  </div>
                  {item.stock_type === 2 && (
                    <span className="text-xs bg-purple-100 text-purple-700 border border-purple-200 rounded-full px-2 py-0.5 whitespace-nowrap mr-2">
                      סריאלי
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        )}

        {/* אישור שיוך מחיפוש */}
        {pendingItem && (
          <div className="bg-amber-100 border border-amber-400 rounded-lg p-3 space-y-2">
            <div className="text-sm font-semibold text-amber-900">
              לשייך את "{pendingItem.linet_item_name}" לשורה זו?
            </div>
            <div className="text-xs text-amber-700">שיוך לפי חיפוש שם — ודא שזה הפריט הנכון לפני האישור.</div>
            <div className="flex gap-2">
              <button
                onClick={handleLinkFromSearch}
                disabled={saving}
                className="flex-1 py-2 rounded-lg text-sm font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                אשר שיוך
              </button>
              <button
                onClick={() => setPendingItem(null)}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                ביטול
              </button>
            </div>
          </div>
        )}
      </div>

      {/* שגיאת שמירה */}
      {saveError && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {saveError}
        </div>
      )}
    </div>
  );
}