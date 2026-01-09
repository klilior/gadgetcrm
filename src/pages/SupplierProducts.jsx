import React, { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { suppliersService } from "../components/utils/suppliersService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowRight, TrendingUp, TrendingDown, Minus, Package, RefreshCcw, FileText } from "lucide-react";
import { createPageUrl } from "@/utils";

export default function SupplierProducts() {
  const urlParams = new URLSearchParams(window.location.search);
  const supplierId = urlParams.get("supplier_id");
  
  const [supplier, setSupplier] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [invoiceDetails, setInvoiceDetails] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      if (supplierId) {
        const sup = await suppliersService.get(supplierId);
        if (sup) setSupplier(sup);
        
        const prods = await base44.entities.SupplierProductPrice.filter({ supplier_id: supplierId }, '-last_invoice_date', 500);
        setProducts(prods || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [supplierId]);

  const openProductDetails = async (product) => {
    setSelectedProduct(product);
    if (product.last_invoice_id) {
      try {
        const invoices = await base44.entities.Invoices.filter({ id: product.last_invoice_id });
        if (invoices.length > 0) setInvoiceDetails(invoices[0]);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const closeModal = () => {
    setSelectedProduct(null);
    setInvoiceDetails(null);
  };

  const getPriceChangeIcon = (direction) => {
    if (direction === 'עלה') return <TrendingUp className="w-4 h-4 text-red-500" />;
    if (direction === 'ירד') return <TrendingDown className="w-4 h-4 text-green-500" />;
    return <Minus className="w-4 h-4 text-gray-400" />;
  };

  const getPriceChangeBadge = (direction, percent) => {
    if (!direction || direction === 'ללא שינוי') return <Badge variant="outline">ללא שינוי</Badge>;
    const color = direction === 'עלה' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800';
    return <Badge className={color}>{direction} {percent ? `${percent.toFixed(1)}%` : ''}</Badge>;
  };

  if (!supplierId) {
    return (
      <div className="p-6 text-center">
        <h1 className="text-xl text-red-600">חסר מזהה ספק</h1>
        <Link to={createPageUrl("SuppliersManagement")}>
          <Button className="mt-4">חזור לניהול ספקים</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Link to={createPageUrl("SuppliersManagement")}>
            <Button variant="outline" size="sm">
              <ArrowRight className="w-4 h-4 ml-1" />
              חזרה
            </Button>
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-6 h-6" />
            מוצרי ספק: {supplier?.name || '...'}
          </h1>
        </div>
        <Button variant="outline" onClick={load} className="gap-2">
          <RefreshCcw className="w-4 h-4" />
          רענן
        </Button>
      </div>

      {supplier && (
        <Card className="glass-card border-0">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><span className="text-gray-500">שם:</span> <strong>{supplier.name}</strong></div>
              <div><span className="text-gray-500">ח.פ/עוסק:</span> <strong>{supplier.vat_id || '-'}</strong></div>
              <div><span className="text-gray-500">סה"כ מוצרים:</span> <strong>{products.length}</strong></div>
              <div><span className="text-gray-500">סטטוס:</span> {supplier.is_active ? <Badge className="bg-green-100 text-green-800">פעיל</Badge> : <Badge variant="outline">לא פעיל</Badge>}</div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="glass-card border-0">
        <CardHeader>
          <CardTitle>רשימת מוצרים ({products.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">טוען...</div>
          ) : products.length === 0 ? (
            <div className="text-center py-8 text-gray-500">אין מוצרים עדיין</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>מק"ט</TableHead>
                    <TableHead>שם מוצר</TableHead>
                    <TableHead>מחיר אחרון</TableHead>
                    <TableHead>מחיר מינימום</TableHead>
                    <TableHead>מחיר מקסימום</TableHead>
                    <TableHead>שינוי</TableHead>
                    <TableHead>רכישות</TableHead>
                    <TableHead>תאריך אחרון</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => (
                    <TableRow key={p.id} className="cursor-pointer hover:bg-gray-50" onClick={() => openProductDetails(p)}>
                      <TableCell className="font-mono font-semibold">{p.sku}</TableCell>
                      <TableCell>{p.product_name}</TableCell>
                      <TableCell className="font-semibold">₪{p.last_price_before_vat?.toFixed(2) || '-'}</TableCell>
                      <TableCell className="text-green-600">₪{p.min_price_before_vat?.toFixed(2) || p.last_price_before_vat?.toFixed(2) || '-'}</TableCell>
                      <TableCell className="text-red-600">₪{p.max_price_before_vat?.toFixed(2) || p.last_price_before_vat?.toFixed(2) || '-'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {getPriceChangeIcon(p.price_change_direction)}
                          {getPriceChangeBadge(p.price_change_direction, p.price_change_percent)}
                        </div>
                      </TableCell>
                      <TableCell>{p.purchase_count || 1}</TableCell>
                      <TableCell>{p.last_invoice_date || '-'}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm">
                          <FileText className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedProduct} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>פרטי מוצר</DialogTitle>
          </DialogHeader>
          {selectedProduct && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">מק"ט:</span> <strong className="font-mono">{selectedProduct.sku}</strong></div>
                <div><span className="text-gray-500">שם:</span> <strong>{selectedProduct.product_name}</strong></div>
                <div><span className="text-gray-500">מחיר אחרון:</span> <strong>₪{selectedProduct.last_price_before_vat?.toFixed(2)}</strong></div>
                <div><span className="text-gray-500">מחיר קודם:</span> <strong>₪{selectedProduct.previous_price_before_vat?.toFixed(2) || '-'}</strong></div>
                <div><span className="text-gray-500">מחיר מינימום:</span> <strong className="text-green-600">₪{selectedProduct.min_price_before_vat?.toFixed(2) || selectedProduct.last_price_before_vat?.toFixed(2)}</strong></div>
                <div><span className="text-gray-500">מחיר מקסימום:</span> <strong className="text-red-600">₪{selectedProduct.max_price_before_vat?.toFixed(2) || selectedProduct.last_price_before_vat?.toFixed(2)}</strong></div>
                <div><span className="text-gray-500">תאריך ראשון:</span> <strong>{selectedProduct.first_seen_date || '-'}</strong></div>
                <div><span className="text-gray-500">מספר רכישות:</span> <strong>{selectedProduct.purchase_count || 1}</strong></div>
              </div>

              {invoiceDetails && (
                <Card className="bg-blue-50 border-blue-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">חשבונית אחרונה</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <div><span className="text-gray-500">מספר:</span> <strong>{invoiceDetails.doc_number}</strong></div>
                    <div><span className="text-gray-500">תאריך:</span> <strong>{invoiceDetails.doc_date}</strong></div>
                    <div><span className="text-gray-500">סכום:</span> <strong>₪{invoiceDetails.total_with_vat?.toLocaleString()}</strong></div>
                    <Link to={`${createPageUrl("InvoicesToReview")}?invoice_id=${invoiceDetails.id}`}>
                      <Button size="sm" variant="outline" className="mt-2 w-full">
                        <FileText className="w-4 h-4 ml-1" />
                        צפה בחשבונית המלאה
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              )}

              <Button variant="outline" onClick={closeModal} className="w-full">סגור</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}