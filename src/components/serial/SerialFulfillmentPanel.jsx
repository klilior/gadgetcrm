import React, { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Receipt, ShieldCheck, AlertTriangle, Package2, FlaskConical } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { serialFulfillment } from "@/functions/serialFulfillment";
import { serialInvoice } from "@/functions/serialInvoice";
import { toast } from "sonner";
import LinetItemMapper from "./LinetItemMapper";
import SerialPicker from "./SerialPicker";
import MarkSerialMenu from "./MarkSerialMenu";

const STATUS_META = {
  not_required: { label: "לא נדרש סריאלי", cls: "bg-gray-100 text-gray-600" },
  required_missing: { label: "חסר סריאלי", cls: "bg-red-50 text-red-700 border border-red-100" },
  selected: { label: "סריאלי נבחר", cls: "bg-amber-50 text-amber-700 border border-amber-100" },
  verified: { label: "סריאלי אומת", cls: "bg-emerald-50 text-emerald-700 border border-emerald-100" },
  invoiced: { label: "חשבונית הופקה", cls: "bg-[#7D0F82] text-white" },
};

/**
 * Step 12 — the agent's serial handling area for one order.
 * Renders one card per serial-required product line: Linet mapping + serial picker + status.
 * Issuing is DRY-RUN by default (pilot safety).
 */
export default function SerialFulfillmentPanel({ order, onBlockChange }) {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const orderId = order.id || order.order_number || order.external_order_number;

  // Build/refresh OrderItemSerial lines for this order based on its products.
  const init = useCallback(async () => {
    setLoading(true);
    try {
      const existing = await base44.entities.OrderItemSerial.filter({ order_id: String(orderId) });
      // Keep the OLDEST record per item key. Concurrent panel mounts used to each
      // create a line for the same key, leaving duplicate rows whose newer copies
      // get cleaned up — leaving stale ids that 404 on later get/update. Always
      // bind to the earliest-created row so the id we hold stays valid.
      const byItemKey = {};
      existing
        .slice()
        .sort((a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0))
        .forEach((l) => { if (!byItemKey[l.order_item_id]) byItemKey[l.order_item_id] = l; });

      const products = order.products || [];
      const built = [];
      for (let i = 0; i < products.length; i++) {
        const p = products[i];
        const itemKey = `${orderId}__${p.sku || i}`;
        let line = byItemKey[itemKey];

        if (!line) {
          // Resolve serial requirement once and create the line
          let requires = false, mappedId = "", mappedSku = "", mappedName = "";
          if (p.sku) {
            try {
              const { data } = await serialFulfillment({ action: "resolveSerial", params: { sku: p.sku } });
              if (data?.success) {
                requires = !!data.requires_serial;
                mappedId = data.mapping?.linet_item_id || "";
                mappedSku = data.mapping?.linet_sku || "";
                mappedName = data.mapping?.linet_item_name || "";
              }
            } catch (_) {}
          }
          try {
            line = await base44.entities.OrderItemSerial.create({
              order_id: String(orderId),
              external_order_number: order.external_order_number || order.order_number || "",
              order_item_id: itemKey,
              source: order.source === "mirakl" ? "superpharm" : (order.source === "woo" ? "woo" : "manual"),
              source_sku: p.sku || "",
              source_product_name: p.name || "",
              mapped_linet_item_id: mappedId,
              mapped_linet_sku: mappedSku,
              mapped_linet_item_name: mappedName,
              quantity: p.quantity || 1,
              requires_serial: requires,
              serials_required_count: requires ? (p.quantity || 1) : 0,
              assigned_serials: [],
              serial_status: requires ? "required_missing" : "not_required",
            });
          } catch (_) {
            // A concurrent create may have already inserted this line — re-fetch it.
            const again = await base44.entities.OrderItemSerial.filter({ order_id: String(orderId), order_item_id: itemKey }).catch(() => []);
            line = again?.[0] || null;
          }
        }
        if (line) built.push(line);
      }
      // Show ALL product lines so the agent can manually mark items as serial
      // even when Linet didn't auto-detect them (e.g. missing/mismatched SKU).
      setLines(built);
    } catch (e) {
      toast.error("שגיאה בטעינת טיפול סריאלי: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [orderId, order]);

  useEffect(() => { init(); }, [init]);

  // Report blocking state to parent: blocked while any serial-required line isn't verified/invoiced.
  const serialLines = lines.filter((l) => l.requires_serial);
  const hasSerialLines = serialLines.length > 0;
  const allLinesReady = serialLines.every(
    (l) => l.mapped_linet_item_id &&
      (l.assigned_serials || []).length >= (l.serials_required_count || 1) &&
      (l.serial_status === "verified" || l.serial_status === "invoiced")
  );
  useEffect(() => {
    if (!onBlockChange) return;
    onBlockChange(loading ? false : (hasSerialLines && !allLinesReady));
  }, [loading, hasSerialLines, allLinesReady, onBlockChange]);

  const refreshLine = async (lineId) => {
    try {
      const fresh = await base44.entities.OrderItemSerial.get(lineId);
      setLines((prev) => prev.map((l) => (l.id === lineId ? fresh : l)));
    } catch (_) {
      // Record may have been removed/replaced — re-init the panel instead of crashing on a 404.
      init();
    }
  };

  const onMapped = async (line, item) => {
    try {
      await base44.entities.OrderItemSerial.update(line.id, {
        mapped_linet_item_id: String(item.id),
        mapped_linet_sku: item.sku,
        mapped_linet_item_name: item.name,
      });
      await base44.entities.SerialAuditLog.create({
        order_id: String(orderId), order_item_id: line.order_item_id, sku: line.source_sku,
        linet_item_id: String(item.id), action: "map_linet_item", new_value: item.name, result: "success",
      });
      toast.success("הפריט מופה ללינט");
      refreshLine(line.id);
    } catch (e) {
      // Line record may have been replaced — rebuild the panel instead of throwing a 404.
      toast.error("שגיאה במיפוי הפריט, מרענן...");
      init();
    }
  };

  const onSerialsChange = async (line, serials) => {
    try {
      const { data } = await serialInvoice({ action: "reserveSerials", params: { order_item_id: line.order_item_id, serials } });
      if (!data?.success) { toast.error(data?.error || "שגיאה בשמירת סריאליים"); return; }
      refreshLine(line.id);
    } catch (e) {
      toast.error("שגיאה בשמירת סריאליים: " + (e?.message || ""));
    }
  };

  const issueInvoiceDryRun = async () => {
    setIssuing(true);
    try {
      const { data } = await serialInvoice({ action: "issueInvoice", params: { order_id: String(orderId), dry_run: true } });
      if (data?.blocked) { toast.error(data.error); return; }
      if (data?.already_invoiced) { toast.info(data.message); return; }
      if (data?.dry_run) {
        toast.success("בדיקה עברה: ניתן להנפיק חשבונית (מצב dry-run, לא הופקה חשבונית אמיתית)");
      }
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    } finally {
      setIssuing(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-purple-100 p-4 flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin text-[#7D0F82]" /> בודק דרישת סריאלי...
      </div>
    );
  }

  if (lines.length === 0) return null;

  const allReady = allLinesReady;

  return (
    <div className="bg-white rounded-2xl border-2 border-purple-100 p-4 space-y-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h4 className="font-bold text-[#7D0F82] flex items-center gap-2">
          <Package2 className="w-5 h-5" /> טיפול סריאלי
        </h4>
        {hasSerialLines && (
          <Badge className="bg-amber-50 text-amber-700 border border-amber-200 gap-1">
            <FlaskConical className="w-3 h-3" /> מצב בדיקה
          </Badge>
        )}
      </div>

      {lines.map((line) => {
        const meta = STATUS_META[line.serial_status] || STATUS_META.not_required;
        const need = line.serials_required_count || line.quantity || 1;
        return (
          <div key={line.id} className="border border-gray-100 rounded-xl p-3 space-y-3 bg-slate-50/50">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-gray-800 text-sm break-words">{line.source_product_name}</p>
                <p className="text-[11px] text-gray-400 font-mono">מק"ט מקור: {line.source_sku || "—"} · כמות: {line.quantity}</p>
                {line.mapped_linet_item_name && (
                  <p className="text-[11px] text-emerald-700 mt-0.5">פריט לינט: {line.mapped_linet_item_name}</p>
                )}
              </div>
              <Badge className={`${meta.cls} text-[11px] shadow-none flex-shrink-0`}>{meta.label}</Badge>
            </div>

            {/* Manual mark/unmark — always available so agents can fix mis-detected items */}
            <div className="flex justify-end">
              <MarkSerialMenu
                sku={line.source_sku}
                orderItemId={line.order_item_id}
                currentlySerial={line.requires_serial}
                onChanged={(scope) => scope === "always" ? init() : refreshLine(line.id)}
              />
            </div>

            {/* Mapping + serial picker only for serial-required lines */}
            {line.requires_serial && (
              <>
                {!line.mapped_linet_item_id && (
                  <div className="bg-red-50 border border-red-100 rounded-lg p-2 space-y-2">
                    <p className="text-xs text-red-700 font-medium flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> חסר מיפוי לפריט Linet. בחר פריט לפני הנפקת חשבונית.
                    </p>
                    <LinetItemMapper currentMappedId={line.mapped_linet_item_id} onMapped={(item) => onMapped(line, item)} />
                  </div>
                )}

                {line.mapped_linet_item_id && (
                  <SerialPicker
                    linetItemId={line.mapped_linet_item_id}
                    requiredCount={need}
                    value={line.assigned_serials || []}
                    onChange={(serials) => onSerialsChange(line, serials)}
                  />
                )}
              </>
            )}
          </div>
        );
      })}

      {/* Primary action (Step 10) — dry-run — only when there are serial lines */}
      {hasSerialLines && (
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          <Button
            disabled={!allReady || issuing}
            onClick={issueInvoiceDryRun}
            className="bg-[#7D0F82] hover:bg-[#6a0c6f] text-white rounded-xl"
          >
            {issuing ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Receipt className="w-4 h-4 ml-1" />}
            הנפק חשבונית עם סריאלי
          </Button>
          {allReady ? (
            <span className="text-xs text-emerald-700 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> מוכן לבדיקה</span>
          ) : (
            <span className="text-xs text-gray-400">השלם מיפוי ובחירת סריאלי כדי להמשיך</span>
          )}
        </div>
      )}
    </div>
  );
}