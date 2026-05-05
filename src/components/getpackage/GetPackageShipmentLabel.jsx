import React, { useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

export default function GetPackageShipmentLabel({ shipment, order, open, onClose }) {
  const printRef = useRef();

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    const printWindow = window.open("", "_blank", "width=400,height=600");
    printWindow.document.write(`
      <html dir="rtl">
      <head>
        <title>תעודת משלוח - ${shipment.delivery_id || shipment.id}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 12px; font-size: 12px; }
          .label { border: 2px solid #000; padding: 12px; max-width: 380px; margin: 0 auto; }
          .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 8px; }
          .header h1 { font-size: 18px; margin-bottom: 2px; }
          .header .sub { font-size: 11px; color: #555; }
          .section { margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px dashed #ccc; }
          .section:last-child { border-bottom: none; }
          .section-title { font-weight: bold; font-size: 13px; margin-bottom: 4px; background: #f0f0f0; padding: 2px 6px; }
          .row { display: flex; justify-content: space-between; padding: 1px 0; }
          .row .label { font-weight: bold; border: none; padding: 0; }
          .row .value { text-align: left; }
          .big-text { font-size: 16px; font-weight: bold; text-align: center; padding: 6px; background: #f8f8f8; margin: 6px 0; }
          .barcode { text-align: center; font-family: monospace; font-size: 14px; letter-spacing: 2px; padding: 8px; border: 1px solid #ddd; margin: 6px 0; }
          .notes { font-size: 11px; color: #333; padding: 4px; background: #fffde7; border: 1px solid #fdd835; margin-top: 4px; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>${content.innerHTML}</body>
      <script>window.onload = function() { window.print(); window.close(); }</script>
      </html>
    `);
    printWindow.document.close();
  };

  const orderNum = order?.external_order_number || shipment.woo_order_id || shipment.order_id || "";
  const deliveryId = shipment.delivery_id || shipment.id || "";
  const createdDate = shipment.created_date ? new Date(shipment.created_date).toLocaleDateString("he-IL") : "";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Printer className="w-4 h-4" />
            תעודת משלוח GetPackage
          </DialogTitle>
        </DialogHeader>

        {/* Preview */}
        <div ref={printRef} className="text-xs">
          <div className="label" style={{ border: "2px solid #000", padding: 12, maxWidth: 380, margin: "0 auto" }}>
            <div className="header" style={{ textAlign: "center", borderBottom: "2px solid #000", paddingBottom: 8, marginBottom: 8 }}>
              <h1 style={{ fontSize: 18, marginBottom: 2 }}>GADGET-TEAM</h1>
              <div style={{ fontSize: 11, color: "#555" }}>תעודת משלוח - GetPackage</div>
              <div style={{ fontSize: 11, color: "#555" }}>{createdDate}</div>
            </div>

            {deliveryId && (
              <div className="barcode" style={{ textAlign: "center", fontFamily: "monospace", fontSize: 14, letterSpacing: 2, padding: 8, border: "1px solid #ddd", margin: "6px 0" }}>
                {deliveryId}
              </div>
            )}

            {orderNum && (
              <div className="big-text" style={{ fontSize: 16, fontWeight: "bold", textAlign: "center", padding: 6, background: "#f8f8f8", margin: "6px 0" }}>
                הזמנה #{orderNum}
              </div>
            )}

            <div className="section" style={{ marginBottom: 8, paddingBottom: 6, borderBottom: "1px dashed #ccc" }}>
              <div className="section-title" style={{ fontWeight: "bold", fontSize: 13, background: "#f0f0f0", padding: "2px 6px", marginBottom: 4 }}>📦 פרטי נמען</div>
              <div style={{ padding: "1px 0" }}><b>שם:</b> {shipment.dropoff_name || shipment.customer_name}</div>
              <div style={{ padding: "1px 0" }}><b>טלפון:</b> {shipment.dropoff_phone || shipment.customer_phone}</div>
              <div style={{ padding: "1px 0" }}><b>עיר:</b> {shipment.dropoff_city}</div>
              <div style={{ padding: "1px 0" }}><b>כתובת:</b> {shipment.dropoff_address}</div>
              {shipment.dropoff_notes && (
                <div className="notes" style={{ fontSize: 11, padding: 4, background: "#fffde7", border: "1px solid #fdd835", marginTop: 4 }}>
                  הערות: {shipment.dropoff_notes}
                </div>
              )}
            </div>

            <div className="section" style={{ marginBottom: 8, paddingBottom: 6, borderBottom: "1px dashed #ccc" }}>
              <div className="section-title" style={{ fontWeight: "bold", fontSize: 13, background: "#f0f0f0", padding: "2px 6px", marginBottom: 4 }}>🏠 פרטי איסוף</div>
              <div style={{ padding: "1px 0" }}><b>שם:</b> {shipment.pickup_name}</div>
              <div style={{ padding: "1px 0" }}><b>טלפון:</b> {shipment.pickup_phone}</div>
              <div style={{ padding: "1px 0" }}><b>עיר:</b> {shipment.pickup_city}</div>
              <div style={{ padding: "1px 0" }}><b>כתובת:</b> {shipment.pickup_address}</div>
            </div>

            <div className="section" style={{ marginBottom: 8, paddingBottom: 6 }}>
              <div className="section-title" style={{ fontWeight: "bold", fontSize: 13, background: "#f0f0f0", padding: "2px 6px", marginBottom: 4 }}>📋 פרטי משלוח</div>
              <div style={{ padding: "1px 0" }}><b>מזהה משלוח:</b> {deliveryId}</div>
              {shipment.route_id && <div style={{ padding: "1px 0" }}><b>מזהה מסלול:</b> {shipment.route_id}</div>}
              <div style={{ padding: "1px 0" }}><b>גודל חבילה:</b> {shipment.package_size || "SMALL"}</div>
              <div style={{ padding: "1px 0" }}><b>כמות:</b> {shipment.package_quantity || 1}</div>
              {shipment.package_description && <div style={{ padding: "1px 0" }}><b>תיאור:</b> {shipment.package_description}</div>}
              {shipment.tracking_url && <div style={{ padding: "1px 0" }}><b>קישור מעקב:</b> {shipment.tracking_url}</div>}
            </div>
          </div>
        </div>

        <Button onClick={handlePrint} className="w-full mt-2 bg-emerald-600 hover:bg-emerald-700 text-white">
          <Printer className="w-4 h-4 ml-2" />
          הדפס תעודת משלוח
        </Button>
      </DialogContent>
    </Dialog>
  );
}