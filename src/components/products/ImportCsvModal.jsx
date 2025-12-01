import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, Upload, FileText, AlertCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export default function ImportCsvModal({ isOpen, onClose, onSuccess }) {
    const [file, setFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [result, setResult] = useState(null);
    
    if (!isOpen) return null;
    
    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile && selectedFile.type === 'text/csv') {
            setFile(selectedFile);
            setResult(null);
        } else {
            alert('אנא בחר קובץ CSV');
        }
    };
    
    const handleUpload = async () => {
        if (!file) {
            alert('אנא בחר קובץ');
            return;
        }
        
        setIsUploading(true);
        setResult(null);
        
        try {
            // Upload file first to get URL
            const { file_url } = await base44.integrations.Core.UploadFile({ file });
            
            // Read file content
            const content = await file.text();
            
            // Call import function with file content
            const { data } = await base44.functions.invoke('importWooCsv', { 
                fileContent: content 
            });
            
            if (data.success) {
                setResult(data);
                setTimeout(() => {
                    onSuccess();
                    onClose();
                }, 3000);
            } else {
                alert(`שגיאה בייבוא: ${data.error}`);
            }
        } catch (error) {
            console.error('Upload error:', error);
            alert(`שגיאה: ${error.message}`);
        } finally {
            setIsUploading(false);
        }
    };
    
    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" dir="rtl">
            <Card className="w-full max-w-lg">
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>ייבוא מוצרים מקובץ CSV</CardTitle>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="w-5 h-5" />
                    </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                        <div className="flex items-start gap-2">
                            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                            <div className="text-sm text-blue-900">
                                <p className="font-semibold mb-1">הוראות:</p>
                                <ol className="list-decimal list-inside space-y-1">
                                    <li>ייצא את המוצרים מ-WooCommerce (WooCommerce → Products → Export)</li>
                                    <li>שמור את הקובץ בפורמט CSV</li>
                                    <li>העלה את הקובץ כאן</li>
                                </ol>
                            </div>
                        </div>
                    </div>
                    
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                        <input
                            type="file"
                            accept=".csv"
                            onChange={handleFileChange}
                            className="hidden"
                            id="csv-upload"
                        />
                        <label htmlFor="csv-upload" className="cursor-pointer">
                            <div className="flex flex-col items-center gap-3">
                                {file ? (
                                    <>
                                        <FileText className="w-12 h-12 text-green-600" />
                                        <div>
                                            <p className="font-semibold text-gray-900">{file.name}</p>
                                            <p className="text-sm text-gray-500">
                                                {(file.size / 1024).toFixed(2)} KB
                                            </p>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <Upload className="w-12 h-12 text-gray-400" />
                                        <div>
                                            <p className="font-semibold text-gray-900">לחץ לבחירת קובץ CSV</p>
                                            <p className="text-sm text-gray-500">או גרור ושחרר כאן</p>
                                        </div>
                                    </>
                                )}
                            </div>
                        </label>
                    </div>
                    
                    {isUploading && (
                        <div className="space-y-2">
                            <Progress value={100} className="h-2 animate-pulse" />
                            <p className="text-sm text-center text-gray-600">מייבא מוצרים...</p>
                        </div>
                    )}
                    
                    {result && (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                            <p className="font-semibold text-green-900 mb-2">✅ ייבוא הושלם בהצלחה!</p>
                            <div className="text-sm text-green-800 space-y-1">
                                <p>נוצרו: {result.created} מוצרים</p>
                                <p>עודכנו: {result.updated} מוצרים</p>
                                {result.errors > 0 && <p>שגיאות: {result.errors}</p>}
                            </div>
                        </div>
                    )}
                    
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={onClose} disabled={isUploading}>
                            ביטול
                        </Button>
                        <Button 
                            onClick={handleUpload} 
                            disabled={!file || isUploading}
                            className="bg-blue-600 hover:bg-blue-700"
                        >
                            {isUploading ? 'מייבא...' : 'ייבא מוצרים'}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}