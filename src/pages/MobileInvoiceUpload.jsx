import React, { useEffect, useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Upload, CheckCircle2 } from "lucide-react";

export default function MobileInvoiceUpload() {
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadedBy, setUploadedBy] = useState("");
  const fileInputRef = useRef(null);

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
    if (!file) {
      toast.error("נא לבחור קובץ מסמך להעלאה");
      return;
    }
    setSubmitting(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });

      const payload = {
        source: "MOBILE",
        received_at: new Date().toISOString(),
        uploaded_by: uploadedBy || undefined,
        file: file_url,
        file_name: file.name || undefined,
        file_mime: file.type || undefined,
        status: "חדש",
      };

      const created = await base44.entities.InvoiceIntakeRaw.create(payload);

      // פידבק מיידי והכנה להעלאה הבאה
      toast.success("החשבונית נשלחה! אפשר להעלות חשבונית נוספת.");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

      // עיבוד ברקע
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
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
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
              {file && (
                <div className="mt-3 text-sm text-gray-700 bg-white/70 rounded-xl border border-gray-200 p-3">
                  <div className="font-medium">{file.name}</div>
                  <div className="text-xs text-gray-500 mt-1">{(file.size / 1024).toFixed(0)} KB</div>
                </div>
              )}
            </div>

            {/* כפתור שליחה גדול ובולט */}
            <Button
              type="submit"
              disabled={submitting || !file}
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