import React from "react";

export default function ShipmentLabelPreview() {
  const sampleData = {
    tracking: "1Z999AA10123456784",
    name: "ישראל ישראלי",
    phone: "050-1234567",
    street: "הרצל",
    house: "42",
    city: "תל אביב",
    zip: "6120101",
    orderNum: "4821",
    pickupPoint: "סופר פארם - דיזנגוף סנטר",
  };

  const openLabel = () => {
    const printContent = `
      <html dir="rtl">
      <head>
        <title>שטר מטען - ${sampleData.tracking}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: Arial, sans-serif; padding: 20px; }
          .label { border: 3px solid #000; width: 100%; max-width: 10cm; margin: 0 auto; padding: 0; }
          .row { display: flex; border-bottom: 2px solid #000; }
          .row:last-child { border-bottom: none; }
          .cell { padding: 8px 12px; border-left: 2px solid #000; flex: 1; }
          .cell:first-child { border-left: none; }
          .cell-label { font-size: 9px; color: #666; margin-bottom: 2px; }
          .cell-value { font-size: 14px; font-weight: bold; }
          .header-row { background: #000; color: #fff; text-align: center; padding: 10px; font-size: 20px; font-weight: bold; letter-spacing: 2px; }
          .tracking-row { text-align: center; padding: 15px 10px; }
          .tracking-num { font-size: 32px; font-weight: bold; letter-spacing: 6px; font-family: 'Courier New', monospace; }
          .barcode { margin: 8px auto; display: flex; justify-content: center; align-items: end; gap: 1px; height: 50px; }
          .barcode .bar { background: #000; }
          .full-width { flex: none; width: 100%; }
          .dest-section { padding: 10px 12px; }
          .dest-title { font-size: 10px; color: #666; margin-bottom: 4px; }
          .dest-name { font-size: 18px; font-weight: bold; }
          .dest-addr { font-size: 13px; margin-top: 4px; }
          .dest-phone { font-size: 13px; margin-top: 2px; }
          .pickup-badge { background: #f0f0f0; border: 1px solid #ccc; display: inline-block; padding: 2px 8px; font-size: 10px; border-radius: 3px; margin-top: 4px; }
          .footer { text-align: center; padding: 6px; font-size: 9px; color: #666; }
          .print-btn { display: block; margin: 15px auto; padding: 10px 30px; font-size: 16px; background: #2563eb; color: #fff; border: none; border-radius: 8px; cursor: pointer; }
          .print-btn:hover { background: #1d4ed8; }
          @media print { body { padding: 0; } .label { border-width: 3px; max-width: none; width: 10cm; } .no-print { display: none; } }
        </style>
      </head>
      <body>
        <div class="label">
          <div class="header-row">UPS שטר מטען</div>
          <div class="tracking-row">
            <div class="barcode" id="barcode"></div>
            <div class="tracking-num">${sampleData.tracking}</div>
          </div>
          <div class="row">
            <div class="cell full-width dest-section">
              <div class="dest-title">נמען</div>
              <div class="dest-name">${sampleData.name}</div>
              <div class="dest-addr">${sampleData.street} ${sampleData.house}, ${sampleData.city} ${sampleData.zip}</div>
              <div class="dest-phone">טל: ${sampleData.phone}</div>
              <div class="pickup-badge">📦 נקודת איסוף: ${sampleData.pickupPoint}</div>
            </div>
          </div>
          <div class="row">
            <div class="cell"><div class="cell-label">מס׳ הזמנה</div><div class="cell-value">#${sampleData.orderNum}</div></div>
            <div class="cell"><div class="cell-label">חבילות</div><div class="cell-value">1</div></div>
            <div class="cell"><div class="cell-label">תאריך</div><div class="cell-value">${new Date().toLocaleDateString('he-IL')}</div></div>
          </div>
          <div class="footer">Gadget Team • יהוד מונוסון</div>
        </div>
        <button class="print-btn no-print" onclick="window.print()">🖨️ הדפס שטר מטען</button>
        <script>
          function generateBarcode(text) {
            const container = document.getElementById('barcode');
            for (let i = 0; i < text.length; i++) {
              const charCode = text.charCodeAt(i);
              for (let j = 0; j < 4; j++) {
                const bar = document.createElement('div');
                bar.className = 'bar';
                const isThick = (charCode >> j) & 1;
                bar.style.width = isThick ? '3px' : '1px';
                bar.style.height = (30 + (charCode % 20)) + 'px';
                container.appendChild(bar);
                const gap = document.createElement('div');
                gap.style.width = '1px';
                container.appendChild(gap);
              }
            }
          }
          generateBarcode('${sampleData.tracking}');
        </script>
      </body>
      </html>
    `;
    const w = window.open('', '_blank');
    if (w) { w.document.write(printContent); w.document.close(); }
  };

  // Inline preview using iframe
  const iframeHtml = `
    <html dir="rtl">
    <head>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; padding: 10px; background: #f5f5f5; display: flex; justify-content: center; }
        .label { border: 3px solid #000; width: 100%; max-width: 10cm; margin: 0 auto; padding: 0; background: #fff; }
        .row { display: flex; border-bottom: 2px solid #000; }
        .row:last-child { border-bottom: none; }
        .cell { padding: 8px 12px; border-left: 2px solid #000; flex: 1; }
        .cell:first-child { border-left: none; }
        .cell-label { font-size: 9px; color: #666; margin-bottom: 2px; }
        .cell-value { font-size: 14px; font-weight: bold; }
        .header-row { background: #000; color: #fff; text-align: center; padding: 10px; font-size: 20px; font-weight: bold; letter-spacing: 2px; }
        .tracking-row { text-align: center; padding: 15px 10px; }
        .tracking-num { font-size: 28px; font-weight: bold; letter-spacing: 5px; font-family: 'Courier New', monospace; }
        .barcode { margin: 8px auto; display: flex; justify-content: center; align-items: end; gap: 1px; height: 50px; }
        .barcode .bar { background: #000; }
        .full-width { flex: none; width: 100%; }
        .dest-section { padding: 10px 12px; }
        .dest-title { font-size: 10px; color: #666; margin-bottom: 4px; }
        .dest-name { font-size: 18px; font-weight: bold; }
        .dest-addr { font-size: 13px; margin-top: 4px; }
        .dest-phone { font-size: 13px; margin-top: 2px; }
        .pickup-badge { background: #f0f0f0; border: 1px solid #ccc; display: inline-block; padding: 2px 8px; font-size: 10px; border-radius: 3px; margin-top: 4px; }
        .footer { text-align: center; padding: 6px; font-size: 9px; color: #666; }
      </style>
    </head>
    <body>
      <div class="label">
        <div class="header-row">UPS שטר מטען</div>
        <div class="tracking-row">
          <div class="barcode" id="barcode"></div>
          <div class="tracking-num">${sampleData.tracking}</div>
        </div>
        <div class="row">
          <div class="cell full-width dest-section">
            <div class="dest-title">נמען</div>
            <div class="dest-name">${sampleData.name}</div>
            <div class="dest-addr">${sampleData.street} ${sampleData.house}, ${sampleData.city} ${sampleData.zip}</div>
            <div class="dest-phone">טל: ${sampleData.phone}</div>
            <div class="pickup-badge">📦 נקודת איסוף: ${sampleData.pickupPoint}</div>
          </div>
        </div>
        <div class="row">
          <div class="cell"><div class="cell-label">מס׳ הזמנה</div><div class="cell-value">#${sampleData.orderNum}</div></div>
          <div class="cell"><div class="cell-label">חבילות</div><div class="cell-value">1</div></div>
          <div class="cell"><div class="cell-label">תאריך</div><div class="cell-value">${new Date().toLocaleDateString('he-IL')}</div></div>
        </div>
        <div class="footer">Gadget Team • יהוד מונוסון</div>
      </div>
      <script>
        function generateBarcode(text) {
          const container = document.getElementById('barcode');
          for (let i = 0; i < text.length; i++) {
            const charCode = text.charCodeAt(i);
            for (let j = 0; j < 4; j++) {
              const bar = document.createElement('div');
              bar.className = 'bar';
              const isThick = (charCode >> j) & 1;
              bar.style.width = isThick ? '3px' : '1px';
              bar.style.height = (30 + (charCode % 20)) + 'px';
              container.appendChild(bar);
              const gap = document.createElement('div');
              gap.style.width = '1px';
              container.appendChild(gap);
            }
          }
        }
        generateBarcode('${sampleData.tracking}');
      </script>
    </body>
    </html>
  `;

  return (
    <div dir="rtl" className="max-w-2xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">תצוגה מקדימה - שטר מטען UPS</h1>
        <p className="text-gray-500 text-sm">כך ייראה שטר המטען שנפתח אוטומטית בעת יצירת משלוח</p>
      </div>

      {/* Inline preview */}
      <div className="bg-white rounded-2xl shadow-lg p-4">
        <iframe
          srcDoc={iframeHtml}
          className="w-full border-0 rounded-lg"
          style={{ height: 420 }}
          title="Label Preview"
        />
      </div>

      <div className="flex justify-center gap-3">
        <button
          onClick={openLabel}
          className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
        >
          🖨️ פתח בטאב חדש (כמו בפועל)
        </button>
      </div>

      <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600 space-y-1">
        <div className="font-medium text-gray-800">מה כולל השטר:</div>
        <ul className="list-disc list-inside space-y-0.5">
          <li>כותרת UPS שחורה</li>
          <li>ברקוד ויזואלי + מספר מעקב גדול</li>
          <li>פרטי נמען (שם, כתובת, טלפון)</li>
          <li>נקודת איסוף (אם רלוונטי)</li>
          <li>מספר הזמנה, חבילות ותאריך</li>
          <li>פוטר Gadget Team</li>
        </ul>
      </div>
    </div>
  );
}