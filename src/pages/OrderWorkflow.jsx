import React, { useState, useCallback, useEffect } from "react";
import { getOrderWorkflowStatus } from "@/functions/getOrderWorkflowStatus";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, RefreshCw, Lock } from "lucide-react";
import WorkflowStepper from "@/components/workflow/WorkflowStepper";
import WorkflowStageDetail from "@/components/workflow/WorkflowStageDetail";

export default function OrderWorkflow() {
  const initial = new URLSearchParams(window.location.search).get("order") ?? "";
  const [orderNumber, setOrderNumber] = useState(initial);
  const [data, setData] = useState(null);
  const [selectedStage, setSelectedStage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (num) => {
    const q = String(num ?? "").trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getOrderWorkflowStatus({ external_order_number: q });
      const d = res?.data ?? res;
      if (d?.error) {
        setError(d.message_he ?? "ההזמנה לא נמצאה.");
        setData(null);
      } else {
        setData(d);
        setSelectedStage(d.current_stage);
      }
    } catch (e) {
      setError("שגיאה בטעינת ההזמנה.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (initial) load(initial); }, [initial, load]);

  const stage = data?.stages?.find((s) => s.key === selectedStage) ?? data?.stages?.[0] ?? null;
  const openInOrders = () => window.open(`/UnifiedOrders?search=${data?.order?.external_order_number ?? ""}`, "_blank");

  return (
    <div dir="rtl" className="max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">טיפול בהזמנה</h1>
        <p className="text-sm text-gray-500">מצב התהליך, נקודות עצירה והפעולה הבאה — בתמונה אחת.</p>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load(orderNumber)}
            placeholder="מספר הזמנה (למשל 192200)"
            className="pr-9"
          />
        </div>
        <Button onClick={() => load(orderNumber)} disabled={loading} className="bg-purple-700 hover:bg-purple-800">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "בדוק"}
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">{error}</div>
      )}

      {data && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-lg font-semibold text-gray-900">#{data.order.external_order_number}</span>
              <Badge variant="secondary">{data.order.status ?? "—"}</Badge>
              {data.order.order_locked && (
                <span className="flex items-center gap-1 text-xs text-gray-500"><Lock className="w-3 h-3" /> נעולה</span>
              )}
              <span className="text-sm text-gray-500">₪{data.order.total}</span>
              <span className="text-sm text-gray-500">
                {data.order.order_date ? new Date(data.order.order_date).toLocaleString("he-IL") : ""}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => load(data.order.external_order_number)}
                className="mr-auto text-gray-500"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                רענן
              </Button>
            </div>
            <div className="mt-2 text-sm text-gray-600">{data.order.shipping_method}</div>
            {data.order.tracking_number && (
              <div className="mt-1 text-sm text-gray-600">
                מעקב: <span className="font-mono">{data.order.tracking_number}</span> · {data.order.tracking_carrier}
              </div>
            )}
          </div>

          <WorkflowStepper stages={data.stages} currentStage={selectedStage} onSelect={setSelectedStage} />

          <WorkflowStageDetail stage={stage} onOpenOrder={openInOrders} />

          {data.serial_lines?.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-sm font-semibold text-gray-900 mb-2">פריטים סריאליים</div>
              <div className="space-y-2">
                {data.serial_lines.map((l) => (
                  <div key={l.id} className="flex items-start justify-between gap-3 border-b border-gray-100 last:border-0 pb-2 last:pb-0">
                    <div className="text-sm text-gray-700">
                      <div className="truncate">{l.name}</div>
                      <div className="font-mono text-xs text-gray-500 mt-0.5">
                        {l.assigned_serials.length ? l.assigned_serials.join(" · ") : "טרם נבחר"}
                      </div>
                    </div>
                    <Badge variant="secondary" className="whitespace-nowrap">
                      {l.assigned_serials.length}/{l.required}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}