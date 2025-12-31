import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";

export default function MobileInvoiceUpload() {
  const [file, setFile] = useState(null);
  const [source, setSource] = useState("MOBILE");
  const [statusReason, setStatusReason] = useState("");
  const [receivedAt] = useState(() => new Date().toISOString());
  const [uploadedBy, setUploadedBy] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
        source,
        received_at: new Date().toISOString(),
        uploaded_by: uploadedBy || undefined,
        file: file_url,
        file_name: file.name || undefined,
        file_mime: file.type || undefined,
        status: "חדש",
        status_reason: statusReason || undefined,
      };

      await base44.entities.InvoiceIntakeRaw.create(payload);
      toast.success("המסמך נקלט בהצלחה.");
      setFile(null);
      setStatusReason("");
      setSource("MOBILE");
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
          <form onSubmit={handleSubmit} className="space-y-4" dir="rtl">
            <div className="space-y-2">
              <Label htmlFor="file">קובץ מסמך (חובה)</Label>
              <Input id="file" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>

            <div className="space-y-2">
              <Label>מקור</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger>
                  <SelectValue placeholder="בחר מקור" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MOBILE">MOBILE</SelectItem>
                  <SelectItem value="GMAIL">GMAIL</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>תאריך קליטה</Label>
                <Input value={new Date(receivedAt).toLocaleString()} readOnly />
              </div>
              <div className="space-y-2">
                <Label>הועלה על ידי</Label>
                <Input value={uploadedBy} readOnly placeholder="לא מחובר" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="note">הערה</Label>
              <Textarea id="note" value={statusReason} onChange={(e) => setStatusReason(e.target.value)} placeholder="הוסף הערה (רשות)" rows={3} />
            </div>

            <Button type="submit" disabled={submitting || !file} className="w-full">
              {submitting ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Upload className="w-4 h-4 ml-2" />}
              שלח לקליטה
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}