import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";

export default function RepSalesDrilldown({ open, onClose, repName, groupCode, groupLabel, dateFrom, dateTo, mappings, checkFilters }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !repName) return;
    loadDetails();
  }, [open, repName, groupCode, dateFrom, dateTo]);

  const loadDetails = async () => {
    setLoading(true);
    const query = {
      issue_date: { $gte: dateFrom, $lte: dateTo },
      sales_rep: repName
    };
    const allSales = await base44.entities.SalesTransaction.filter(query, '-issue_date', 2000).catch(() => []);
    
    // Filter by group
    const sorted = [...mappings].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const getGroup = (sale) => {
      for (const m of sorted) {
        if (checkFilters(sale, m.filters_json)) return m.commission_group_code;
      }
      return null;
    };

    // Dedup
    const seen = new Set();
    const filtered = allSales.filter(s => {
      const key = `${s.doc_number || ''}_${s.sku || ''}_${s.product_name || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return getGroup(s) === groupCode;
    });

    setItems(filtered);
    setLoading(false);
  };

  const exportCsv = () => {
    const header = "חשבונית,תאריך,מק\"ט,מוצר,כמות,מחיר נטו";
    const rows = items.map(s => 
      `${s.doc_number || ''},${s.issue_date || ''},${s.sku || ''},${(s.product_name || '').replace(/,/g, ' ')},${s.quantity || 0},${s.price_ex_vat || 0}`
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${repName}_${groupLabel}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isCredit = (s) => s.doc_type?.includes('זיכוי') || s.doc_type === '3';

  const totalNet = items.reduce((acc, s) => {
    const net = s.price_ex_vat || 0;
    return acc + (isCredit(s) ? -Math.abs(net) : net);
  }, 0);

  const totalQty = items.reduce((acc, s) => acc + Math.abs(s.quantity || 0), 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-[800px] max-h-[80vh] overflow-hidden" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>{repName}</span>
            <Badge>{groupLabel}</Badge>
            <span className="text-sm text-gray-500 font-normal">{dateFrom} → {dateTo}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between mb-2">
          <div className="flex gap-4 text-sm">
            <span>פריטים: <b>{items.length}</b></span>
            <span>כמות: <b>{totalQty}</b></span>
            <span>סה״כ נטו: <b className="text-blue-600">₪{Math.round(totalNet).toLocaleString()}</b></span>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1">
            <Download className="w-3 h-3" />CSV
          </Button>
        </div>

        <div className="overflow-auto max-h-[55vh]">
          {loading ? (
            <div className="text-center py-8 text-gray-500">טוען...</div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-gray-400">אין נתונים</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">חשבונית</TableHead>
                  <TableHead className="text-xs">תאריך</TableHead>
                  <TableHead className="text-xs">מק״ט</TableHead>
                  <TableHead className="text-xs">מוצר</TableHead>
                  <TableHead className="text-xs text-center">כמות</TableHead>
                  <TableHead className="text-xs text-left">נטו ₪</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((s, i) => (
                  <TableRow key={i} className={isCredit(s) ? 'bg-red-50' : ''}>
                    <TableCell className="text-xs font-mono">{s.doc_number || '-'}</TableCell>
                    <TableCell className="text-xs">{s.issue_date || '-'}</TableCell>
                    <TableCell className="text-xs font-mono">{s.sku || '-'}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate" title={s.product_name}>{s.product_name || '-'}</TableCell>
                    <TableCell className="text-xs text-center">{s.quantity || 0}</TableCell>
                    <TableCell className={`text-xs text-left font-bold ${isCredit(s) ? 'text-red-600' : 'text-blue-600'}`}>
                      {isCredit(s) ? '-' : ''}₪{Math.abs(s.price_ex_vat || 0).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}