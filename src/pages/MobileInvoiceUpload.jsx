import React, { useEffect, useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Upload, CheckCircle2 } from "lucide-react";
import { jsPDF } from "jspdf";

export default function MobileInvoiceUpload() {
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadedBy, setUploadedBy] = useState("");
  const fileInputRef = useRef(null);

  // Helpers for building a multi-page PDF from images
  const fileToDataURL = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  useEffect(() => {
    (async () => {
      try {
        const isAuth = await base44.auth.isAuthenticated();
        if (isAuth) {
          const me = await base44.auth.me();
          setUploadedBy(me?.email || "");
        }
      } catch (_) {
        // ignore - leave uploadedBy empty
      }
    })();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!files || files.length === 0) {
      toast.error("נא לבחור קובץ/ים להעלאה");
      return;
    }
    setSubmitting(true);
    try {
      let uploadFile;
      let fileName;
      let fileType;

      if (files.length === 1) {
        uploadFile = files[0];
        fileName = uploadFile.name;
        fileType = uploadFile.type;
      } else {
        const allImages = files.every(f => f.type?.startsWith('image/'));
        if (!allImages) {
          toast.error("ניתן למזג מספר עמודים רק כתמונות. לא ניתן למזג מספר PDFים.");
          setSubmitting(false);
          return;
        }
        const doc = new jsPDF({ unit: 'px', format: 'a4' });
        for (let i = 0; i < files.length; i++) {
          const dataUrl = await fileToDataURL(files[i]);
          const img = await loadImage(dataUrl);
          const pageWidth = doc.internal.pageSize.getWidth();
          const pageHeight = doc.internal.pageSize.getHeight();
          const margin = 24;
          const maxW = pageWidth - margin * 2;
          const maxH = pageHeight - margin * 2;
          let w = img.width;
          let h = img.height;
          const ratio = Math.min(maxW / w, maxH / h);
          w = w * ratio;
          h = h * ratio;
          if (i > 0) doc.addPage();
          doc.addImage(dataUrl, 'JPEG', (pageWidth - w) / 2, (pageHeight - h) / 2, w, h);
        }
        const blob = doc.output('blob');
        uploadFile = new File([blob], `invoice_${Date.now()}.pdf`, { type: 'application/pdf' });
        fileName = uploadFile.name;
        fileType = uploadFile.type;
      }

      const { file_url } = await base44.integrations.Core.UploadFile({ file: uploadFile });

      const payload = {
        source: "MOBILE",
        received_at: new Date().toISOString(),
        uploaded_by: uploadedBy || undefined,
        file: file_url,
        file_name: fileName || undefined,
        file_mime: fileType || undefined,
        status: "חדש",
      };

      const created = await base44.entities.InvoiceIntakeRaw.create(payload);

      toast.success(files.length > 1 ? "החשבונית מרובת העמודים נשלחה!" : "החשבונית נשלחה!");
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";

      base44.functions.invoke('processIntake', { intake_id: created.id })
        .then((res) => {
          if (res?.data?.created_invoice_id) {
            toast.success("העיבוד הושלם בהצלחה.");
          }
        })
        .catch(() => {
          toast.warning("המסמך נקלט, אך העיבוד האוטומטי נכשל. ניתן לעבד ידנית.");
        });
    } catch (err) {
      toast.error("שגיאה בהעלאת המסמך: " + (err?.message || "שגיאה"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto p-4">
      <Card className="glass-card border-0">
        <CardHeader>
          <CardTitle className="text-2xl">העלאת חשבונית מהנייד</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5" dir="rtl">
            {/* קלט קובץ מוסתר */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />

            {/* אזור בחירת קובץ מעוצב וצבעוני */}
            <div className="rounded-2xl p-6 bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 text-center">
              <div className="mx-auto mb-3 w-14 h-14 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow-lg">
                <Upload className="w-7 h-7 text-white" />
              </div>
              <p className="text-sm text-gray-600 mb-4">בחרו תמונה או PDF של החשבונית</p>
              <Button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-14 text-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-xl"
              >
                <Upload className="w-5 h-5 ml-2" /> בחר קובץ
              </Button>
              {files.length > 0 && (
                <div className="mt-3 text-sm text-gray-700 bg-white/70 rounded-xl border border-gray-200 p-3">
                  <div className="font-medium">{files[0].name}{files.length > 1 ? ` ועוד ${files.length - 1} קבצים` : ''}</div>
                  <div className="text-xs text-gray-500 mt-1">סך הכל {files.length} קובץ/ים</div>
                </div>
              )}
            </div>

            {/* כפתור שליחה גדול ובולט */}
            <Button
              type="submit"
              disabled={submitting || files.length === 0}
              className="w-full h-14 text-lg rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white"
            >
              {submitting ? (
                <Loader2 className="w-5 h-5 ml-2 animate-spin" />
              ) : (
                <CheckCircle2 className="w-5 h-5 ml-2" />
              )}
              שלח לקליטה
            </Button>

            <p className="text-center text-xs text-gray-500">לאחר השליחה תוכלו ישר להעלות חשבונית נוספת.</p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}