import React, { useState, useEffect, useCallback } from "react";
import { checkInvoiceGate } from "@/functions/checkInvoiceGate";
import { issueInvoiceWithSerials } from "@/functions/issueInvoiceWithSerials";
import { base44 } from "@/api/base44Client";
import SerialPicker from "./SerialPicker";
import LinkLinetItem from "./LinkLinetItem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ScanLine, CheckCircle2, AlertCircle, Receipt, ChevronDown, ChevronUp, Tag } from "lucide-react";

/**
 * SerialHandlingZone — מוצג בתוך OrderDetailPanel
 * מציג טיפול בפריטים סריאליים + כפתור הנפקת חשבונית (אתר בלבד)
 *
 * Props:
 *   order: unified order object
 *   onInvoiceIssued: callback אחרי הנפקה מוצלחת
 */
export default function SerialHandlingZone({ order, onInvoiceIssued }) {
  const [gateResult, setGateResult] = useState(null); // { blocked, reasons, messages_he }
  const [serialLines, setSerialLines] = useState(null); // null=טעינה, []=ריק
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // הנפקת חשבונית
  const [showConfirm, setShowConfirm] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issueResult, setIssueResult] = useState(null); // { success, doc_number, doc_id, error }

  // סימון ידני
  const [markingProductIdx, setMarkingProductIdx] = useState(null);
  const [markingBusy, setMarkingBusy] = useState(false);

  const orderId = order.raw_id || (order.id?.startsWith("woo_") ? order.id.replace("woo_", "") : order.id);

  // טעינה lazy — רק כשהכרטיס נפתח
  const load = useCallback(async () => {
    if (!orderId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      // שלוף שורות סריאליות
      const [osl, ois] = await Promise.all([
        base44.entities.OrderSerialLine.filter({ order_id: orderId }).catch(() => []),
        base44.entities.OrderItemSerial.filter({ order_id: orderId }).catch(() => []),
      ]);
      const combined = [...osl, ...ois];
      setSerialLines(combined);

      // קרא gate (כדי לדעת אם חסום + מה חסר)
      const res = await checkInvoiceGate({ order_id: orderId });
      setGateResult(res?.data ?? res);
    } catch (e) {
      setError(e.message);
      setSerialLines([]);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  const refresh = () => load();

  // עדכון שורה לאחר SerialPicker/LinkLinetItem
  const handleLineUpdated = (lineId, updates) => {
    setSerialLines(prev => (prev || []).map(l => l.id === lineId ? { ...l, ...updates } : l));
    // רענן gate
    checkInvoiceGate({ order_id: orderId }).then(res => setGateResult(res?.data ?? res)).catch(() => {});
  };

  // ═══ סימון ידני כסריאלי ═══
  const handleMarkAsSerial = async (product) => {
    const confirmMsg = `האם לסמן את "${product.name}" כפריט סריאלי?\n\nפעולה זו תחול גם על הזמנות עתידיות עם מק"ט ${product.sku || product.product_id}.`;
    if (!window.confirm(confirmMsg)) return;

    setMarkingProductIdx(product.sku || product.product_id);
    setMarkingBusy(true);
    try {
      const sku = product.sku || String(product.product_id || "");
      if (!sku) throw new Error("אין מק\"ט לסימון");

      // עדכן/צור LinetProductMap
      const maps = await base44.entities.LinetProductMap.filter({ sku }).catch(() => []);
      if (maps.length > 0) {
        await base44.entities.LinetProductMap.update(maps[0].id, {
          requires_serial: true,
          linet_stock_type: 2,
          manual_override: true,
          serial_source: "manual_serial",
          updated_at: new Date().toISOString(),
        });
      } else {
        await base44.entities.LinetProductMap.create({
          sku,
          requires_serial: true,
          linet_stock_type: 2,
          manual_override: true,
          serial_source: "manual_serial",
          linet_item_name: product.name || "",
          updated_at: new Date().toISOString(),
        });
      }

      // צור/עדכן שורת OrderSerialLine להזמנה הזו
      const itemId = `${orderId}_${sku}`;
      const existing = (serialLines || []).find(l => l.source_sku === sku || l.order_item_id === itemId);
      if (!existing) {
        const newLine = await base44.entities.OrderSerialLine.create({
          order_id: orderId,
          order_item_id: itemId,
          source: order.source === "mirakl" ? "superpharm" : "woo",
          source_sku: sku,
          source_product_name: product.name || "",
          requires_serial: true,
          serials_required_count: product.quantity || 1,
          serial_status: "required_missing",
          assigned_serials: [],
        });
        setSerialLines(prev => [...(prev || []), newLine]);
      }

      await refresh();
    } catch (e) {
      alert("שגיאה בסימון: " + e.message);
    } finally {
      setMarkingBusy(false);
      setMarkingProductIdx(null);
    }
  };

  // ═══ הנפקת חשבונית ═══
  const handleIssue = async () => {
    setIssuing(true);
    setIssueResult(null);
    try {
      const res = await issueInvoiceWithSerials({ order_id: orderId, apply: true });
      const data = res?.data ?? res;
      if (data?.issued) {
        setIssueResult({ success: true, doc_number: data.linet_document_number, doc_id: data.linet_invoice_id });
        setShowConfirm(false);
        if (onInvoiceIssued) onInvoiceIssued(data);
        refresh();
      } else if (data?.already_invoiced) {
        setIssueResult({ success: true, doc_number: data.existing_invoice_id, already: true });
        setShowConfirm(false);
      } else {
        setIssueResult({ success: false, error: (data?.messages_he || []).join(" / ") || data?.error || "שגיאה לא ידועה" });
      }
    } catch (e) {
      setIssueResult({ success: false, error: e.message });
    } finally {
      setIssuing(false);
    }
  };

  // ═══ תנאי תצוגה ═══
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
        <Loader2 className="w-3 h-3 animate-spin" /> בודק פריטים סריאליים...
      </div>
    );
  }

  if (error) return null; // שגיאה שקטה — לא מפריעים לזרימה

  // אין שורות סריאליות בכלל — בדוק אם LinetProductMap מסמן מישהו כסריאלי
  const hasSerialLines = (serialLines || []).some(l => l.requires_serial);

  // מוצרים שאינם מסומנים כסריאליים (לכפתור "סמן ידנית")
  const serialSkus = new Set((serialLines || []).filter(l => l.requires_serial).map(l => l.source_sku).filter(Boolean));
  const nonSerialProducts = (order.products || []).filter(p => {
    const sku = p.sku || String(p.product_id || "");
    return sku && !serialSkus.has(sku);
  });

  if (!hasSerialLines && nonSerialProducts.length === 0) return null;

  const gateBlocked = gateResult?.blocked ?? true;
  const gateMessages = gateResult?.messages_he || [];
  const serialLinesRequired = (serialLines || []).filter(l => l.requires_serial);
  const allReady = serialLinesRequired.length > 0 && serialLinesRequired.every(
    l => ["selected", "verified", "invoiced"].includes(l.serial_status) &&
      (l.assigned_serials?.length || 0) >= (l.serials_required_count || 1)
  );
  const isWoocommerce = order.source === "woocommerce";
  const alreadyInvoiced = serialLinesRequired.some(l => l.serial_status === "invoiced" || l.linet_invoice_id);

  return (
    <div dir="rtl" className="rounded-2xl border-2 border-amber-200 bg-amber-50/60 p-4 space-y-4">
      {/* כותרת */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center flex-shrink-0">
            <ScanLine className="w-4 h-4 text-amber-700" />
          </div>
          <div>
            <div className="font-bold text-amber-900 text-sm">טיפול בפריט סריאלי</div>
            <div className="text-xs text-amber-700">
              {alreadyInvoiced ? "הושלם — חשבונית הופקה" : allReady ? "מוכן להנפקה" : "נדרשת פעולה"}
            </div>
          </div>
        </div>
        {allReady && !alreadyInvoiced && (
          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs">מוכן ✓</Badge>
        )}
        {!allReady && !alreadyInvoiced && (
          <Badge className="bg-orange-100 text-orange-800 border-orange-200 text-xs">דורש פעולה</Badge>
        )}
        {alreadyInvoiced && (
          <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">הושלם ✓</Badge>
        )}
      </div>

      {/* שורות סריאליות */}
      {serialLinesRequired.length > 0 && (
        <div className="space-y-3">
          {serialLinesRequired.map(line => {
            const isInvoiced = line.serial_status === "invoiced" || line.linet_invoice_id;
            const hasMapping = !!line.mapped_linet_item_id;
            const assigned = line.assigned_serials || [];
            const required = line.serials_required_count || 1;
            const isReady = assigned.length >= required && ["selected", "verified", "invoiced"].includes(line.serial_status);

            if (isInvoiced) {
              return (
                <div key={line.id} className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-green-800">{line.source_product_name || line.order_item_id}</div>
                    <div className="text-xs text-green-700 font-mono">{assigned.join(", ")}</div>
                  </div>
                  <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px]">הופקה ✓</Badge>
                </div>
              );
            }

            if (!hasMapping) {
              return (
                <LinkLinetItem
                  key={line.id}
                  line={line}
                  onLinked={(updates) => handleLineUpdated(line.id, updates)}
                />
              );
            }

            return (
              <SerialPicker
                key={line.id}
                line={line}
                onUpdated={(updated) => handleLineUpdated(line.id, updated)}
              />
            );
          })}
        </div>
      )}

      {/* כפתור הנפקת חשבונית — אתר בלבד */}
      {isWoocommerce && hasSerialLines && !alreadyInvoiced && (
        <div className="border-t border-amber-200 pt-3 space-y-2">
          {issueResult?.success && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 text-green-800 text-sm">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              חשבונית {issueResult.doc_number || issueResult.doc_id} הופקה בהצלחה ✓
            </div>
          )}
          {issueResult?.success === false && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-red-800 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{issueResult.error}</span>
            </div>
          )}

          {!issueResult?.success && !showConfirm && (
            <Button
              className={`w-full rounded-xl font-semibold ${
                gateBlocked
                  ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                  : "bg-[#7D0F82] hover:bg-[#6a0c6f] text-white"
              }`}
              disabled={gateBlocked}
              onClick={() => !gateBlocked && setShowConfirm(true)}
            >
              <Receipt className="w-4 h-4 ml-2" />
              הנפק חשבונית מס-קבלה
            </Button>
          )}

          {gateBlocked && !issueResult?.success && gateMessages.length > 0 && (
            <div className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 space-y-0.5">
              {gateMessages.map((m, i) => <div key={i}>• {m}</div>)}
            </div>
          )}

          {/* דיאלוג אישור */}
          {showConfirm && (
            <div className="bg-white border-2 border-[#7D0F82]/30 rounded-2xl p-4 space-y-3 shadow-lg">
              <div className="font-bold text-gray-900 text-sm flex items-center gap-2">
                <Receipt className="w-4 h-4 text-[#7D0F82]" />
                אישור הנפקת חשבונית מס-קבלה
              </div>

              {/* פרטי תצוגה מקדימה */}
              <div className="bg-slate-50 rounded-xl p-3 text-xs space-y-1.5 border border-slate-200">
                <div className="flex justify-between">
                  <span className="text-gray-500">לקוח:</span>
                  <span className="font-medium">{order.customer_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">הזמנה:</span>
                  <span className="font-mono">#{order.order_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">סכום:</span>
                  <span className="font-bold">₪{(order.total || 0).toLocaleString()}</span>
                </div>
                <div className="border-t border-slate-200 pt-1.5">
                  <div className="text-gray-500 mb-1">פריטים סריאליים:</div>
                  {serialLinesRequired.map(l => (
                    <div key={l.id} className="flex items-start gap-1.5">
                      <span className="text-purple-600">•</span>
                      <span>{l.source_product_name}</span>
                      {l.assigned_serials?.length > 0 && (
                        <span className="font-mono text-purple-700 mr-1">[{l.assigned_serials.join(", ")}]</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                ⚠️ מפיק מסמך מס — לא ניתן לבטל אוטומטית לאחר ההנפקה.
              </div>

              <div className="flex gap-2">
                <Button
                  className="flex-1 bg-[#7D0F82] hover:bg-[#6a0c6f] text-white rounded-xl font-semibold"
                  onClick={handleIssue}
                  disabled={issuing}
                >
                  {issuing ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Receipt className="w-4 h-4 ml-2" />}
                  {issuing ? "מנפיק..." : "אשר והנפק"}
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl border-gray-300"
                  onClick={() => setShowConfirm(false)}
                  disabled={issuing}
                >
                  ביטול
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* סימון ידני — מוצרים לא-סריאליים */}
      {nonSerialProducts.length > 0 && !alreadyInvoiced && (
        <div className="border-t border-amber-200 pt-3">
          <div className="text-xs text-gray-500 mb-2">מוצרים שלא זוהו כסריאליים — סמן אם נדרש מ"ס:</div>
          <div className="space-y-1.5">
            {nonSerialProducts.map((p) => {
              const sku = p.sku || String(p.product_id || "");
              const isBusy = markingBusy && markingProductIdx === sku;
              return (
                <div key={sku} className="flex items-center justify-between gap-2 bg-white rounded-xl border border-gray-200 px-3 py-2">
                  <div className="text-sm text-gray-700 truncate">{p.name}</div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 rounded-lg border-amber-300 text-amber-700 hover:bg-amber-50 flex-shrink-0"
                    disabled={isBusy}
                    onClick={() => handleMarkAsSerial(p)}
                  >
                    {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Tag className="w-3 h-3 ml-1" />}
                    סמן כסריאלי
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}