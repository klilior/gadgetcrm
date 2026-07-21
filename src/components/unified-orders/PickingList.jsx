import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, ListChecks, Loader2, ScanLine, Tag } from "lucide-react";
import { buildPickingItemsFromOrder, totalPickingUnits, computePickingStatus } from "./pickingParser";
import PickingSerialInline from "./PickingSerialInline";
import { markProductAsSerial } from "@/components/serials/markAsSerial";

/**
 * PickingList — unified picking + serial flow for an order.
 * - Regular items: mark as picked with a checkbox (persisted to PickingState).
 * - Serial items: the serial step (link → scan/pick) is embedded inside the row;
 *   a completed serial automatically marks the item as picked.
 * - Unidentified items can be taught as serial via "סמן כסריאלי".
 * Reports picking status up via onStatusChange(status) — not_started|partial|completed.
 */

const isLineReady = (line) =>
  !!line &&
  (line.assigned_serials?.length || 0) >= (line.serials_required_count || 1) &&
  ["selected", "verified", "invoiced"].includes(line.serial_status);

export default function PickingList({ order, currentUser, onStatusChange }) {
  const orderId = order?.raw_id || order?.id || String(order?.order_number || "");
  const orderSource = order?.source || "woocommerce";
  // Serial lines are keyed by mirakl_order_id for SP orders, raw_id for Woo —
  // must match SerialHandlingZone / backend gates.
  const serialOrderId = orderSource === "mirakl"
    ? (order?.mirakl_order_id || order?.order_number || orderId)
    : orderId;

  const parsedItems = useMemo(() => buildPickingItemsFromOrder(order), [order]);
  const [pickedMap, setPickedMap] = useState({}); // picking_item_id -> {picked, picked_by_name, picked_at, recordId}
  const [savingId, setSavingId] = useState(null);
  const [loaded, setLoaded] = useState(false);

  // Serial state
  const [serialLines, setSerialLines] = useState([]);
  const [serialLoaded, setSerialLoaded] = useState(false);
  const [teachingSku, setTeachingSku] = useState(null);
  const autoPickAttempted = useRef(new Set());

  // Load existing picks for this order
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const picks = await base44.entities.PickingState.filter({ order_id: orderId });
        if (cancelled) return;
        const map = {};
        for (const p of picks) {
          map[p.picking_item_id] = {
            recordId: p.id,
            picked: !!p.picked,
            picked_by_name: p.picked_by_name || "",
            picked_at: p.picked_at || null,
          };
        }
        setPickedMap(map);
      } catch (_) {
        // ignore
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [orderId]);

  // Load serial lines for this order (both entities, same as SerialHandlingZone)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [osl, ois] = await Promise.all([
          base44.entities.OrderSerialLine.filter({ order_id: serialOrderId }).catch(() => []),
          base44.entities.OrderItemSerial.filter({ order_id: serialOrderId }).catch(() => []),
        ]);
        if (!cancelled) setSerialLines([...osl, ...ois]);
      } catch (_) {
        // ignore
      } finally {
        if (!cancelled) setSerialLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [serialOrderId]);

  const serialLineForItem = useCallback((item) => {
    if (!item?.sku) return null;
    return serialLines.find(
      (l) => l.requires_serial && String(l.source_sku || "") === String(item.sku)
    ) || null;
  }, [serialLines]);

  // ── Persist a pick (used by manual toggle AND serial auto-pick) ──
  const setPicked = useCallback(async (item, nextPicked) => {
    const existing = pickedMap[item.picking_item_id];
    setSavingId(item.picking_item_id);

    // optimistic
    setPickedMap((prev) => ({
      ...prev,
      [item.picking_item_id]: {
        ...(prev[item.picking_item_id] || {}),
        picked: nextPicked,
        picked_by_name: nextPicked ? (currentUser?.employee_name || currentUser?.full_name || "") : "",
        picked_at: nextPicked ? new Date().toISOString() : null,
      },
    }));

    try {
      const payload = {
        order_id: orderId,
        order_source: orderSource,
        picking_item_id: item.picking_item_id,
        title: item.title,
        sku: item.sku || undefined,
        quantity: item.quantity,
        item_type: item.type,
        parent_product_name: item.parent_product_name || undefined,
        raw_meta_json: item.raw_meta_json || undefined,
        picked: nextPicked,
        picked_by_user_id: nextPicked ? (currentUser?.id || "") : "",
        picked_by_name: nextPicked ? (currentUser?.employee_name || currentUser?.full_name || "") : "",
        picked_at: nextPicked ? new Date().toISOString() : "",
      };

      if (existing?.recordId) {
        await base44.entities.PickingState.update(existing.recordId, payload);
        setPickedMap((prev) => ({ ...prev, [item.picking_item_id]: { ...prev[item.picking_item_id], recordId: existing.recordId } }));
      } else {
        const created = await base44.entities.PickingState.create(payload);
        setPickedMap((prev) => ({ ...prev, [item.picking_item_id]: { ...prev[item.picking_item_id], recordId: created.id } }));
      }
    } catch (_) {
      // revert on failure
      setPickedMap((prev) => ({
        ...prev,
        [item.picking_item_id]: { ...(prev[item.picking_item_id] || {}), picked: !nextPicked },
      }));
    } finally {
      setSavingId(null);
    }
  }, [pickedMap, orderId, orderSource, currentUser]);

  const togglePick = (item) => {
    if (savingId) return;
    setPicked(item, !pickedMap[item.picking_item_id]?.picked);
  };

  // ── Auto-pick: a completed serial marks the item as picked automatically ──
  useEffect(() => {
    if (!loaded || !serialLoaded) return;
    for (const item of parsedItems) {
      const line = serialLineForItem(item);
      if (!line || !isLineReady(line)) continue;
      if (pickedMap[item.picking_item_id]?.picked) continue;
      if (autoPickAttempted.current.has(item.picking_item_id)) continue;
      autoPickAttempted.current.add(item.picking_item_id);
      setPicked(item, true);
    }
  }, [loaded, serialLoaded, serialLines, parsedItems, pickedMap, serialLineForItem, setPicked]);

  // Serial line updated from inline picker/linker
  const handleSerialLineUpdated = (updatedLine) => {
    setSerialLines((prev) => prev.map((l) => (l.id === updatedLine.id ? { ...l, ...updatedLine } : l)));
    // Notify the invoice zone (SerialHandlingZone) to refresh its gate
    window.dispatchEvent(new CustomEvent("serial-lines-updated", { detail: { orderId: serialOrderId } }));
  };

  // ── Teach the system: mark an unidentified product as serial-required ──
  const handleTeachSerial = async (item) => {
    const confirmMsg = `האם לסמן את "${item.title}" כפריט סריאלי?\n\nפעולה זו תחול גם על הזמנות עתידיות עם מק"ט ${item.sku}.`;
    if (!window.confirm(confirmMsg)) return;
    setTeachingSku(item.sku);
    try {
      const line = await markProductAsSerial({
        order,
        orderId: serialOrderId,
        product: { name: item.title, sku: item.sku, quantity: item.quantity },
        existingLines: serialLines,
      });
      if (line) {
        setSerialLines((prev) => (prev.some((l) => l.id === line.id) ? prev : [...prev, line]));
      }
      window.dispatchEvent(new CustomEvent("serial-lines-updated", { detail: { orderId: serialOrderId } }));
    } catch (e) {
      alert("שגיאה בסימון: " + e.message);
    } finally {
      setTeachingSku(null);
    }
  };

  const itemsWithState = useMemo(
    () => parsedItems.map((it) => ({ ...it, picked: !!pickedMap[it.picking_item_id]?.picked })),
    [parsedItems, pickedMap]
  );

  const totalUnits = totalPickingUnits(itemsWithState);
  const pickedCount = itemsWithState.filter((i) => i.picked).length;
  const totalItems = itemsWithState.length;
  const status = computePickingStatus(itemsWithState);
  const isComplete = totalItems > 0 && pickedCount === totalItems;

  // Report status upward whenever it changes
  useEffect(() => {
    if (loaded && onStatusChange) onStatusChange(status);
  }, [status, loaded, onStatusChange]);

  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-[#7D0F82]" /> מוצרים לליקוט
        </h4>
        {totalItems > 0 && (
          <Badge className={`text-[11px] ${isComplete ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-gray-100 text-gray-600 border-gray-200"}`}>
            {pickedCount}/{totalItems}
          </Badge>
        )}
      </div>

      {totalItems === 0 ? (
        <p className="text-gray-400 text-sm">אין פריטים פיזיים לליקוט</p>
      ) : (
        <>
          <div className="text-sm text-gray-600">
            <div>סה״כ לאיסוף: <span className="font-bold text-gray-900">{totalUnits}</span> פריטים</div>
            <div>סומנו: <span className="font-bold text-gray-900">{itemsWithState.filter(i=>i.picked).reduce((s,i)=>s+i.quantity,0)}</span> מתוך {totalUnits}</div>
          </div>

          <div className="space-y-2">
            {itemsWithState.map((item) => {
              const highlight = item.quantity > 1;
              const meta = pickedMap[item.picking_item_id];
              const line = serialLineForItem(item);
              const serialReady = isLineReady(line);
              const serialBlocked = !!line && !serialReady; // serial required but not complete yet
              return (
                <div
                  key={item.picking_item_id}
                  className={`rounded-xl border p-3 transition-colors ${
                    item.picked
                      ? "bg-emerald-50/60 border-emerald-200"
                      : line
                      ? "bg-amber-50/40 border-amber-200"
                      : "bg-white border-gray-200 hover:bg-slate-50"
                  }`}
                >
                  <label className={`flex items-start gap-3 ${serialBlocked ? "cursor-not-allowed" : "cursor-pointer"}`}>
                    <Checkbox
                      checked={item.picked}
                      onCheckedChange={() => !serialBlocked && togglePick(item)}
                      disabled={savingId === item.picking_item_id || serialBlocked}
                      className="mt-0.5 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium break-words ${item.picked ? "text-emerald-900 line-through/50" : "text-gray-900"}`}>
                        {item.title}
                      </div>
                      {item.attributes?.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          {item.attributes.map((attr, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 bg-blue-50 text-blue-800 border border-blue-200 rounded-md px-2 py-0.5 text-xs font-semibold"
                            >
                              {attr.label}: <span className="font-bold">{attr.value}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {highlight ? (
                          <span className="inline-flex items-center gap-1 bg-orange-100 text-orange-800 border border-orange-200 rounded-md px-2 py-0.5 text-xs font-bold">
                            <AlertTriangle className="w-3 h-3" /> כמות: {item.quantity}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500">כמות: {item.quantity}</span>
                        )}
                        {item.sku && <span className="text-[11px] text-gray-400 font-mono">SKU: {item.sku}</span>}
                        {item.source_label && (
                          <span className="text-[11px] text-indigo-600 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5">
                            {item.source_label}
                          </span>
                        )}
                        {line && (
                          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold border ${
                            serialReady
                              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                              : "bg-amber-100 text-amber-800 border-amber-300"
                          }`}>
                            <ScanLine className="w-3 h-3" />
                            {serialReady ? "סריאלי ✓" : "דורש סריאלי"}
                          </span>
                        )}
                      </div>
                      {meta?.picked && meta?.picked_by_name && (
                        <div className="text-[10px] text-emerald-600 mt-1">✓ סומן ע״י {meta.picked_by_name}</div>
                      )}
                    </div>
                    {savingId === item.picking_item_id && <Loader2 className="w-4 h-4 animate-spin text-gray-400 mt-0.5" />}
                  </label>

                  {/* Serial step embedded in the row — completing it auto-marks the item as picked */}
                  {line && <PickingSerialInline line={line} onUpdated={handleSerialLineUpdated} />}

                  {/* Teach: unidentified product — mark as serial-required (persists for future orders) */}
                  {!line && item.sku && !item.picked && serialLoaded && (
                    <div className="mt-2">
                      <button
                        type="button"
                        disabled={teachingSku === item.sku}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleTeachSerial(item); }}
                        className="inline-flex items-center gap-1 text-[11px] text-amber-700 border border-amber-200 bg-amber-50 hover:bg-amber-100 rounded-lg px-2 py-1 transition-colors disabled:opacity-50"
                      >
                        {teachingSku === item.sku ? <Loader2 className="w-3 h-3 animate-spin" /> : <Tag className="w-3 h-3" />}
                        סמן כסריאלי
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {isComplete && (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-emerald-800 text-sm font-bold">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              ✅ הליקוט הושלם — {totalItems} מתוך {totalItems} פריטים סומנו
            </div>
          )}
        </>
      )}
    </div>
  );
}