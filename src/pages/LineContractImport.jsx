import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import UnauthorizedRedirect from "../components/UnauthorizedRedirect";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { 
    Upload, FileSpreadsheet, CheckCircle, XCircle, 
    AlertTriangle, Download, Info
} from "lucide-react";

export default function LineContractImport() {
    const { currentUser } = useUser();
    const [selectedFile, setSelectedFile] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [result, setResult] = useState(null);
    const [hasImported, setHasImported] = useState(false);

    const isManager = currentUser?.role === 'מנהל';

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (file) {
            const validTypes = [
                'text/csv',
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            ];
            if (validTypes.includes(file.type) || file.name.endsWith('.csv') || file.name.endsWith('.xlsx')) {
                setSelectedFile(file);
                setResult(null);
            } else {
                alert('נא להעלות קובץ CSV או Excel בלבד');
            }
        }
    };

    const handleImport = async () => {
        if (!selectedFile) return;

        if (hasImported && !confirm('נראה שכבר בוצע ייבוא. האם אתה בטוח שברצונך להריץ שוב? זה עלול ליצור כפילויות.')) {
            return;
        }

        setIsProcessing(true);
        setProgress(0);
        setResult(null);

        try {
            // Upload file first
            const { file_url } = await base44.integrations.Core.UploadFile({ file: selectedFile });

            // Progress simulation while processing
            const progressInterval = setInterval(() => {
                setProgress(prev => Math.min(prev + 5, 90));
            }, 1000);

            // Call import function
            const response = await base44.functions.invoke('importLineContracts', {
                file_url
            });

            clearInterval(progressInterval);
            setProgress(100);

            if (response.data.success) {
                setResult(response.data);
                setHasImported(true);
            } else {
                throw new Error(response.data.error || 'Import failed');
            }

        } catch (error) {
            console.error('Import error:', error);
            setResult({
                success: false,
                error: error.message || 'שגיאה בעיבוד הקובץ'
            });
        } finally {
            setIsProcessing(false);
        }
    };

    if (!isManager) {
        return <UnauthorizedRedirect currentUser={currentUser} />;
    }

    return (
        <div className="p-4 md:p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
                    <FileSpreadsheet className="w-8 h-8 text-indigo-600" />
                    טעינת היסטוריית קווי סלולר (ייבוא חד־פעמי)
                </h1>
                <p className="text-gray-600 mt-1">
                    ייבוא חד־פעמי של נתוני מכירות קווים מ-2 השנים האחרונות
                </p>
            </div>

            {/* Instructions Card */}
            <Card className="border-l-4 border-l-blue-500">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Info className="w-5 h-5 text-blue-600" />
                        הוראות שימוש
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div>
                        <p className="font-medium mb-2">מבנה הקובץ הנדרש (CSV/Excel):</p>
                        <ul className="text-sm space-y-1 mr-4 list-disc">
                            <li><strong>customer_name</strong> - שם הלקוח (חובה)</li>
                            <li><strong>customer_phone</strong> - טלפון ליצירת קשר</li>
                            <li><strong>customer_id_number</strong> - תעודת זהות (למציאות מהירה)</li>
                            <li><strong>msisdn</strong> - מספר הקו (אם ידוע)</li>
                            <li><strong>product_sku</strong> - מק"ט המוצר (חובה)</li>
                            <li><strong>product_name</strong> - שם המוצר (חובה)</li>
                            <li><strong>doc_number</strong> - מספר חשבונית/מסמך (חובה - למניעת כפילויות)</li>
                            <li><strong>issue_date</strong> - תאריך המכירה בפורמט YYYY-MM-DD (חובה)</li>
                            <li><strong>agent_name</strong> - שם הנציג המוכר (חובה)</li>
                        </ul>
                    </div>
                    <Alert>
                        <AlertTriangle className="w-4 h-4" />
                        <AlertDescription>
                            <strong>חשוב:</strong> זהו תהליך חד-פעמי. לאחר הרצה מוצלחת, מומלץ לא להריץ שוב כדי למנוע כפילויות.
                        </AlertDescription>
                    </Alert>
                </CardContent>
            </Card>

            {/* Upload Card */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle>העלאת קובץ</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-indigo-500 transition-colors">
                        <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                        <input
                            type="file"
                            accept=".csv,.xlsx,.xls"
                            onChange={handleFileSelect}
                            className="hidden"
                            id="file-upload"
                            disabled={isProcessing}
                        />
                        <label htmlFor="file-upload" className="cursor-pointer">
                            <div className="text-sm text-gray-600">
                                {selectedFile ? (
                                    <div className="flex items-center justify-center gap-2">
                                        <FileSpreadsheet className="w-5 h-5 text-green-600" />
                                        <span className="font-medium">{selectedFile.name}</span>
                                    </div>
                                ) : (
                                    <>
                                        <span className="text-indigo-600 hover:text-indigo-700 font-medium">
                                            לחץ כאן לבחירת קובץ
                                        </span>
                                        <span> או גרור קובץ לכאן</span>
                                    </>
                                )}
                            </div>
                        </label>
                    </div>

                    <Button
                        onClick={handleImport}
                        disabled={!selectedFile || isProcessing}
                        className="w-full h-14 text-lg bg-indigo-600 hover:bg-indigo-700"
                    >
                        {isProcessing ? (
                            <>מעבד קובץ...</>
                        ) : (
                            <>
                                <Upload className="w-5 h-5 ml-2" />
                                העלה ועבד קובץ
                            </>
                        )}
                    </Button>

                    {hasImported && (
                        <Alert className="bg-yellow-50 border-yellow-300">
                            <AlertTriangle className="w-4 h-4 text-yellow-600" />
                            <AlertDescription className="text-yellow-800">
                                כבר בוצע ייבוא במערכת זו. הרצה נוספת עלולה ליצור כפילויות.
                            </AlertDescription>
                        </Alert>
                    )}
                </CardContent>
            </Card>

            {/* Progress */}
            {isProcessing && (
                <Card className="glass-card border-0">
                    <CardContent className="p-6">
                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <span className="text-sm font-medium">מעבד...</span>
                                <span className="text-sm font-medium">{progress}%</span>
                            </div>
                            <Progress value={progress} className="h-2" />
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Results */}
            {result && (
                <Card className={`border-l-4 ${result.success ? 'border-l-green-500' : 'border-l-red-500'}`}>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            {result.success ? (
                                <>
                                    <CheckCircle className="w-6 h-6 text-green-600" />
                                    הייבוא הושלם בהצלחה
                                </>
                            ) : (
                                <>
                                    <XCircle className="w-6 h-6 text-red-600" />
                                    שגיאה בייבוא
                                </>
                            )}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {result.success ? (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="p-4 bg-blue-50 rounded-lg">
                                        <p className="text-sm text-gray-600">שורות שעובדו</p>
                                        <p className="text-2xl font-bold text-blue-600">{result.stats?.total || 0}</p>
                                    </div>
                                    <div className="p-4 bg-green-50 rounded-lg">
                                        <p className="text-sm text-gray-600">חוזים נוצרו</p>
                                        <p className="text-2xl font-bold text-green-600">{result.stats?.created || 0}</p>
                                    </div>
                                    <div className="p-4 bg-yellow-50 rounded-lg">
                                        <p className="text-sm text-gray-600">דולגו</p>
                                        <p className="text-2xl font-bold text-yellow-600">{result.stats?.skipped || 0}</p>
                                    </div>
                                    <div className="p-4 bg-red-50 rounded-lg">
                                        <p className="text-sm text-gray-600">שגיאות</p>
                                        <p className="text-2xl font-bold text-red-600">{result.stats?.errors || 0}</p>
                                    </div>
                                </div>

                                {result.errorRows && result.errorRows.length > 0 && (
                                    <div className="mt-4">
                                        <Alert className="bg-red-50 border-red-200">
                                            <AlertTriangle className="w-4 h-4 text-red-600" />
                                            <AlertDescription>
                                                <p className="font-medium text-red-800 mb-2">
                                                    {result.errorRows.length} שורות נכשלו:
                                                </p>
                                                <div className="max-h-40 overflow-y-auto space-y-1">
                                                    {result.errorRows.slice(0, 10).map((err, idx) => (
                                                        <p key={idx} className="text-sm text-red-700">
                                                            שורה {err.row}: {err.error}
                                                        </p>
                                                    ))}
                                                    {result.errorRows.length > 10 && (
                                                        <p className="text-sm text-red-700 font-medium">
                                                            ועוד {result.errorRows.length - 10}...
                                                        </p>
                                                    )}
                                                </div>
                                            </AlertDescription>
                                        </Alert>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <Alert className="bg-red-50 border-red-200">
                                <XCircle className="w-4 h-4 text-red-600" />
                                <AlertDescription className="text-red-800">
                                    {result.error}
                                </AlertDescription>
                            </Alert>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}