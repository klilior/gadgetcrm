import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2, Printer, XCircle, RefreshCw, Search, Calendar, Truck, Package,
} from "lucide-react";
import { cargoApi } from "@/functions/cargoApi";
import { toast } from "sonner";
import moment from "moment";

const STATUS_COLORS = {
  pending: "bg-gray-100 text-gray-700",
  created: "bg-blue-100 text-blue-700",
  picked_up: "bg-indigo-100 text-indigo-700",
  in_transit: "bg-yellow-100 text-yellow-800",
  delivered: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
  failed: "bg-red-100 text-red-700",
};

const STATUS_LABELS = {
  pending: "ממתין",
  created: "נוצר",
  picked_up: "נאסף",
  in_transit: "בדרך",
  delivered: "נמסר",
  cancelled: "בוטל",
  failed: "נכשל",
};

const TYPE_LABELS = {
  cargo_delivery: "🚚 משלוח",
  cargo_return: "📦 החזרה",
  cargo_exchange: "🔄 החלפה",
};

const DATE_FILTERS = [
  { value: "today", label: "היום" },
  { value: "yesterday", label: "אתמול" },
  { value: "week", label: "7 ימים" },
  { value: "month", label: "30 יום" },
  { value: "all", label: "הכל" },
];

export default function CargoShipmentsList() {
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState("week");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);

  const loadShipments = useCallback(async () => {
    setLoading(true);
    try {
      const all = await base44.entities.Shipment.filter({ carrier: "cargo" }, "-created_date", 200);
      setShipments(all);
    } catch (e) {
      toast.error("שגיאה בטעינת משלוחים");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadShipments(); }, [loadShipments]);

  const filteredShipments = shipments.filter((s) => {
    // Date filter
    const created = moment(s.created_date);
    const now = moment();
    if (dateFilter === "today" && !created.isSame(now, "day")) return false;
    if (dateFilter === "yesterday" && !created.isSame(now.clone().subtract(1, "day"), "day")) return false;
    if (dateFilter === "week" && created.isBefore(now.clone().subtract(7, "days"), "day")) return false;
    if (dateFilter === "month" && created.isBefore(now.clone().subtract(30, "days"), "day")) return false;

    // Status filter
    if (statusFilter !== "all" && s.status !== statusFilter) return false;

    // Search
    if (search) {
      const q = search.toLowerCase();
      const match =
        (s.cargo_shipment_id || "").includes(q) ||
        (s.tracking_number || "").includes(q) ||
        (s.consignee_name || "").toLowerCase().includes(q) ||
        (s.consignee_phone || "").includes(q) ||
        (s.external_order_number || "").includes(q) ||
        (s.reference || "").includes(q);
      if (!match) return false;
    }
    return true;
  });

  const handlePrintLabel = async (shipment) => {
    const sid = shipment.cargo_shipment_id || shipment.tracking_number;
    if (!sid) { toast.error("חסר מזהה משלוח"); return; }
    setActionLoading(shipment.id + "_print");
    try {
      const res = await cargoApi({ action: "print_label", shipment_id: sid });
      const data = res.data || res;
      if (data.label_url) {
        window.open(data.label_url, "_blank");
        toast.success("התווית נפתחה");
      } else if (data.label_base64) {
        const byteChars = atob(data.label_base64);
        const arr = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) arr[i] = byteChars.charCodeAt(i);
        const blob = new Blob([arr], { type: "application/pdf" });
        window.open(URL.createObjectURL(blob), "_blank");
        toast.success("התווית נפתחה");
      } else {
        toast.error(data.error || "לא התקבלה תווית מקארגו");
      }
    } catch (e) {
      toast.error("שגיאה: " + (e.response?.data?.error || e.message));
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelShipment = async () => {
    if (!cancelTarget) return;
    const sid = cancelTarget.cargo_shipment_id || cancelTarget.tracking_number;
    setActionLoading(cancelTarget.id + "_cancel");
    setCancelTarget(null);
    try {
      const res = await cargoApi({ action: "cancel_shipment", shipment_id: sid });
      const data = res.data || res;
      if (data.success) {
        toast.success("המשלוח בוטל בהצלחה");
        loadShipments();
      } else {
        toast.error(data.error || "שגיאה בביטול");
      }
    } catch (e) {
      toast.error("שגיאה: " + (e.response?.data?.error || e.message));
    } finally {
      setActionLoading(null);
    }
  };

  const handleRefreshStatus = async (shipment) => {
    const sid = shipment.cargo_shipment_id || shipment.tracking_number;
    if (!sid) return;
    setActionLoading(shipment.id + "_status");
    try {
      const res = await cargoApi({ action: "get_status", shipment_id: sid });
      const data = res.data || res;
      if (data.success) {
        toast.success(`סטטוס: ${data.status_text}`);
        loadShipments();
      } else {
        toast.error(data.error || "שגיאה בבדיקת סטטוס");
      }
    } catch (e) {
      toast.error("שגיאה: " + (e.response?.data?.error || e.message));
    } finally {
      setActionLoading(null);
    }
  };

  const isCancellable = (s) => !["delivered", "cancelled"].includes(s.status);

  return (
    <Card className="border-0 shadow-lg bg-white/90 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Package className="w-5 h-5 text-blue-600" />
            שטרי מטען קארגו ({filteredShipments.length})
          </CardTitle>
          <Button variant="outline" size="sm" onClick={loadShipments} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ml-1 ${loading ? "animate-spin" : ""}`} />
            רענן
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mt-3">
          <div className="flex items-center gap-1 bg-gray-50 rounded-lg p-1">
            {DATE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setDateFilter(f.value)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  dateFilter === f.value
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-gray-600 hover:bg-gray-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32 h-9 text-xs">
              <SelectValue placeholder="סטטוס" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הסטטוסים</SelectItem>
              <SelectItem value="created">נוצר</SelectItem>
              <SelectItem value="in_transit">בדרך</SelectItem>
              <SelectItem value="delivered">נמסר</SelectItem>
              <SelectItem value="cancelled">בוטל</SelectItem>
            </SelectContent>
          </Select>

          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חפש שם, טלפון, מספר משלוח..."
              className="pr-9 h-9 text-xs"
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : filteredShipments.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            <Truck className="w-10 h-10 mx-auto mb-2 opacity-30" />
            לא נמצאו שטרי מטען
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50/80">
                    <TableHead className="text-right text-xs w-[100px]">תאריך</TableHead>
                    <TableHead className="text-right text-xs">מס׳ משלוח</TableHead>
                    <TableHead className="text-right text-xs">הזמנה</TableHead>
                    <TableHead className="text-right text-xs">סוג</TableHead>
                    <TableHead className="text-right text-xs">נמען</TableHead>
                    <TableHead className="text-right text-xs">עיר</TableHead>
                    <TableHead className="text-right text-xs">סטטוס</TableHead>
                    <TableHead className="text-right text-xs">פעולות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredShipments.map((s) => (
                    <TableRow key={s.id} className="hover:bg-blue-50/30">
                      <TableCell className="text-xs text-gray-500">
                        {moment(s.created_date).format("DD/MM HH:mm")}
                      </TableCell>
                      <TableCell className="text-xs font-mono font-semibold text-blue-700">
                        {s.cargo_shipment_id || s.tracking_number || "-"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {s.external_order_number || s.reference || "-"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {TYPE_LABELS[s.shipment_type] || s.shipment_type}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>{s.consignee_name}</div>
                        <div className="text-gray-400">{s.consignee_phone}</div>
                      </TableCell>
                      <TableCell className="text-xs">{s.consignee_city}</TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${STATUS_COLORS[s.status] || "bg-gray-100"}`}>
                          {s.cargo_status_text || STATUS_LABELS[s.status] || s.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="הדפס תווית"
                            disabled={actionLoading === s.id + "_print"}
                            onClick={() => handlePrintLabel(s)}
                          >
                            {actionLoading === s.id + "_print" ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Printer className="w-3.5 h-3.5 text-blue-600" />
                            )}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="רענן סטטוס"
                            disabled={actionLoading === s.id + "_status"}
                            onClick={() => handleRefreshStatus(s)}
                          >
                            {actionLoading === s.id + "_status" ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="w-3.5 h-3.5 text-gray-500" />
                            )}
                          </Button>
                          {isCancellable(s) && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              title="בטל משלוח"
                              disabled={!!actionLoading}
                              onClick={() => setCancelTarget(s)}
                            >
                              <XCircle className="w-3.5 h-3.5 text-red-500" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-2 p-3">
              {filteredShipments.map((s) => (
                <MobileShipmentCard
                  key={s.id}
                  shipment={s}
                  actionLoading={actionLoading}
                  onPrint={() => handlePrintLabel(s)}
                  onRefresh={() => handleRefreshStatus(s)}
                  onCancel={() => setCancelTarget(s)}
                  isCancellable={isCancellable(s)}
                />
              ))}
            </div>
          </>
        )}
      </CardContent>

      {/* Cancel confirmation dialog */}
      <AlertDialog open={!!cancelTarget} onOpenChange={() => setCancelTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>ביטול משלוח קארגו</AlertDialogTitle>
            <AlertDialogDescription>
              האם אתה בטוח שברצונך לבטל את משלוח #{cancelTarget?.cargo_shipment_id || cancelTarget?.tracking_number}?
              <br />
              פעולה זו לא ניתנת לביטול.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex gap-2">
            <AlertDialogCancel>חזור</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelShipment}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              בטל משלוח
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function MobileShipmentCard({ shipment: s, actionLoading, onPrint, onRefresh, onCancel, isCancellable: canCancel }) {
  return (
    <div className="bg-white border rounded-xl p-3 shadow-sm">
      <div className="flex items-start justify-between mb-2">
        <div>
          <span className="font-mono font-bold text-blue-700 text-sm">
            #{s.cargo_shipment_id || s.tracking_number}
          </span>
          <Badge className={`mr-2 text-[10px] ${STATUS_COLORS[s.status] || "bg-gray-100"}`}>
            {s.cargo_status_text || STATUS_LABELS[s.status] || s.status}
          </Badge>
        </div>
        <span className="text-[10px] text-gray-400">
          {moment(s.created_date).format("DD/MM HH:mm")}
        </span>
      </div>

      <div className="text-xs text-gray-600 space-y-0.5 mb-2">
        <div>{TYPE_LABELS[s.shipment_type] || s.shipment_type} • {s.consignee_name} • {s.consignee_city}</div>
        {s.consignee_phone && <div className="text-gray-400">{s.consignee_phone}</div>}
        {(s.external_order_number || s.reference) && (
          <div className="text-gray-400">הזמנה: {s.external_order_number || s.reference}</div>
        )}
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" disabled={actionLoading === s.id + "_print"} onClick={onPrint}>
          {actionLoading === s.id + "_print" ? <Loader2 className="w-3 h-3 animate-spin ml-1" /> : <Printer className="w-3 h-3 ml-1 text-blue-600" />}
          תווית
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={actionLoading === s.id + "_status"} onClick={onRefresh}>
          {actionLoading === s.id + "_status" ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3 text-gray-500" />}
        </Button>
        {canCancel && (
          <Button size="sm" variant="outline" className="h-8 text-xs text-red-600 border-red-200 hover:bg-red-50" disabled={!!actionLoading} onClick={onCancel}>
            <XCircle className="w-3 h-3" />
          </Button>
        )}
      </div>
    </div>
  );
}