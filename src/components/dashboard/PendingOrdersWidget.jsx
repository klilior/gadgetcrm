import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { Package, Phone, ArrowLeft } from "lucide-react";

const WOO_OPEN = ["processing", "on-hold", "ordered", "wc-awaiting-serial"];
// הזמנות שדורשות יצירת קשר טלפוני עם הלקוח
const WOO_PHONE_REP = ["on-hold", "ordered"];
const MIRAKL_OPEN = ["WAITING_ACCEPTANCE", "SHIPPING"];

export default function PendingOrdersWidget() {
  const [stats, setStats] = useState({ pending: 0, phone: 0 });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [wooOrders, spOrders] = await Promise.all([
        base44.entities.Order.list("-order_date", 300).catch(() => []),
        base44.entities.SuperPharmOrder.list("-created_at_mirakl", 200).catch(() => []),
      ]);
      if (!alive) return;
      const wooOpen = wooOrders.filter((o) => WOO_OPEN.includes(o.status));
      const spOpen = spOrders.filter((o) => MIRAKL_OPEN.includes(o.order_state));
      setStats({
        pending: wooOpen.length + spOpen.length,
        phone: wooOpen.filter((o) => WOO_PHONE_REP.includes(o.status)).length,
      });
      setIsLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  return (
    <Card className="border border-gray-100 shadow-sm rounded-2xl bg-white">
      <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-2xl bg-[#7D0F82] flex items-center justify-center">
            <Package className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-sm text-gray-500">הזמנות ממתינות לטיפול</div>
            <div className="text-2xl font-black text-gray-900">
              {isLoading ? "…" : stats.pending}
            </div>
          </div>
        </div>

        <div className={`flex items-center gap-3 rounded-2xl px-4 py-2.5 ${stats.phone > 0 ? "bg-amber-50 border border-amber-200" : "bg-gray-50 border border-gray-100"}`}>
          <Phone className={`w-5 h-5 ${stats.phone > 0 ? "text-amber-600" : "text-gray-400"}`} />
          <div>
            <div className={`text-xs ${stats.phone > 0 ? "text-amber-700" : "text-gray-500"}`}>ממתינות לנציג טלפוני</div>
            <div className={`text-xl font-black ${stats.phone > 0 ? "text-amber-700" : "text-gray-700"}`}>
              {isLoading ? "…" : stats.phone}
            </div>
          </div>
        </div>

        <Link to="/UnifiedOrders?filter=pending">
          <Button className="rounded-xl bg-[#7D0F82] hover:bg-[#6a0c6f] text-white">
            למסך ההזמנות
            <ArrowLeft className="w-4 h-4 mr-2" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}