import React, { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle2, Camera, Loader2, UploadCloud } from 'lucide-react';
import { jsPDF } from 'jspdf';

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

async function buildUploadFile(files) {
  if (files.length === 1) return files[0];
  const allImages = files.every((file) => file.type?.startsWith('image/'));
  if (!allImages) throw new Error('ניתן להעלות כמה עמודים רק כתמונות.');

  const doc = new jsPDF({ unit: 'px', format: 'a4' });
  for (let i = 0; i < files.length; i++) {
    const dataUrl = await fileToDataURL(files[i]);
    const img = await loadImage(dataUrl);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 24;
    const ratio = Math.min((pageWidth - margin * 2) / img.width, (pageHeight - margin * 2) / img.height);
    const width = img.width * ratio;
    const height = img.height * ratio;
    if (i > 0) doc.addPage();
    doc.addImage(dataUrl, 'JPEG', (pageWidth - width) / 2, (pageHeight - height) / 2, width, height);
  }
  const blob = doc.output('blob');
  return new File([blob], `quick_invoice_${Date.now()}.pdf`, { type: 'application/pdf' });
}

export default function QuickInvoiceUpload() {
  const fileInputRef = useRef(null);
  const [uploader, setUploader] = useState('');
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('by') || params.get('u') || params.get('worker');
    const saved = localStorage.getItem('quick_invoice_uploader');
    const value = fromUrl || saved || '';
    setUploader(value);
    if (fromUrl) localStorage.setItem('quick_invoice_uploader', fromUrl);
  }, []);

  const submit = async (selectedFiles = files) => {
    setError('');
    setMessage('');
    if (!uploader.trim()) {
      setError('נא לרשום שם עובד/מכשיר לפני ההעלאה.');
      return;
    }
    if (!selectedFiles.length) {
      setError('נא לצלם או לבחור חשבונית.');
      return;
    }

    setSubmitting(true);
    try {
      localStorage.setItem('quick_invoice_uploader', uploader.trim());
      const uploadFile = await buildUploadFile(selectedFiles);
      const fileData = await fileToDataURL(uploadFile);
      const response = await base44.functions.invoke('publicInvoiceUpload', {
        uploaded_by: uploader.trim(),
        file_name: uploadFile.name,
        file_mime: uploadFile.type || 'image/jpeg',
        file_data: fileData
      });

      if (response?.data?.success === false) throw new Error(response.data.error || 'שגיאה בהעלאה');
      setMessage('החשבונית נשלחה בהצלחה לתיבת הקליטה. אפשר לצלם חשבונית נוספת.');
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setError(err?.message || 'שגיאה בהעלאת החשבונית');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileChange = (event) => {
    const nextFiles = Array.from(event.target.files || []);
    setFiles(nextFiles);
    if (nextFiles.length) submit(nextFiles);
  };

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-5 py-6 text-white flex items-center justify-center">
      <div className="w-full max-w-md rounded-[2rem] bg-white/10 border border-white/15 shadow-2xl backdrop-blur-xl p-5 space-y-5">
        <div className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 rounded-3xl bg-emerald-400/20 flex items-center justify-center border border-emerald-300/30">
            <Camera className="w-8 h-8 text-emerald-200" />
          </div>
          <h1 className="text-2xl font-bold">צילום חשבונית מהיר</h1>
          <p className="text-sm text-slate-300">בלי כניסה למערכת — מצלמים והמסמך נכנס ישירות לתיבת הקליטה.</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-slate-200">שם עובד / מכשיר</label>
          <Input
            value={uploader}
            onChange={(event) => setUploader(event.target.value)}
            placeholder="לדוגמה: דניאל - אייפון"
            className="h-12 rounded-2xl bg-white/90 text-slate-900 border-0 text-base"
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        <Button
          type="button"
          disabled={submitting}
          onClick={() => fileInputRef.current?.click()}
          className="w-full h-20 rounded-3xl text-xl font-bold bg-emerald-500 hover:bg-emerald-600 text-white shadow-xl shadow-emerald-900/30"
        >
          {submitting ? <Loader2 className="w-7 h-7 ml-2 animate-spin" /> : <UploadCloud className="w-7 h-7 ml-2" />}
          {submitting ? 'מעלה...' : 'צלם / העלה חשבונית'}
        </Button>

        {files.length > 0 && !submitting && (
          <div className="text-center text-sm text-slate-300">נבחרו {files.length} קובץ/ים</div>
        )}

        {message && (
          <div className="rounded-2xl bg-emerald-400/15 border border-emerald-300/25 p-4 text-emerald-100 flex gap-2 items-start">
            <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <span>{message}</span>
          </div>
        )}

        {error && (
          <div className="rounded-2xl bg-red-400/15 border border-red-300/25 p-4 text-red-100 text-sm">
            {error}
          </div>
        )}

        <p className="text-center text-xs text-slate-400">אפשר לשמור את הדף במסך הבית של הטלפון לגישה מהירה.</p>
      </div>
    </div>
  );
}