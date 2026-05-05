import React, { useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

export default function GetPackageLabel({ shipment, open, onClose }) {
  const printRef = useRef();

  const deliveryId = shipment?.delivery_id || "";
  const routeId = shipment?.route_id || "";
  const packageId = shipment?.raw_accept_response?.package?.packageId || 
                     shipment?.raw_quote_response?.package?.packageId || 
                     `GP${deliveryId}`;

  const fromName = "GADGET-TEAM";
  const fromAddress = `${shipment?.pickup_address || "דרך משה דיין 3"}, ${shipment?.pickup_city || "יהוד"}, ישראל`;
  
  const toName = shipment?.dropoff_name || shipment?.customer_name || "";
  const toAddress = `${shipment?.dropoff_address || ""}, ${shipment?.dropoff_city || ""}, ישראל`;

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    const pw = window.open("", "_blank", "width=500,height=700");
    pw.document.write(`<!DOCTYPE html>
<html dir="rtl">
<head>
<meta charset="utf-8">
<title>שטר מטען GetPackage - ${deliveryId}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; padding: 20px; }
  .label { border: 2px solid #000; padding: 16px; max-width: 420px; margin: 0 auto; }
  .logo-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .logo { font-size: 11px; font-weight: bold; border: 1px solid #000; padding: 2px 6px; background: #f0f0f0; }
  .route-id { font-size: 13px; font-weight: bold; }
  .address-section { margin-bottom: 10px; }
  .address-label { font-size: 13px; font-weight: bold; }
  .address-name { font-size: 14px; margin-right: 16px; }
  .address-detail { font-size: 12px; color: #333; margin-right: 16px; }
  .ids-row { display: flex; gap: 40px; margin: 14px 0 8px 0; }
  .id-block { }
  .id-title { font-size: 11px; font-weight: bold; text-transform: uppercase; border-bottom: 1px solid #000; padding-bottom: 2px; margin-bottom: 3px; }
  .id-value { font-size: 15px; font-weight: bold; font-family: monospace; }
  .barcode-section { margin-top: 12px; border-top: 1px dashed #999; padding-top: 12px; text-align: center; }
  .barcode-img { max-width: 300px; height: 60px; margin: 0 auto 4px auto; display: block; }
  .barcode-text { font-size: 12px; font-family: monospace; letter-spacing: 1px; }
  @media print { body { padding: 0; } .label { border-width: 2px; } }
</style>
</head>
<body>
${content.innerHTML}
<script>window.onload = function() { setTimeout(function(){ window.print(); }, 200); }</script>
</body>
</html>`);
    pw.document.close();
  };

  // Generate barcode as an inline SVG (Code 128 simplified - using CSS bars for visual effect)
  const barcodeValue = packageId;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Printer className="w-4 h-4" />
            תעודת משלוח GetPackage
          </DialogTitle>
        </DialogHeader>

        <div ref={printRef}>
          <div style={{ border: "2px solid #000", padding: 16, maxWidth: 420, margin: "0 auto", fontFamily: "Arial, sans-serif" }}>
            {/* Logo + Route ID */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: "bold", border: "1px solid #000", padding: "2px 6px", background: "#f0f0f0" }}>
                GET<br/><span style={{ fontSize: 9 }}>PACKAGE</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: "bold" }}>
                ROUTE ID:{routeId}
              </div>
            </div>

            {/* FROM */}
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: "bold" }}>FROM:</span>
              <span style={{ fontSize: 14, marginRight: 8 }}>{fromName}</span>
              <div style={{ fontSize: 12, color: "#333", marginRight: 48 }}>{fromAddress}</div>
            </div>

            {/* TO */}
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: "bold" }}>TO:</span>
              <span style={{ fontSize: 14, marginRight: 8 }}>{toName}</span>
              <div style={{ fontSize: 12, color: "#333", marginRight: 48 }}>{toAddress}</div>
            </div>

            {/* DELIVERY ID + PACKAGE ID */}
            <div style={{ display: "flex", gap: 40, margin: "14px 0 8px 0" }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: "bold", borderBottom: "1px solid #000", paddingBottom: 2, marginBottom: 3 }}>DELIVERY ID</div>
                <div style={{ fontSize: 15, fontWeight: "bold", fontFamily: "monospace" }}>{deliveryId}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: "bold", borderBottom: "1px solid #000", paddingBottom: 2, marginBottom: 3 }}>PACKAGE ID</div>
                <div style={{ fontSize: 15, fontWeight: "bold", fontFamily: "monospace" }}>{packageId}</div>
              </div>
            </div>

            {/* Barcode section */}
            <div style={{ marginTop: 12, borderTop: "1px dashed #999", paddingTop: 12, textAlign: "center" }}>
              <img
                src={`https://barcode.tec-it.com/barcode.ashx?data=${encodeURIComponent(barcodeValue)}&code=Code128&translate-esc=on&dmsize=Default&unit=Fit&dpi=96&imagetype=png&rotation=0&color=%23000000&bgcolor=%23ffffff&qunit=Mm&quiet=0`}
                alt={barcodeValue}
                style={{ maxWidth: 300, height: 60, display: "block", margin: "0 auto 4px auto" }}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
              <div style={{ fontSize: 12, fontFamily: "monospace", letterSpacing: 1 }}>{barcodeValue}</div>
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