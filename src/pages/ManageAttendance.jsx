import React, { useState, useEffect, useCallback } from 'react';
import { AttendanceEdit, AttendanceDay, Employee, AttendanceEvent } from '@/entities/all';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle, XCircle, Clock, AlertCircle, User } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { approveEdit } from '@/functions/approveEdit';
import { rejectEdit } from '@/functions/rejectEdit';

export default function ManageAttendance() {
    const [pendingEdits, setPendingEdits] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [selectedEdit, setSelectedEdit] = useState(null);
    const [managerComment, setManagerComment] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [edits, emps] = await Promise.all([
                AttendanceEdit.filter({ status: 'pending' }, '-created_date'),
                Employee.list()
            ]);

            setPendingEdits(edits);
            setEmployees(emps);
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const getEmployeeName = (userId) => {
        const emp = employees.find(e => e.id === userId);
        return emp?.employee_name || 'לא ידוע';
    };

    const handleApprove = async (edit) => {
        if (!window.confirm('האם לאשר את הבקשה?')) return;

        setIsProcessing(true);
        try {
            const { data } = await approveEdit({
                edit_id: edit.id,
                manager_comment: managerComment
            });

            if (data.success) {
                alert('הבקשה אושרה והנתונים עודכנו');
                setManagerComment('');
                setSelectedEdit(null);
                loadData();
            } else {
                alert('שגיאה: ' + data.error);
            }
        } catch (error) {
            console.error('Error approving edit:', error);
            alert('שגיאה באישור הבקשה');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleReject = async (edit) => {
        if (!managerComment.trim()) {
            alert('יש להזין סיבה לדחיית הבקשה');
            return;
        }

        if (!window.confirm('האם לדחות את הבקשה?')) return;

        setIsProcessing(true);
        try {
            const { data } = await rejectEdit({
                edit_id: edit.id,
                manager_comment: managerComment
            });

            if (data.success) {
                alert('הבקשה נדחתה');
                setManagerComment('');
                setSelectedEdit(null);
                loadData();
            } else {
                alert('שגיאה: ' + data.error);
            }
        } catch (error) {
            console.error('Error rejecting edit:', error);
            alert('שגיאה בדחיית הבקשה');
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="p-6 space-y-6">
            <h1 className="text-3xl font-bold text-gray-900">ניהול נוכחות</h1>

            <Tabs defaultValue="edits">
                <TabsList className="glass-card">
                    <TabsTrigger value="edits" className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        בקשות עדכון
                        {pendingEdits.length > 0 && (
                            <Badge className="bg-red-500 text-white">{pendingEdits.length}</Badge>
                        )}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="edits">
                    <Card className="glass-card border-0">
                        <CardHeader>
                            <CardTitle>בקשות ממתינות לאישור</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {isLoading ? (
                                <div className="text-center py-8">טוען...</div>
                            ) : pendingEdits.length === 0 ? (
                                <div className="text-center py-16 text-gray-500">
                                    <Clock className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                                    <p>אין בקשות ממתינות</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {pendingEdits.map(edit => (
                                        <Card key={edit.id} className="bg-white border border-gray-200">
                                            <CardContent className="p-6">
                                                <div className="grid md:grid-cols-2 gap-6">
                                                    <div>
                                                        <div className="flex items-center gap-2 mb-4">
                                                            <User className="w-5 h-5 text-blue-600" />
                                                            <h3 className="font-bold text-lg">{getEmployeeName(edit.user_id)}</h3>
                                                        </div>
                                                        <div className="space-y-2 text-sm">
                                                            <div>
                                                                <span className="text-gray-600">תאריך:</span>
                                                                <span className="font-medium mr-2">
                                                                    {format(new Date(edit.date), 'dd/MM/yyyy - EEEE', { locale: he })}
                                                                </span>
                                                            </div>
                                                            <div>
                                                                <span className="text-gray-600">סיבה:</span>
                                                                <p className="mt-1 p-3 bg-gray-50 rounded">{edit.reason}</p>
                                                            </div>
                                                            <div>
                                                                <span className="text-gray-600">שינוי מבוקש:</span>
                                                                <div className="mt-1 p-3 bg-blue-50 rounded space-y-1">
                                                                    {edit.requested_change?.first_in && (
                                                                        <p>כניסה: {edit.requested_change.first_in}</p>
                                                                    )}
                                                                    {edit.requested_change?.last_out && (
                                                                        <p>יציאה: {edit.requested_change.last_out}</p>
                                                                    )}
                                                                    {edit.requested_change?.notes && (
                                                                        <p className="text-xs text-gray-600">{edit.requested_change.notes}</p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <h4 className="font-semibold mb-3">טיפול בבקשה</h4>
                                                        <div className="space-y-4">
                                                            <div>
                                                                <label className="text-sm text-gray-600 block mb-2">
                                                                    הערת מנהל
                                                                </label>
                                                                <Textarea
                                                                    value={selectedEdit?.id === edit.id ? managerComment : ''}
                                                                    onChange={(e) => {
                                                                        setManagerComment(e.target.value);
                                                                        setSelectedEdit(edit);
                                                                    }}
                                                                    placeholder="הוסף הערה (אופציונלי לאישור, חובה לדחייה)"
                                                                    className="glass-button"
                                                                    rows={4}
                                                                />
                                                            </div>

                                                            <div className="flex gap-3">
                                                                <Button
                                                                    onClick={() => handleApprove(edit)}
                                                                    disabled={isProcessing}
                                                                    className="flex-1 bg-green-600 hover:bg-green-700"
                                                                >
                                                                    <CheckCircle className="w-4 h-4 ml-2" />
                                                                    אשר
                                                                </Button>
                                                                <Button
                                                                    onClick={() => handleReject(edit)}
                                                                    disabled={isProcessing}
                                                                    variant="outline"
                                                                    className="flex-1 text-red-600 border-red-600 hover:bg-red-50"
                                                                >
                                                                    <XCircle className="w-4 h-4 ml-2" />
                                                                    דחה
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}