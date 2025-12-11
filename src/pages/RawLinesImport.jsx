import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import UnauthorizedRedirect from "../components/UnauthorizedRedirect";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
    Upload, Database, CheckCircle, XCircle, 
    AlertTriangle, Eye, FileSpreadsheet
} from "lucide-react";
import { format } from "date-fns";

export default function RawLinesImport() {
    const { currentUser } = useUser();
    const [selectedFile, setSelectedFile] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [batches, setBatches] = useState([]);
    const [selectedBatch, setSelectedBatch] = useState(null);
    const [previewRows, setPreviewRows] = useState([]);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);

    const isManager = currentUser?.role === 'מנהל';

    useEffect(() => {
        if (isManager) loadBatches();
    }, [isManager]);

    const loadBatches = async () => {
        try {
            const data = await base44.entities.LineImportBatch.filter({}, '-created_date', 50);
            setBatches(data);
        } catch (error) {
            console.error('Error loading batches:', error);
        }
    };

    const loadPreview = async (batchId) => {
        setIsLoadingPreview(true);
        try {
            const rows = await base44.entities.LineImportRow.filter(
                { batch_id: batchId },
                'created_date',
                100
            );
            setPreviewRows(rows);
            setSelectedBatch(batchId);
        } catch (error) {
            console.error('Error loading preview:', error);
        } finally {
            setIsLoadingPreview(false);
        }
    };

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
            } else {
                alert('נא להעלות קובץ CSV או Excel בלבד');
            }
        }
    };

    const handleUpload = async () => {
        if (!selectedFile) return;

        setIsProcessing(true);
        try {
            // Upload file
            const { file_url } = await base44.integrations.Core.UploadFile({ file: selectedFile });

            // Import
            const response = await base44.functions.invoke('importRawLineData', {
                file_url,
                file_name: selectedFile.name
            });

            if (response.data.success) {
                alert(`✅ ${response.data.total_rows} שורות נקראו בהצלחה`);
                setSelectedFile(null);
                await loadBatches();
                if (response.data.batch_id) {
                    await loadPreview(response.data.batch_id);
                }
            } else {
                throw new Error(response.data.error || 'Import failed');
            }

        } catch (error) {
            console.error('Import error:', error);
            alert('שגיאה בייבוא: ' + error.message);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleProcessBatch = async (batchId) => {
        if (!confirm('זה יעבד את כל השורות התקינות ל-LineContracts. להמשיך?')) return;

        setIsProcessing(true);
        try {
            const response = await base44.functions.invoke('processLineImportBatch', {
                batch_id: batchId
            });

            if (response.data.success) {
                const { stats, unmapped_skus, error_breakdown, error_samples } = response.data;
                let msg = `✅ ${response.data.message}\n\n`;
                msg += `סה"כ: ${stats.total}\n`;
                msg += `נוצרו: ${stats.created}\n`;
                msg += `עודכנו: ${stats.updated}\n`;
                msg += `דולגו (לא ממופים): ${stats.skipped_unmapped}\n`;
                msg += `שגיאות: ${stats.errors}`;
                
                if (stats.errors > 0 && error_breakdown) {
                    msg += `\n\nפירוט שגיאות:`;
                    if (error_breakdown.no_customer > 0) {
                        msg += `\n- לקוח לא נמצא: ${error_breakdown.no_customer}`;
                        if (error_samples.no_customer?.length > 0) {
                            msg += `\n  דוגמאות: ${error_samples.no_customer.map(e => e.customer).join(', ')}`;
                        }
                    }
                    if (error_breakdown.no_date > 0) {
                        msg += `\n- תאריך לא תקין: ${error_breakdown.no_date}`;
                        if (error_samples.no_date?.length > 0) {
                            msg += `\n  דוגמאות: ${error_samples.no_date.map(e => e.date_raw).join(', ')}`;
                        }
                    }
                    if (error_breakdown.other > 0) {
                        msg += `\n- שגיאות אחרות: ${error_breakdown.other}`;
                    }
                }
                
                if (unmapped_skus && unmapped_skus.length > 0) {
                    msg += `\n\nמק״טים לא ממופים (${unmapped_skus.length}):\n`;
                    msg += unmapped_skus.slice(0, 10).join(', ');
                    if (unmapped_skus.length > 10) msg += '...';
                }
                
                alert(msg);
                await loadBatches();
            } else {
                throw new Error(response.data.error || 'Processing failed');
            }

        } catch (error) {
            console.error('Processing error:', error);
            alert('שגיאה בעיבוד: ' + error.message);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleClearData = async () => {
        if (!confirm('⚠️ זה ימחק לצמיתות את כל:\n- באצ\'ים\n- שורות גולמיות\n- הגדרות מק״טים\n\nהאם להמשיך?')) return;
        if (!confirm('בטוח בטוח? פעולה זו בלתי הפיכה!')) return;

        setIsProcessing(true);
        try {
            const response = await base44.functions.invoke('clearImportData', {});

            if (response.data.success) {
                alert(response.data.message);
                await loadBatches();
                setPreviewRows([]);
                setSelectedBatch(null);
            } else {
                throw new Error(response.data.error || 'Clear failed');
            }

        } catch (error) {
            console.error('Clear error:', error);
            alert('שגיאה במחיקה: ' + error.message);
        } finally {
            setIsProcessing(false);
        }
    };

    const getStatusBadge = (status) => {
        const configs = {
            UPLOADED: { label: 'הועלה', color: 'bg-blue-500' },
            PROCESSING: { label: 'מעבד', color: 'bg-yellow-500' },
            PROCESSED: { label: 'עובד', color: 'bg-green-500' },
            FAILED: { label: 'נכשל', color: 'bg-red-500' }
        };
        const config = configs[status] || configs.UPLOADED;
        return <Badge className={`${config.color} text-white`}>{config.label}</Badge>;
    };

    if (!isManager) {
        return <UnauthorizedRedirect currentUser={currentUser} />;
    }

    return (
        <div className="p-4 md:p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
                    <Database className="w-8 h-8 text-indigo-600" />
                    ייבוא גולמי של דוח מכירות קווים (לינט)
                </h1>
                <p className="text-gray-600 mt-1">
                    שלב 1: העלאה ואחסון גולמי של הנתונים
                </p>
            </div>

            {/* Upload Section */}
            <Card className="glass-card border-0">
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>העלאת קובץ חדש</CardTitle>
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleClearData}
                        disabled={isProcessing}
                    >
                        🗑️ מחק את כל נתוני הייבוא
                    </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Alert>
                        <AlertTriangle className="w-4 h-4" />
                        <AlertDescription>
                            העלה את הקובץ המנוקה מלינט (CSV/Excel). הנתונים יישמרו כמות שהם ללא עיבוד.
                        </AlertDescription>
                    </Alert>

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
                                    </>
                                )}
                            </div>
                        </label>
                    </div>

                    <Button
                        onClick={handleUpload}
                        disabled={!selectedFile || isProcessing}
                        className="w-full h-12 bg-indigo-600 hover:bg-indigo-700"
                    >
                        {isProcessing ? 'מעלה ומעבד...' : 'העלה קובץ'}
                    </Button>
                </CardContent>
            </Card>

            {/* Batches List */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle>באצ'ים קודמים</CardTitle>
                </CardHeader>
                <CardContent>
                    {batches.length === 0 ? (
                        <p className="text-center text-gray-500 py-8">אין באצ'ים עדיין</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>תאריך העלאה</TableHead>
                                    <TableHead>שם קובץ</TableHead>
                                    <TableHead>שורות</TableHead>
                                    <TableHead>עובדו</TableHead>
                                    <TableHead>שגיאות</TableHead>
                                    <TableHead>סטטוס</TableHead>
                                    <TableHead>פעולות</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {batches.map((batch) => (
                                    <TableRow key={batch.id}>
                                        <TableCell>{format(new Date(batch.uploaded_at), 'dd/MM/yyyy HH:mm')}</TableCell>
                                        <TableCell className="font-medium">{batch.file_name}</TableCell>
                                        <TableCell>{batch.total_rows}</TableCell>
                                        <TableCell>{batch.processed_rows || 0}</TableCell>
                                        <TableCell>
                                            {batch.error_count > 0 ? (
                                                <Badge variant="destructive">{batch.error_count}</Badge>
                                            ) : (
                                                <CheckCircle className="w-4 h-4 text-green-600" />
                                            )}
                                        </TableCell>
                                        <TableCell>{getStatusBadge(batch.status)}</TableCell>
                                        <TableCell>
                                            <div className="flex gap-2">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => loadPreview(batch.id)}
                                                >
                                                    <Eye className="w-4 h-4 ml-2" />
                                                    צפה
                                                </Button>
                                                {(batch.status === 'UPLOADED' || batch.status === 'PROCESSED') && (
                                                    <Button
                                                        size="sm"
                                                        className="bg-green-600 hover:bg-green-700 text-white"
                                                        onClick={() => handleProcessBatch(batch.id)}
                                                        disabled={isProcessing}
                                                    >
                                                        {batch.status === 'PROCESSED' ? '🔄 עבד מחדש' : 'עבד לקווי ניהול'}
                                                    </Button>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Preview */}
            {selectedBatch && (
                <Card className="glass-card border-0">
                    <CardHeader>
                        <CardTitle>תצוגה מקדימה - 100 שורות ראשונות</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {isLoadingPreview ? (
                            <p className="text-center py-8">טוען...</p>
                        ) : previewRows.length === 0 ? (
                            <p className="text-center text-gray-500 py-8">אין שורות להצגה</p>
                        ) : (
                            <>
                                <div className="mb-4 flex gap-4">
                                    <div className="p-3 bg-blue-50 rounded">
                                        <p className="text-sm text-gray-600">סה״כ שורות</p>
                                        <p className="text-xl font-bold">{previewRows.length}</p>
                                    </div>
                                    <div className="p-3 bg-red-50 rounded">
                                        <p className="text-sm text-gray-600">שורות לא תקינות</p>
                                        <p className="text-xl font-bold">
                                            {previewRows.filter(r => !r.is_valid).length}
                                        </p>
                                    </div>
                                </div>

                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>תקין</TableHead>
                                                <TableHead>מס׳ מסמך</TableHead>
                                                <TableHead>תאריך</TableHead>
                                                <TableHead>לקוח</TableHead>
                                                <TableHead>מק״ט</TableHead>
                                                <TableHead>פריט</TableHead>
                                                <TableHead>כמות</TableHead>
                                                <TableHead>מוכר</TableHead>
                                                <TableHead>קטגוריה</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {previewRows.slice(0, 100).map((row) => (
                                                <TableRow key={row.id} className={!row.is_valid ? 'bg-red-50' : ''}>
                                                    <TableCell>
                                                        {row.is_valid ? (
                                                            <CheckCircle className="w-4 h-4 text-green-600" />
                                                        ) : (
                                                            <XCircle className="w-4 h-4 text-red-600" />
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="font-mono text-xs">{row.doc_number}</TableCell>
                                                    <TableCell className="text-xs">{row.issue_date}</TableCell>
                                                    <TableCell className="text-xs">{row.customer_name}</TableCell>
                                                    <TableCell className="font-mono text-xs">{row.item_sku}</TableCell>
                                                    <TableCell className="text-xs">{row.item_name}</TableCell>
                                                    <TableCell className="text-xs">{row.quantity}</TableCell>
                                                    <TableCell className="text-xs">{row.owner_name}</TableCell>
                                                    <TableCell className="text-xs">{row.category_name}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}