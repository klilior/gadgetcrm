import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUser } from "../components/UserAuth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import useSuppliers from "../components/hooks/useSuppliers";
import { RefreshCcw, AlertTriangle, FileText, ExternalLink, ZoomIn, ZoomOut, Download, ChevronUp, ChevronDown, Eye } from "lucide-react";

export default function InvoicesToReview() {
  const [rows, setRows] = useState([]);
  const { suppliersMap, suppliersList } = useSuppliers();
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [intakeFile, setIntakeFile] = useState(null);
  const [imageZoom, setImageZoom] = useState(100);
  const [showDocOnMobile, setShowDocOnMobile] = useState(false);
  const { currentUser } = useUser();
  const canApprove = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';

  const load = async () => {
    setLoading(true);
    try {
      const invoices = await base44.entities.Invoices.filter({ extraction_status: { "$in": ["ממתין לאימות", "נקרא בהצלחה"] } }, "-doc_date", 200);
      const filtered = (invoices || []).filter(inv => 
        inv.supplier || inv.doc_number || inv.total_with_vat || inv.doc_date
      );
      setRows(filtered);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Generate consistent colors for suppliers
  const supplierColors = useMemo(() => {
    const colors = [
      'bg-blue-50 border-l-4 border-l-blue-500',
      'bg-green-50 border-l-4 border-l-green-500',
      'bg-purple-50 border-l-4 border-l-purple-500',
      'bg-orange-50 border-l-4 border-l-orange-500',
      'bg-pink-50 border-l-4 border-l-pink-500',
      'bg-cyan-50 border-l-4 border-l-cyan-500',
      'bg-amber-50 border-l-4 border-l-amber-500',
      'bg-indigo-50 border-l-4 border-l-indigo-500',
      'bg-rose-50 border-l-4 border-l-rose-500',
      'bg-teal-50 border-l-4 border-l-teal-500',
    ];
    const map = {};
    const uniqueSuppliers = [...new Set(rows.map(r => r.supplier).filter(Boolean))];
    uniqueSuppliers.forEach((supplierId, idx) => {
      map[supplierId] = colors[idx % colors.length];
    });
    return map;
  }, [rows]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const d1 = a.doc_date ? new Date(a.doc_date).getTime() : 0;
      const d2 = b.doc_date ? new Date(b.doc_date).getTime() : 0;
      if (d2 !== d1) return d2 - d1;
      const c1 = a.created_date ? new Date(a.created_date).getTime() : 0;
      const c2 = b.created_date ? new Date(b.created_date).getTime() : 0;
      return c2 - c1;
    });
    return arr;
  }, [rows]);

  const openRecord = async (row) => {
    setSelected({ ...row });
    setIntakeFile(null);
    setImageZoom(100);
    setShowDocOnMobile(false);
    
    if (row.source_intake) {
      try {
        const intakeList = await base44.entities.InvoiceIntakeRaw.filter({ id: row.source_intake });
        if (intakeList && intakeList.length > 0 && intakeList[0].file) {
          setIntakeFile(intakeList[0].file);
        }
      } catch (e) {
        console.error("Failed to load intake file:", e);
      }
    }
  };

  const closeDialog = () => {
    setSelected(null);
    setIntakeFile(null);
  };

  const saveRecord = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const updatePayload = {
        supplier: selected.supplier || undefined,
        doc_type: selected.doc_type || undefined,
        doc_number: selected.doc_number || undefined,
        doc_date: selected.doc_date || undefined,
        currency: selected.currency || undefined,
        subtotal_before_vat: selected.subtotal_before_vat != null ? Number(selected.subtotal_before_vat) : undefined,
        vat_amount: selected.vat_amount != null ? Number(selected.vat_amount) : undefined,
        total_with_vat: selected.total_with_vat != null ? Number(selected.total_with_vat) : undefined,
        notes: selected.notes || undefined,
        source_intake: selected.source_intake || undefined,
      };
      await base44.entities.Invoices.update(selected.id, updatePayload);
      
      // Learn supplier pattern if supplier was manually set
      if (selected.supplier && selected.ai_debug_last_extraction_json) {
        try {
          const extraction = JSON.parse(selected.ai_debug_last_extraction_json);
          const normalizedName = extraction.supplier_name_normalized?.trim();
          if (normalizedName) {
            const existingPatterns = await base44.entities.SupplierPattern.filter({
              pattern_type: 'name_pattern',
              pattern_value: normalizedName
            });
            if (!existingPatterns || existingPatterns.length === 0) {
              await base44.entities.SupplierPattern.create({
                supplier_id: selected.supplier,
                pattern_type: 'name_pattern',
                pattern_value: normalizedName,
                confidence: 100,
                learned_from_invoice: selected.id,
                is_active: true
              });
              toast.info("המערכת למדה את הספק לזיהוי עתידי");
            }
          }
        } catch (_) {}
      }
      
      toast.success("נשמר בהצלחה");
      closeDialog();
      load();
    } catch (e) {
      toast.error("שגיאה בשמירה: " + (e?.message || "שגיאה"));
    } finally {
      setSaving(false);
    }
  };

  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const handleApprove = async () => {
    if (approving) return;
    setApproving(true);
    try {
      const result = await base44.functions.invoke('updateInvoiceStatus', { 
        invoice_id: selected.id, 
        action: 'approve',
        employee_role: currentUser?.role,
        employee_email: currentUser?.email || currentUser?.employee_name
      });
      if (result.data?.error) {
        throw new Error(result.data.error);
      }
      toast.success("החשבונית אושרה");
      closeDialog();
      load();
    } catch (e) {
      console.error("Approve error:", e);
      toast.error("שגיאה באישור: " + (e?.response?.data?.error || e?.message || "שגיאה"));
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (rejecting) return;
    setRejecting(true);
    try {
      const result = await base44.functions.invoke('updateInvoiceStatus', { 
        invoice_id: selected.id, 
        action: 'reject',
        employee_role: currentUser?.role,
        employee_email: currentUser?.email || currentUser?.employee_name 
      });
      if (result.data?.error) {
        throw new Error(result.data.error);
      }
      toast.info("החשבונית נדחתה");
      closeDialog();
      load();
    } catch (e) {
      console.error("Reject error:", e);
      toast.error("שגיאה בדחייה: " + (e?.response?.data?.error || e?.message || "שגיאה"));
    } finally {
      setRejecting(false);
    }
  };

  const handleRunAI = async () => {
    try {
      toast.info("מריץ חילוץ AI...");
      await base44.functions.invoke('runInvoiceExtractionByInvoice', { invoice_id: selected.id });
      toast.success("חילוץ הושלם");
      // Reload the record to show updated data
      const updated = await base44.entities.Invoices.filter({ id: selected.id });
      if (updated && updated.length > 0) {
        setSelected(updated[0]);
      }
    } catch (e) {
      toast.error("שגיאה בחילוץ: " + (e?.message || "שגיאה"));
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">חשבוניות לאימות</h1>
        <div className="flex gap-2">
          {canApprove && (
            <Button 
              variant="outline" 
              onClick={async () => {
                try {
                  toast.info("מנקה מסמכים שאינם חשבוניות...");
                  await base44.functions.invoke('cleanupSkippedInvoices');
                  toast.success("הניקוי הושלם");
                  load();
                } catch (e) {
                  toast.error("שגיאה בניקוי: " + (e?.message || "שגיאה"));
                }
              }}
              className="gap-2"
            >
              🧹 נקה מסמכים שאינם חשבוניות
            </Button>
          )}
          <Button variant="outline" onClick={load} className="gap-2"><RefreshCcw className="w-4 h-4"/>רענן</Button>
        </div>
      </div>

      <Card className="glass-card border-0">
        <CardHeader>
          <CardTitle>רשימת חשבוניות ממתינות ({sorted.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ספק</TableHead>
                  <TableHead>סוג מסמך</TableHead>
                  <TableHead>מספר מסמך</TableHead>
                  <TableHead>תאריך מסמך</TableHead>
                  <TableHead>סה״כ כולל מע״מ</TableHead>
                  <TableHead>מטבע</TableHead>
                  <TableHead>ציון ודאות</TableHead>
                  <TableHead>סטטוס ניתוח</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={8}>טוען...</TableCell></TableRow>
                ) : sorted.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-green-600 py-8">🎉 אין חשבוניות ממתינות לאימות</TableCell></TableRow>
                ) : (
                  sorted.map((r) => {
                    const hasData = r.supplier || r.doc_number || r.total_with_vat;
                    const confidence = r.confidence_score;
                    const needsReview = !hasData || confidence < 70;
                    const supplierColorClass = r.supplier ? supplierColors[r.supplier] : '';
                    
                    return (
                      <TableRow 
                        key={r.id} 
                        className={`cursor-pointer hover:bg-purple-50/50 ${needsReview ? 'bg-amber-50/50' : ''} ${supplierColorClass}`} 
                        onClick={() => openRecord(r)}
                      >
                        <TableCell className="font-medium">
                          {suppliersMap[r.supplier]?.name || r.supplier || 
                            <span className="text-gray-400 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 text-amber-500" />
                              חסר
                            </span>
                          }
                        </TableCell>
                        <TableCell>{r.doc_type || <span className="text-gray-400">-</span>}</TableCell>
                        <TableCell>{r.doc_number || <span className="text-gray-400">-</span>}</TableCell>
                        <TableCell>{r.doc_date || <span className="text-gray-400">-</span>}</TableCell>
                        <TableCell className="font-medium">
                          {r.total_with_vat != null ? `₪${r.total_with_vat.toLocaleString()}` : <span className="text-gray-400">-</span>}
                        </TableCell>
                        <TableCell><Badge variant="outline">{r.currency || "ILS"}</Badge></TableCell>
                        <TableCell>
                          {confidence != null ? (
                            <Badge variant={confidence >= 80 ? "default" : confidence >= 50 ? "secondary" : "destructive"}>
                              {confidence}%
                            </Badge>
                          ) : <span className="text-gray-400">-</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.extraction_status === 'נקרא בהצלחה' ? 'default' : 'outline'}>
                            {r.extraction_status || "-"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Invoice Detail Dialog with Document Viewer */}
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="w-[95vw] max-w-[1500px] h-[85vh] md:h-[90vh] overflow-hidden p-0" dir="rtl">
          <DialogHeader className="p-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              פרטי חשבונית
              {selected?.confidence_score != null && (
                <Badge variant={selected.confidence_score >= 80 ? "default" : selected.confidence_score >= 50 ? "secondary" : "destructive"}>
                  ודאות: {selected.confidence_score}%
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          
          {selected && (
            <div className="flex flex-col md:flex-row h-[calc(85vh-64px)] md:h-[calc(90vh-80px)] min-h-0">
              {/* Left side - Document viewer (hidden on mobile unless toggled) */}
              <div className={`${showDocOnMobile ? 'flex' : 'hidden'} md:flex border-l flex-col bg-gray-100 ${showDocOnMobile ? 'max-h-[40vh] shrink-0' : ''} md:flex-1 md:max-h-none`}>
                <div className="p-2 border-b bg-white flex items-center justify-between shrink-0">
                  <span className="text-sm font-medium text-gray-600">תצוגת מסמך מקור</span>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setImageZoom(Math.max(25, imageZoom - 25))}>
                      <ZoomOut className="w-4 h-4" />
                    </Button>
                    <span className="text-xs text-gray-500 w-12 text-center">{imageZoom}%</span>
                    <Button variant="ghost" size="sm" onClick={() => setImageZoom(Math.min(300, imageZoom + 25))}>
                      <ZoomIn className="w-4 h-4" />
                    </Button>
                    {intakeFile && (
                      <>
                        <a href={intakeFile} download className="inline-flex">
                          <Button variant="ghost" size="sm" title="הורד קובץ">
                            <Download className="w-4 h-4" />
                          </Button>
                        </a>
                        <a href={intakeFile} target="_blank" rel="noopener noreferrer">
                          <Button variant="ghost" size="sm" title="פתח בחלון חדש">
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                        </a>
                      </>
                    )}
                    {/* Close doc on mobile */}
                    <Button variant="ghost" size="sm" className="md:hidden" onClick={() => setShowDocOnMobile(false)}>
                      <ChevronUp className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-4 flex items-start justify-center min-h-0">
                  {intakeFile ? (
                    (() => {
                      const lowerFile = intakeFile.toLowerCase();
                      const isImage = lowerFile.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)/i) || lowerFile.includes('image/');
                      const isPdf = lowerFile.includes('.pdf') || lowerFile.includes('application/pdf');
                      
                      if (isImage) {
                        return (
                          <img 
                            src={intakeFile} 
                            alt="Invoice document" 
                            style={{ width: `${imageZoom}%`, maxWidth: 'none' }}
                            className="object-contain shadow-lg bg-white"
                          />
                        );
                      }
                      
                      if (isPdf) {
                        return (
                          <iframe 
                            src={intakeFile + '#toolbar=0&navpanes=0&view=FitH'}
                            className="w-full h-full border-0 bg-white rounded shadow-lg"
                            title="Document preview"
                            style={{ minHeight: '400px' }}
                          />
                        );
                      }
                      
                      // For other file types - use Google Docs viewer as inline preview
                      return (
                        <div className="w-full h-full flex flex-col">
                          <iframe
                            src={`https://docs.google.com/gview?url=${encodeURIComponent(intakeFile)}&embedded=true`}
                            className="w-full flex-1 border-0 bg-white rounded shadow-lg"
                            title="Document preview"
                            style={{ minHeight: '400px' }}
                          />
                          <div className="mt-2 flex justify-center">
                            <a href={intakeFile} download>
                              <Button variant="outline" size="sm" className="gap-2">
                                <Download className="w-4 h-4" />
                                הורד קובץ מקור
                              </Button>
                            </a>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                      <FileText className="w-20 h-20 mb-4" />
                      <span className="text-lg">אין מסמך מקור זמין</span>
                      <span className="text-sm mt-1">ייתכן שהמסמך לא הועלה או נמחק</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right side - Form */}
              <div className="w-full md:w-[450px] flex flex-col bg-white min-h-0 flex-1 md:flex-none">
                {/* Mobile: Toggle document view button */}
                {intakeFile && (
                  <button
                    onClick={() => setShowDocOnMobile(!showDocOnMobile)}
                    className="md:hidden flex items-center justify-center gap-2 p-2.5 bg-blue-50 border-b border-blue-200 text-blue-700 text-sm font-medium shrink-0"
                  >
                    <Eye className="w-4 h-4" />
                    {showDocOnMobile ? 'הסתר מסמך' : 'הצג מסמך מקור'}
                    {showDocOnMobile ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                )}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                  {/* Supplier Info Section */}
                  <div className="bg-blue-50 rounded-lg p-3 space-y-2">
                    <div className="font-medium text-blue-800 text-sm">פרטי ספק</div>
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-500">שם ספק</Label>
                      <Select value={selected.supplier || ""} onValueChange={(v) => setSelected({ ...selected, supplier: v })}>
                        <SelectTrigger className="h-9 bg-white"><SelectValue placeholder="בחר ספק" /></SelectTrigger>
                        <SelectContent>
                          {suppliersList.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                      {(() => {
                      try {
                        const extraction = selected.ai_debug_last_extraction_json ? JSON.parse(selected.ai_debug_last_extraction_json) : null;
                        const extractedVatId = extraction?.supplier_vat_id;
                        const supplierVatId = suppliersMap[selected.supplier]?.vat_id;
                        const OUR_VAT_ID = '040638660'; // מספר העוסק שלנו
                        const isOurVatId = extractedVatId === OUR_VAT_ID;
                        
                        return (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">ח.פ. ספק:</span>
                              <Input 
                                className="h-7 w-32 font-mono text-sm" 
                                value={selected._editedVatId ?? extractedVatId ?? supplierVatId ?? ""} 
                                onChange={(e) => setSelected({ ...selected, _editedVatId: e.target.value })}
                                placeholder="הזן ח.פ."
                              />
                            </div>
                            {isOurVatId && (
                              <div className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
                                ⚠️ זהו מספר העוסק שלנו - כנראה הח.פ. של הספק לא זוהה נכון
                              </div>
                            )}
                          </div>
                        );
                      } catch (_) { return null; }
                    })()}
                  </div>

                  {/* Document Info */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-500">סוג מסמך</Label>
                      <Select value={selected.doc_type || ""} onValueChange={(v) => setSelected({ ...selected, doc_type: v })}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="בחר" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="חשבונית מס">חשבונית מס</SelectItem>
                          <SelectItem value="חשבונית זיכוי">חשבונית זיכוי</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-500">מספר מסמך</Label>
                      <Input className="h-9" value={selected.doc_number || ""} onChange={(e) => setSelected({ ...selected, doc_number: e.target.value })} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-500">תאריך מסמך</Label>
                      <Input className="h-9" type="date" value={selected.doc_date || ""} onChange={(e) => setSelected({ ...selected, doc_date: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-500">מטבע</Label>
                      <Select value={selected.currency || "ILS"} onValueChange={(v) => setSelected({ ...selected, currency: v })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ILS">₪ ILS</SelectItem>
                          <SelectItem value="USD">$ USD</SelectItem>
                          <SelectItem value="EUR">€ EUR</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Totals Section */}
                  <div className="border-t pt-3 mt-3">
                    <Label className="text-xs text-gray-500 mb-2 block">סכומים</Label>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 w-24">לפני מע"מ:</span>
                        <Input className="h-8 flex-1" type="number" value={selected.subtotal_before_vat ?? ""} onChange={(e) => setSelected({ ...selected, subtotal_before_vat: e.target.value })} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 w-24">מע"מ (18%):</span>
                        <Input className="h-8 flex-1" type="number" value={selected.vat_amount ?? ""} onChange={(e) => setSelected({ ...selected, vat_amount: e.target.value })} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium w-24">סה"כ כולל:</span>
                        <Input className="h-9 flex-1 font-bold text-lg" type="number" value={selected.total_with_vat ?? ""} onChange={(e) => setSelected({ ...selected, total_with_vat: e.target.value })} />
                      </div>
                    </div>
                  </div>

                  {/* Line Items Section */}
                  {(() => {
                    try {
                      const extraction = selected.ai_debug_last_extraction_json ? JSON.parse(selected.ai_debug_last_extraction_json) : null;
                      const lineItems = extraction?.line_items || [];
                      const totalWithVat = Number(selected.total_with_vat) || 0;
                      const VAT_RATE = 0.18;
                      
                      if (lineItems.length > 0) {
                        return (
                          <div className="border-t pt-3 mt-3">
                            <Label className="text-xs text-gray-500 mb-2 block">פריטים ({lineItems.length})</Label>
                            <div className="space-y-2 max-h-48 overflow-y-auto">
                              {lineItems.map((item, idx) => {
                                // Calculate prices - if one is missing, derive from the other using VAT
                                let unitPriceBeforeVat = item.unit_price_before_vat;
                                let lineTotalBeforeVat = item.line_total_before_vat;
                                let lineTotalWithVat = item.line_total_with_vat;
                                const qty = item.quantity || 1;
                                
                                // If we have total with VAT but not before VAT
                                if (lineTotalWithVat && !lineTotalBeforeVat) {
                                  lineTotalBeforeVat = lineTotalWithVat / (1 + VAT_RATE);
                                }
                                // If we have before VAT but not with VAT
                                if (lineTotalBeforeVat && !lineTotalWithVat) {
                                  lineTotalWithVat = lineTotalBeforeVat * (1 + VAT_RATE);
                                }
                                // Calculate unit price if missing
                                if (!unitPriceBeforeVat && lineTotalBeforeVat && qty) {
                                  unitPriceBeforeVat = lineTotalBeforeVat / qty;
                                }
                                // If we only have unit price, calculate totals
                                if (unitPriceBeforeVat && !lineTotalBeforeVat) {
                                  lineTotalBeforeVat = unitPriceBeforeVat * qty;
                                  lineTotalWithVat = lineTotalBeforeVat * (1 + VAT_RATE);
                                }
                                
                                const unitPriceWithVat = unitPriceBeforeVat ? unitPriceBeforeVat * (1 + VAT_RATE) : null;
                                
                                return (
                                  <div key={idx} className="bg-gray-50 rounded p-2 text-xs border">
                                    <div className="flex justify-between items-start mb-1">
                                      <span className="font-medium text-gray-800 flex-1 truncate" title={item.product_name}>
                                        {item.product_name || 'ללא שם'}
                                      </span>
                                      {item.sku && (
                                        <span className="text-gray-400 font-mono mr-2 text-[10px]">מק"ט: {item.sku}</span>
                                      )}
                                    </div>
                                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-gray-600">
                                      <div>כמות: <span className="font-medium">{qty}</span></div>
                                      <div>מחיר/יח׳ (לפני): <span className="font-medium">{unitPriceBeforeVat ? `₪${unitPriceBeforeVat.toFixed(2)}` : '-'}</span></div>
                                      <div>סה״כ לפני מע״מ: <span className="font-medium">{lineTotalBeforeVat ? `₪${lineTotalBeforeVat.toFixed(2)}` : '-'}</span></div>
                                      <div>סה״כ כולל מע״מ: <span className="font-medium text-green-700">{lineTotalWithVat ? `₪${lineTotalWithVat.toFixed(2)}` : '-'}</span></div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      }
                    } catch (_) {}
                    return null;
                  })()}

                  <div className="space-y-1">
                    <Label className="text-xs text-gray-500">הערות</Label>
                    <Input className="h-9" value={selected.notes || ""} onChange={(e) => setSelected({ ...selected, notes: e.target.value })} placeholder="הערות נוספות..." />
                  </div>

                  {!canApprove && (
                    <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                      ⚠️ אישור/דחייה זמינים רק למנהלים
                    </div>
                  )}

                  {/* Why not auto-approved - ALWAYS VISIBLE with problems highlighted in red */}
                  {(() => {
                    const problems = [];
                    let validation = null;
                    
                    // Parse validation JSON
                    if (selected.ai_debug_last_validation_json) {
                      try {
                        validation = JSON.parse(selected.ai_debug_last_validation_json);
                      } catch (_) {}
                    }
                    
                    // Check for problems
                    if (!selected.supplier) {
                      problems.push({ type: 'supplier', label: 'ספק לא זוהה', critical: true });
                    }
                    if (selected.confidence_score != null && selected.confidence_score < 85) {
                      problems.push({ type: 'confidence', label: `ציון ודאות נמוך (${selected.confidence_score}%)`, critical: selected.confidence_score < 50 });
                    }
                    if (validation?.math_consistent === false) {
                      problems.push({ type: 'math', label: 'חישוב מתמטי לא תקין', critical: true });
                    }
                    if (validation?.missing_critical_fields?.length > 0) {
                      problems.push({ type: 'fields', label: `שדות חסרים: ${validation.missing_critical_fields.join(', ')}`, critical: true });
                    }
                    if (validation?.reason_for_review) {
                      problems.push({ type: 'reason', label: validation.reason_for_review, critical: false });
                    }
                    if (!selected.doc_number) {
                      problems.push({ type: 'doc_number', label: 'מספר מסמך חסר', critical: true });
                    }
                    if (!selected.total_with_vat) {
                      problems.push({ type: 'total', label: 'סכום כולל חסר', critical: true });
                    }
                    
                    // Get the original reason from validation
                    const originalReason = validation?.reason_for_review || validation?.recommended_status;
                    
                    if (problems.length === 0) {
                      return (
                        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                          <div className="text-green-700 font-medium text-sm">✓ כל הנתונים תקינים כעת</div>
                          <div className="text-green-600 text-xs mt-1">ניתן לאשר את החשבונית</div>
                          {originalReason && (
                            <div className="mt-2 pt-2 border-t border-green-200 text-xs text-gray-600">
                              <span className="font-medium">סיבת הבדיקה הידנית המקורית:</span> {originalReason}
                            </div>
                          )}
                          {selected.extraction_status === 'ממתין לאימות' && !originalReason && (
                            <div className="mt-2 pt-2 border-t border-green-200 text-xs text-gray-600">
                              <span className="font-medium">סיבה:</span> הספק לא זוהה אוטומטית בעת החילוץ (ניתן לקשר ידנית ולאשר)
                            </div>
                          )}
                        </div>
                      );
                    }
                    
                    return (
                      <div className="p-3 bg-red-50 border-2 border-red-300 rounded-lg">
                        <div className="text-red-700 font-bold text-sm mb-2 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          בעיות שמנעו אישור אוטומטי:
                        </div>
                        <div className="space-y-1">
                          {problems.map((p, idx) => (
                            <div 
                              key={idx} 
                              className={`text-xs flex items-center gap-1 ${p.critical ? 'text-red-700 font-medium' : 'text-amber-700'}`}
                            >
                              {p.critical ? '❌' : '⚠️'} {p.label}
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 pt-2 border-t border-red-200 text-xs text-red-600">
                          תקן את הבעיות למעלה ולחץ "אשר חשבונית"
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Action buttons - fixed at bottom */}
                <div className="p-4 border-t bg-gray-50 space-y-2 shrink-0">
                  {/* Explanation of buttons */}
                  <div className="text-[10px] text-gray-500 mb-1">
                    💾 <b>שמור</b> = שמור שינויים ללא אישור סופי | ✓ <b>אשר</b> = שמור + סמן כ"אושר" + למד את הספק
                  </div>
                  {canApprove && (
                    <div className="flex gap-2">
                      <Button className="flex-1 h-10" onClick={handleApprove} variant="default" disabled={approving}>
                        {approving ? "מאשר..." : "✓ אשר חשבונית"}
                      </Button>
                      <Button className="flex-1 h-10" onClick={handleReject} variant="destructive" disabled={rejecting}>
                        {rejecting ? "דוחה..." : "✗ דחה"}
                      </Button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button className="flex-1 h-9" variant="secondary" onClick={handleRunAI}>
                      🤖 הרץ AI שוב
                    </Button>
                    <Button className="flex-1 h-9" variant="outline" onClick={saveRecord} disabled={saving}>
                      {saving ? "שומר..." : "💾 שמור"}
                    </Button>
                  </div>
                  <Button className="w-full h-9" variant="ghost" onClick={closeDialog}>
                    סגור
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}