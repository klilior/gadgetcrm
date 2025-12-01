import React, { useState } from 'react';
import { AttendanceEdit } from '@/entities/all';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { X, Send } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { useUser } from '../UserAuth';

export default function RequestEditModal({ isOpen, onClose, day, onSubmitted }) {
    const { currentUser } = useUser();
    const [requestedChange, setRequestedChange] = useState({
        first_in: day?.first_in || '',
        last_out: day?.last_out || '',
        notes: ''
    });
    const [reason, setReason] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!isOpen || !day) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!reason.trim()) {
            alert('יש להזין סיבה לבקשת העדכון');
            return;
        }

        setIsSubmitting(true);
        try {
            await AttendanceEdit.create({
                user_id: currentUser.id,
                date: day.date,
                requested_change: requestedChange,
                reason: reason,
                status: 'pending'
            });

            alert('בקשת העדכון נשלחה למנהל לאישור');
            onSubmitted();
        } catch (error) {
            console.error('Error submitting edit request:', error);
            alert('שגיאה בשליחת הבקשה');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <Card className="glass-card border-0 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <CardTitle>בקשת עדכון נוכחות</CardTitle>
                        <Button variant="ghost" size="icon" onClick={onClose}>
                            <X className="w-5 h-5" />
                        </Button>
                    </div>
                    <p className="text-sm text-gray-600">
                        תאריך: {format(new Date(day.date), 'dd/MM/yyyy - EEEE', { locale: he })}
                    </p>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="bg-blue-50 p-4 rounded-lg">
                            <h3 className="font-semibold mb-2">נתונים קיימים:</h3>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="text-gray-600">כניסה:</span>
                                    <span className="font-medium mr-2">{day.first_in || 'לא נרשם'}</span>
                                </div>
                                <div>
                                    <span className="text-gray-600">יציאה:</span>
                                    <span className="font-medium mr-2">{day.last_out || 'לא נרשם'}</span>
                                </div>
                                <div>
                                    <span className="text-gray-600">שעות עבודה:</span>
                                    <span className="font-medium mr-2">{(day.work_minutes / 60).toFixed(2)}</span>
                                </div>
                                <div>
                                    <span className="text-gray-600">סטטוס:</span>
                                    <span className="font-medium mr-2">{day.status}</span>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <Label htmlFor="first_in">שעת כניסה מתוקנת</Label>
                                <Input
                                    id="first_in"
                                    type="time"
                                    value={requestedChange.first_in}
                                    onChange={(e) => setRequestedChange({ ...requestedChange, first_in: e.target.value })}
                                    className="glass-button"
                                />
                            </div>

                            <div>
                                <Label htmlFor="last_out">שעת יציאה מתוקנת</Label>
                                <Input
                                    id="last_out"
                                    type="time"
                                    value={requestedChange.last_out}
                                    onChange={(e) => setRequestedChange({ ...requestedChange, last_out: e.target.value })}
                                    className="glass-button"
                                />
                            </div>

                            <div>
                                <Label htmlFor="notes">הערות נוספות</Label>
                                <Input
                                    id="notes"
                                    value={requestedChange.notes}
                                    onChange={(e) => setRequestedChange({ ...requestedChange, notes: e.target.value })}
                                    className="glass-button"
                                    placeholder="למשל: שכחתי לדווח יציאה"
                                />
                            </div>

                            <div>
                                <Label htmlFor="reason">סיבה לבקשה *</Label>
                                <Textarea
                                    id="reason"
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    className="glass-button"
                                    rows={4}
                                    required
                                    placeholder="הסבר מדוע יש צורך בעדכון הנתונים..."
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-3">
                            <Button type="button" variant="outline" onClick={onClose}>
                                ביטול
                            </Button>
                            <Button type="submit" disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700">
                                <Send className="w-4 h-4 ml-2" />
                                {isSubmitting ? 'שולח...' : 'שלח לאישור'}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}