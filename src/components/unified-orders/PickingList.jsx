import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, PackageCheck, ListChecks, Loader2 } from "lucide-react";
import { buildPickingItemsFromOrder, totalPickingUnits, computePickingStatus } from "./pickingParser";

/**
 * PickingList — clean physical picking list for an order.
 * Replaces the raw "products" card. Persists picks to PickingState.
 * Reports picking status up via onStatusChange(status) where status ∈ not_started|partial|completed.
 */
export default function PickingList({ order, currentUser, onStatusChange }) {
  const orderId = order?.raw_id || order?.id || String(order?.order_number || "");
  const orderSource = order?.source || "woocommerce";

  const parsedItems = useMemo(() => buildPickingItemsFromOrder(order), [order]);
  const [pickedMap, setPickedMap] = useState({}); // picking_item_id -> {picked, picked_by_name, picked_at}
  const [savingId, setSavingId] = useState(null);
  const [loaded, setLoaded] = useState(false);

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

  const togglePick = async (item) => {
    if (savingId) return;
    const existing = pickedMap[item.picking_item_id];
    const nextPicked = !existing?.picked;
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
  };

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
              return (
                <label
                  key={item.picking_item_id}
                  className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                    item.picked
                      ? "bg-emerald-50/60 border-emerald-200"
                      : "bg-white border-gray-200 hover:bg-slate-50"
                  }`}
                >
                  <Checkbox
                    checked={item.picked}
                    onCheckedChange={() => togglePick(item)}
                    disabled={savingId === item.picking_item_id}
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
                    </div>
                    {meta?.picked && meta?.picked_by_name && (
                      <div className="text-[10px] text-emerald-600 mt-1">✓ סומן ע״י {meta.picked_by_name}</div>
                    )}
                  </div>
                  {savingId === item.picking_item_id && <Loader2 className="w-4 h-4 animate-spin text-gray-400 mt-0.5" />}
                </label>
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