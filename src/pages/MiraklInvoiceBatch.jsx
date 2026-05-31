import React, { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { 
  FileSpreadsheet, Upload, Play, CheckCircle, XCircle, AlertTriangle, 
  Loader2, Search, Download, RefreshCw 
} from "lucide-react";
import { batchCreateSPInvoices } from "@/functions/batchCreateSPInvoices";
import { toast } from "sonner";

const STATUS_BADGES = {
  pending: { label: 'ממתין', color: 'bg-gray-100 text-gray-700' },
  created: { label: 'נוצר', color: 'bg-green-100 text-green-700' },
  already_exists_linet: { label: 'קיים בלינט', color: 'bg-blue-100 text-blue-700' },
  already_exists_base44: { label: 'קיים במערכת', color: 'bg-blue-100 text-blue-700' },
  amount_mismatch: { label: 'סכום לא תואם', color: 'bg-yellow-100 text-yellow-800' },
  error: { label: 'שגיאה', color: 'bg-red-100 text-red-700' },
  skipped_zero: { label: 'דילוג - 0', color: 'bg-gray-100 text-gray-600' },
  not_needed: { label: 'לא נדרש', color: 'bg-gray-50 text-gray-500' },
};

export default function MiraklInvoiceBatch() {
  const [orders, setOrders] = useState([]);
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [checkOrderId, setCheckOrderId] = useState('');
  const [checkResult, setCheckResult] = useState(null);
  const [isChecking, setIsChecking] = useState(false);

  // Parse Excel data pasted as JSON (simplified approach)
  const handlePasteData = useCallback((e) => {
    try {
      const text = e.target.value;
      // Try to parse as JSON array
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        const mapped = parsed.map(row => ({
          mirakl_order_id: row['מספר הזמנה Mirakl'] || row.mirakl_order_id || '',
          customer_name: row['לקוח'] || row.customer_name || '',
          phone: row['טלפון'] || row.phone || '',
          city: row['עיר'] || row.city || '',
          address: row['כתובת'] || row.address || '',
          products_text: row['מוצרים / פריטים'] || row.products_text || '',
          expected_invoice: Number(row['צפוי חשבונית'] || row.expected_invoice) || 0,
          expected_credit: Number(row['צפוי זיכוי'] || row.expected_credit) || 0,
          shipping_method: row['שיטת משלוח'] || '',
          tracking_number: row['מספר מעקב'] || '',
        }));
        setOrders(mapped);
        toast.success(`נטענו ${mapped.length} הזמנות`);
      }
    } catch (err) {
      toast.error('שגיאה בפענוח הנתונים: ' + err.message);
    }
  }, []);

  // Load from file (CSV/JSON)
  const handleFileUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    try {
      const text = await file.text();
      let parsed;
      
      if (file.name.endsWith('.json')) {
        parsed = JSON.parse(text);
      } else {
        // Simple CSV parse
        const lines = text.split('\n');
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        parsed = lines.slice(1).filter(l => l.trim()).map(line => {
          const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
          const obj = {};
          headers.forEach((h, i) => obj[h] = values[i] || '');
          return obj;
        });
      }

      if (Array.isArray(parsed)) {
        const mapped = parsed.map(row => ({
          mirakl_order_id: row['מספר הזמנה Mirakl'] || row.mirakl_order_id || row.order_id || '',
          customer_name: row['לקוח'] || row.customer_name || '',
          phone: row['טלפון'] || row.phone || '',
          city: row['עיר'] || row.city || '',
          address: row['כתובת'] || row.address || '',
          products_text: row['מוצרים / פריטים'] || row.products_text || row.products || '',
          expected_invoice: Number(row['צפוי חשבונית'] || row.expected_invoice || row.amount) || 0,
          expected_credit: Number(row['צפוי זיכוי'] || row.expected_credit) || 0,
          shipping_method: row['שיטת משלוח'] || row.shipping_method || '',
          tracking_number: row['מספר מעקב'] || row.tracking_number || '',
        })).filter(o => o.mirakl_order_id);
        
        setOrders(mapped);
        toast.success(`נטענו ${mapped.length} הזמנות מהקובץ`);
      }
    } catch (err) {
      toast.error('שגיאה בקריאת הקובץ: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Process batch
  const handleProcess = async () => {
    if (orders.length === 0) {
      toast.error('אין הזמנות לעיבוד');
      return;
    }

    if (!window.confirm(`האם לעבד ${orders.length} הזמנות וליצור חשבוניות בלינט?`)) {
      return;
    }

    setIsProcessing(true);
    setResults([]);
    setSummary(null);

    try {
      const response = await batchCreateSPInvoices({
        action: 'process_batch',
        orders: orders,
      });

      const data = response.data || response;
      if (data.success) {
        setResults(data.results || []);
        setSummary(data.summary || null);
        toast.success(`עיבוד הושלם: ${data.summary?.created || 0} חשבוניות נוצרו`);
      } else {
        toast.error(data.error || 'שגיאה בעיבוד');
      }
    } catch (err) {
      toast.error('שגיאה: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsProcessing(false);
    }
  };

  // Check single order
  const handleCheckSingle = async () => {
    if (!checkOrderId.trim()) {
      toast.error('הזן מספר הזמנה');
      return;
    }

    setIsChecking(true);
    setCheckResult(null);

    try {
      const response = await batchCreateSPInvoices({
        action: 'check_single',
        mirakl_order_id: checkOrderId.trim(),
      });
      const data = response.data || response;
      setCheckResult(data);
    } catch (err) {
      toast.error('שגיאה: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsChecking(false);
    }
  };

  // Export results as JSON
  const handleExportResults = () => {
    if (results.length === 0) return;
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `invoice-batch-results-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };

  return (
    <div className="p-4 md:p-6 space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-white" />
            </div>
            הפקת חשבוניות Mirakl
          </h1>
          <p className="text-gray-500 text-sm mt-1">עיבוד אצווה של הזמנות Mirakl ללא חשבונית</p>
        </div>
      </div>

      {/* Check Single Order */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="w-4 h-4" />
            בדיקת הזמנה בודדת
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input 
              placeholder="מספר הזמנה Mirakl (למשל: 028729649-M1-A)"
              value={checkOrderId}
              onChange={(e) => setCheckOrderId(e.target.value)}
              className="flex-1"
            />
            <Button onClick={handleCheckSingle} disabled={isChecking}>
              {isChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4 ml-1" />}
              בדוק
            </Button>
          </div>

          {checkResult && (
            <div className="mt-4 p-4 bg-gray-50 rounded-xl text-sm space-y-2">
              <div className="flex gap-4">
                <div>
                  <span className="text-gray-500">נמצא ב-Base44:</span>
                  <Badge className={checkResult.in_base44 ? 'bg-green-100 text-green-700 mr-2' : 'bg-red-100 text-red-700 mr-2'}>
                    {checkResult.in_base44 ? 'כן' : 'לא'}
                  </Badge>
                </div>
                {checkResult.base44_data && (
                  <>
                    <div>
                      <span className="text-gray-500">סטטוס:</span>
                      <span className="font-medium mr-1">{checkResult.base44_data.order_state}</span>
                    </div>
                    {checkResult.base44_data.linet_invoice_doc_number && (
                      <div>
                        <span className="text-gray-500">חשבונית:</span>
                        <span className="font-medium mr-1 text-green-700">#{checkResult.base44_data.linet_invoice_doc_number}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="flex gap-4">
                <div>
                  <span className="text-gray-500">חשבוניות בלינט (type 9):</span>
                  <span className="font-medium mr-1">{checkResult.linet_invoices_type9?.length || 0}</span>
                </div>
                <div>
                  <span className="text-gray-500">חשבוניות (type 3):</span>
                  <span className="font-medium mr-1">{checkResult.linet_invoices_type3?.length || 0}</span>
                </div>
                <div>
                  <span className="text-gray-500">זיכויים (type 4):</span>
                  <span className="font-medium mr-1">{checkResult.linet_credits_type4?.length || 0}</span>
                </div>
              </div>
              {checkResult.linet_invoices_type9?.length > 0 && (
                <div className="text-xs text-gray-600 bg-white p-2 rounded">
                  <strong>חשבונית קיימת:</strong> #{checkResult.linet_invoices_type9[0].docnum || checkResult.linet_invoices_type9[0].id}
                  {' '}- ₪{checkResult.linet_invoices_type9[0].total || checkResult.linet_invoices_type9[0].total_with_vat}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Load Data */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="w-4 h-4" />
            טעינת נתונים
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-sm text-gray-600 mb-1 block">טען מקובץ CSV/JSON</label>
              <Input 
                type="file" 
                accept=".csv,.json"
                onChange={handleFileUpload}
                disabled={isLoading}
              />
            </div>
          </div>
          
          <div>
            <label className="text-sm text-gray-600 mb-1 block">או הדבק נתונים כ-JSON</label>
            <textarea 
              className="w-full h-32 p-3 border rounded-xl text-xs font-mono resize-none"
              placeholder='[{"מספר הזמנה Mirakl": "028729649-A", "לקוח": "שם לקוח", "צפוי חשבונית": 100}]'
              onChange={handlePasteData}
            />
          </div>

          {orders.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center justify-between">
              <div>
                <span className="font-medium text-green-800">{orders.length} הזמנות נטענו</span>
                <span className="text-green-600 text-sm mr-3">
                  סה"כ צפוי: ₪{orders.reduce((s, o) => s + (o.expected_invoice || 0), 0).toLocaleString()}
                </span>
              </div>
              <Button onClick={handleProcess} disabled={isProcessing} className="bg-green-600 hover:bg-green-700 text-white">
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Play className="w-4 h-4 ml-1" />}
                הפק חשבוניות
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Processing indicator */}
      {isProcessing && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="py-6 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600 mb-3" />
            <p className="text-blue-800 font-medium">מעבד הזמנות...</p>
            <p className="text-blue-600 text-sm">זה יכול לקחת מספר דקות. אנא המתן.</p>
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      {summary && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">סיכום עיבוד</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-gray-800">{summary.total}</div>
                <div className="text-xs text-gray-500">סה"כ</div>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-green-700">{summary.created}</div>
                <div className="text-xs text-green-600">נוצרו</div>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-blue-700">{summary.already_exists}</div>
                <div className="text-xs text-blue-600">כבר קיימות</div>
              </div>
              <div className="bg-yellow-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-yellow-700">{summary.amount_mismatch}</div>
                <div className="text-xs text-yellow-600">סכום לא תואם</div>
              </div>
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-red-700">{summary.errors}</div>
                <div className="text-xs text-red-600">שגיאות</div>
              </div>
              <div className="bg-purple-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-purple-700">{summary.credits_created}</div>
                <div className="text-xs text-purple-600">זיכויים</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results Table */}
      {results.length > 0 && (
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base">תוצאות ({results.length})</CardTitle>
            <Button variant="outline" size="sm" onClick={handleExportResults}>
              <Download className="w-4 h-4 ml-1" />
              ייצא
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>מס' הזמנה</TableHead>
                    <TableHead>לקוח</TableHead>
                    <TableHead>סכום</TableHead>
                    <TableHead>סטטוס חשבונית</TableHead>
                    <TableHead>מס' חשבונית</TableHead>
                    <TableHead>זיכוי</TableHead>
                    <TableHead>הערות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r, i) => {
                    const statusBadge = STATUS_BADGES[r.invoice_status] || STATUS_BADGES.pending;
                    const creditBadge = STATUS_BADGES[r.credit_status] || STATUS_BADGES.not_needed;
                    return (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{r.mirakl_order_id}</TableCell>
                        <TableCell className="text-sm">{r.customer_name}</TableCell>
                        <TableCell className="font-medium">₪{r.expected_invoice}</TableCell>
                        <TableCell>
                          <Badge className={statusBadge.color}>{statusBadge.label}</Badge>
                        </TableCell>
                        <TableCell>
                          {r.invoice_doc_number ? (
                            <span className="font-mono text-green-700">#{r.invoice_doc_number}</span>
                          ) : '-'}
                        </TableCell>
                        <TableCell>
                          {r.expected_credit > 0 ? (
                            <div>
                              <span className="text-xs text-gray-500">₪{r.expected_credit}</span>
                              {r.credit_doc_number && (
                                <span className="font-mono text-purple-700 text-xs mr-1">#{r.credit_doc_number}</span>
                              )}
                            </div>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="text-xs text-gray-500 max-w-[200px] truncate">
                          {r.error || (r.found_in_base44 ? `סטטוס: ${r.base44_status}` : 'לא נמצא ב-Base44')}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Orders Preview (before processing) */}
      {orders.length > 0 && results.length === 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">הזמנות לעיבוד ({orders.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>מס' הזמנה</TableHead>
                    <TableHead>לקוח</TableHead>
                    <TableHead>טלפון</TableHead>
                    <TableHead>צפוי חשבונית</TableHead>
                    <TableHead>צפוי זיכוי</TableHead>
                    <TableHead>מוצרים</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.slice(0, 50).map((o, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-gray-400">{i + 1}</TableCell>
                      <TableCell className="font-mono text-xs">{o.mirakl_order_id}</TableCell>
                      <TableCell className="text-sm">{o.customer_name}</TableCell>
                      <TableCell className="text-xs">{o.phone}</TableCell>
                      <TableCell className="font-medium text-green-700">₪{o.expected_invoice}</TableCell>
                      <TableCell className="text-orange-600">{o.expected_credit > 0 ? `₪${o.expected_credit}` : '-'}</TableCell>
                      <TableCell className="text-xs text-gray-500 max-w-[200px] truncate">{o.products_text}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {orders.length > 50 && (
                <p className="text-center text-sm text-gray-500 py-2">... ועוד {orders.length - 50} הזמנות</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}