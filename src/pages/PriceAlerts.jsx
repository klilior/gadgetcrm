import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCcw, TrendingUp, TrendingDown, AlertTriangle, Check, Eye } from "lucide-react";
import { useUser } from "../components/UserAuth";

export default function PriceAlerts() {
  const [alerts, setAlerts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("חדש");
  const { currentUser } = useUser();

  const canManage = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';

  const load = async () => {
    setLoading(true);
    try {
      const query = statusFilter !== "הכל" ? { status: statusFilter } : {};
      const [alertsList, suppliersList] = await Promise.all([
        base44.entities.PriceAlert.filter(query, "-created_date", 200),
        base44.entities.Suppliers.filter({}, undefined, 500)
      ]);
      setAlerts(alertsList || []);
      setSuppliers(suppliersList || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [statusFilter]);

  const getSupplierName = (id) => {
    const s = suppliers.find(x => x.id === id);
    return s?.name || id || "-";
  };

  const updateStatus = async (alertId, newStatus) => {
    await base44.entities.PriceAlert.update(alertId, { status: newStatus });
    load();
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-orange-500" />
          התראות שינוי מחיר
        </h1>
        <Button variant="outline" onClick={load} className="gap-2">
          <RefreshCcw className="w-4 h-4" />
          רענן
        </Button>
      </div>

      <div className="flex gap-2">
        {["הכל", "חדש", "נצפה", "טופל"].map(s => (
          <Button key={s} variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)}>
            {s}
          </Button>
        ))}
      </div>

      <Card className="glass-card border-0">
        <CardHeader>
          <CardTitle>רשימת התראות ({alerts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ספק</TableHead>
                  <TableHead>מק״ט</TableHead>
                  <TableHead>שם מוצר</TableHead>
                  <TableHead>מחיר קודם</TableHead>
                  <TableHead>מחיר חדש</TableHead>
                  <TableHead>שינוי</TableHead>
                  <TableHead>כיוון</TableHead>
                  <TableHead>סטטוס</TableHead>
                  {canManage && <TableHead>פעולות</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={9}>טוען...</TableCell></TableRow>
                ) : alerts.length === 0 ? (
                  <TableRow><TableCell colSpan={9}>אין התראות</TableCell></TableRow>
                ) : (
                  alerts.map(a => (
                    <TableRow key={a.id}>
                      <TableCell>{getSupplierName(a.supplier_id)}</TableCell>
                      <TableCell className="font-mono text-sm">{a.sku}</TableCell>
                      <TableCell>{a.product_name}</TableCell>
                      <TableCell>₪{a.old_price?.toFixed(2)}</TableCell>
                      <TableCell>₪{a.new_price?.toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge variant={Math.abs(a.change_percent) > 5 ? "destructive" : "outline"}>
                          {a.change_percent > 0 ? '+' : ''}{a.change_percent?.toFixed(1)}%
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {a.direction === 'עלה' ? (
                          <Badge className="bg-red-100 text-red-800 gap-1">
                            <TrendingUp className="w-3 h-3" /> עלה
                          </Badge>
                        ) : (
                          <Badge className="bg-green-100 text-green-800 gap-1">
                            <TrendingDown className="w-3 h-3" /> ירד
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{a.status}</Badge>
                      </TableCell>
                      {canManage && (
                        <TableCell className="space-x-1">
                          {a.status === 'חדש' && (
                            <Button size="sm" variant="ghost" onClick={() => updateStatus(a.id, 'נצפה')}>
                              <Eye className="w-4 h-4" />
                            </Button>
                          )}
                          {a.status !== 'טופל' && (
                            <Button size="sm" variant="ghost" onClick={() => updateStatus(a.id, 'טופל')}>
                              <Check className="w-4 h-4" />
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}