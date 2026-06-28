import React, { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Receipt, ShieldCheck, AlertTriangle, Package2, FlaskConical } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { serialFulfillment } from "@/functions/serialFulfillment";
import { toast } from "sonner";
import LinetItemMapper from "./LinetItemMapper";
import SerialPicker from "./SerialPicker";
import MarkSerialMenu from "./MarkSerialMenu";

const STATUS_META = {
  not_required: { label: "לא נדרש סריאלי", cls: "bg-gray-100 text-gray-600" },
  required_missing: { label: "חסר סריאלי", cls: "bg-red-50 text-red-700 border border-red-100" },
  selected: { label: "סריאלי נבחר", cls: "bg-amber-50 text-amber-700" },
  verified: { label: "סריאלי אומת", cls: "bg-emerald-50 text-emerald-700" },
  invoiced: { label: "חשבונית הופקה", cls: "bg-[#7D0F82] text-white" },
};

export default function SerialFulfillmentPanel({ order, onBlockChange }) {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const orderId = String(order.id || order.order_number || order.external_order_number || "");

  const init = useCallback(async () => {
    if (!orderId) { setLoading(false); return; }
    setLoading(true);
    try {
      const existing = (await base44.entities.OrderItemSerial.filter({ order_id: orderId }).catch(() => []));
      const byKey = {};
      for (const l of existing) { if (l.order_item_id && !byKey[l.order_item_id]) byKey[l.order_item_id] = l; }
      const products = order.products || [];
      const built = [];
      for (let i = 0; i < products.length; i++) {
        const p = products[i];
        const key = `${orderId}__${p.sku || i}`;
        let line = byKey[key];
        if (!line) {
          let requires = false, mappedId = "", mappedSku = "", mappedName = "";
          if (p.sku) {
            const { data } = await serialFulfillment({ action: "resolveSerial", params: { sku: p.sku } }).catch(() => ({ data: null }));
            if (data?.success) {
              requires = !!data.requires_serial;
              if (data.mapping) { mappedId = data.mapping.linet_item_id || ""; mappedSku = data.mapping.linet_sku || ""; mappedName = data.mapping.linet_item_name || ""; }
            }
          }
          try {
            line = await base44.entities.OrderItemSerial.create({
              order_id: orderId, external_order_number: order.order_number || "",
              order_item_id: key, source: order.source === "mirakl" ? "superpharm" : (order.source === "woocommerce" ? "woo" : "manual"),
              source_sku: p.sku || "", source_product_name: p.name || "",
              mapped_linet_item_id: mappedId, mapped_linet_sku: mappedSku, mapped_linet_item_name: mappedName,
              quantity: p.quantity || 1, requires_serial: requires, serials_required_count: requires ? (p.quantity || 1) : 0,
              assigned_serials: [], serial_status: requires ? "required_missing" : "not_required",
            });
          } catch (_) {
            line = (await base44.entities.OrderItemSerial.filter({ order_id: orderId }).catch(() => []))?.[0] || null;
          }
        }
        if (line) built.push(line);
      }
      setLines(built);
    } catch (e) {
      toast.error("שגיאת טעינה: " + e.message);
    } finally { setLoading(false); }
  }, [orderId, order]);

  useEffect(() => { init(); }, [init]);

  const serialLines = lines.filter((l) => l.requires_serial);
  const hasSerial = serialLines.length > 0;
  const allReady = serialLines.every((l) => l.mapped_linet_item_id && (l.assigned_serials || []).length >= (l.serials_required_count || 1) && (l.serial_status === "verified" || l.serial_status === "invoiced"));

  useEffect(() => {
    onBlockChange?.(loading ? false : (hasSerial && !allReady));
  }, [loading, hasSerial, allReady, onBlockChange]);

  const refreshLine = (lineId) => {
    base44.entities.OrderItemSerial.get(lineId).then((fresh) => setLines((prev) => prev.map((l) => (l.id === lineId ? fresh : l)))).catch(() => init());
  };

  const onMapped = async (line, item) => {
    try {
      await base44.entities.OrderItemSerial.update(line.id, { mapped_linet_item_id: String(item.id), mapped_linet_sku: item.sku, mapped_linet_item_name: item.name });
      toast.success("הפריט מופה ללינט");
      refreshLine(line.id);
    } catch (e) {
      init();
    }
  };

  const onSerialsChange = async (line, serials) => {
    const need = line.serials_required_count || line.quantity || 1;
    const status = serials.length >= need ? "verified" : "selected";
    try {
      await base44.entities.OrderItemSerial.update(line.id, {
        assigned_serials: serials, serial_status: status,
        serial_verified_at: status === "verified" ? new Date().toISOString() : null,
      });
      base44.entities.SerialAuditLog.create({
        order_id: orderId, order_item_id: line.order_item_id, sku: line.source_sku, serial: serials.join(","), action: "select_serial", new_value: status, result: "success",
      }).catch(() => {});
      refreshLine(line.id);
    } catch (e) { if (String(e?.status || e?.response?.status) === "404") init(); else toast.error("שגיאה: " + e.message); }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-purple-100 p-4 flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin text-[#7D0F82]" /> בודק דרישת סריאלי...
      </div>
    );
  }
  if (!lines.length) return null;

  return (
    <div className="bg-white rounded-2xl border-2 border-purple-100 p-4 space-y-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h4 className="font-bold text-[#7D0F82] flex items-center gap-2"><Package2 className="w-5 h-5" /> טיפול סריאלי</h4>
        {hasSerial && <Badge className="bg-amber-50 text-amber-700 border border-amber-200 text-[11px]"><FlaskConical className="w-3 h-3 ml-1" /> מצב בדיקה</Badge>}
      </div>

      {lines.map((line) => {
        const meta = STATUS_META[line.serial_status] || STATUS_META.not_required;
        const need = line.serials_required_count || line.quantity || 1;
        return (
          <div key={line.id} className="border border-gray-100 rounded-xl p-3 space-y-3 bg-slate-50/50">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-gray-800 text-sm break-words">{line.source_product_name}</p>
                <p className="text-[11px] text-gray-400 font-mono">מק"ט: {line.source_sku || "—"} · כמות: {line.quantity}</p>
                {line.mapped_linet_item_name && <p className="text-[11px] text-emerald-700 mt-0.5">לינט: {line.mapped_linet_item_name}</p>}
              </div>
              <Badge className={`${meta.cls} text-[11px] flex-shrink-0`}>{meta.label}</Badge>
            </div>

            <div className="flex justify-end">
              <MarkSerialMenu sku={line.source_sku} orderItemId={line.order_item_id} currentlySerial={line.requires_serial} onChanged={(scope) => scope === "always" ? init() : refreshLine(line.id)} />
            </div>

            {line.requires_serial && (
              <>
                {!line.mapped_linet_item_id && (
                  <div className="bg-red-50 border border-red-100 rounded-lg p-2 space-y-2">
                    <p className="text-xs text-red-700 font-medium flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> חסר מיפוי Linet</p>
                    <LinetItemMapper currentMappedId={line.mapped_linet_item_id} onMapped={(item) => onMapped(line, item)} />
                  </div>
                )}
                {line.mapped_linet_item_id && (
                  <SerialPicker linetItemId={line.mapped_linet_item_id} requiredCount={need} value={line.assigned_serials || []} onChange={(serials) => onSerialsChange(line, serials)} />
                )}
              </>
            )}
          </div>
        );
      })}

      {hasSerial && (
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          <Button disabled={!allReady} className="bg-[#7D0F82] hover:bg-[#6a0c6f] text-white rounded-xl">
            <Receipt className="w-4 h-4 ml-1" /> הנפק חשבונית
          </Button>
          {allReady ? <span className="text-xs text-emerald-700 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> מוכן</span> : <span className="text-xs text-gray-400">השלם מיפוי ובחירת סריאלי</span>}
        </div>
      )}
    </div>
  );
}