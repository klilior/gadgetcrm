import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
    CheckCircle, XCircle, Clock, PhoneOff, Calendar, 
    StickyNote, User, Phone
} from "lucide-react";
import { format, addHours, addDays } from "date-fns";

export default function ContractDetailModal({ isOpen, onClose, contract, onUpdate, currentUser }) {
    const [notes, setNotes] = useState([]);
    const [newNote, setNewNote] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [showSnoozeOptions, setShowSnoozeOptions] = useState(false);

    useEffect(() => {
        if (isOpen && contract) {
            loadNotes();
        }
    }, [isOpen, contract]);

    const loadNotes = async () => {
        try {
            const data = await base44.entities.ContractNote.filter(
                { line_contract_id: contract.id },
                '-created_date',
                50
            );
            setNotes(data);
        } catch (error) {
            console.error("Error loading notes:", error);
        }
    };

    const handleAddNote = async () => {
        if (!newNote.trim()) return;
        
        setIsLoading(true);
        try {
            await base44.entities.ContractNote.create({
                line_contract_id: contract.id,
                agent_id: currentUser.id,
                agent_name: currentUser.employee_name,
                note_text: newNote,
                note_type: 'OTHER'
            });
            setNewNote("");
            loadNotes();
        } catch (error) {
            alert("שגיאה בשמירת הערה");
        } finally {
            setIsLoading(false);
        }
    };

    const handleStatusUpdate = async (newStatus, extraData = {}) => {
        setIsLoading(true);
        try {
            await base44.entities.LineContract.update(contract.id, {
                status: newStatus,
                last_action_date: new Date().toISOString(),
                last_action_type: newStatus,
                ...extraData
            });
            
            // Add automatic note
            const noteTexts = {
                RETAINED: 'הלקוח נשמר בהצלחה',
                LOST: 'הלקוח החליט שלא להמשיך',
                IN_PROGRESS: 'החל טיפול בחוזה'
            };
            
            if (noteTexts[newStatus]) {
                await base44.entities.ContractNote.create({
                    line_contract_id: contract.id,
                    agent_id: currentUser.id,
                    agent_name: currentUser.employee_name,
                    note_text: noteTexts[newStatus],
                    note_type: 'CALL'
                });
            }
            
            onUpdate();
            onClose();
        } catch (error) {
            alert("שגיאה בעדכון סטטוס");
        } finally {
            setIsLoading(false);
        }
    };

    const handleSnooze = async (duration) => {
        let snoozeUntil;
        const now = new Date();
        
        switch (duration) {
            case '1hour':
                snoozeUntil = addHours(now, 1);
                break;
            case 'later_today':
                snoozeUntil = new Date(now.setHours(18, 0, 0, 0)); // 6 PM today
                break;
            case 'tomorrow':
                snoozeUntil = addDays(now, 1);
                snoozeUntil.setHours(9, 0, 0, 0); // 9 AM tomorrow
                break;
            case 'next_week':
                snoozeUntil = addDays(now, 7);
                snoozeUntil.setHours(9, 0, 0, 0);
                break;
            default:
                return;
        }

        setIsLoading(true);
        try {
            await base44.entities.LineContract.update(contract.id, {
                status: 'IN_PROGRESS',
                snooze_until: snoozeUntil.toISOString(),
                last_action_date: new Date().toISOString(),
                last_action_type: 'NO_ANSWER'
            });

            await base44.entities.ContractNote.create({
                line_contract_id: contract.id,
                agent_id: currentUser.id,
                agent_name: currentUser.employee_name,
                note_text: `אין מענה - נדחה עד ${format(snoozeUntil, 'dd/MM/yyyy HH:mm')}`,
                note_type: 'CALL'
            });

            onUpdate();
            onClose();
        } catch (error) {
            alert("שגיאה בעדכון");
        } finally {
            setIsLoading(false);
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        try {
            return format(new Date(dateString), 'dd/MM/yyyy');
        } catch {
            return dateString;
        }
    };

    const formatDateTime = (dateString) => {
        if (!dateString) return '-';
        try {
            return format(new Date(dateString), 'dd/MM/yyyy HH:mm');
        } catch {
            return dateString;
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold flex items-center gap-2">
                        <Phone className="w-6 h-6 text-indigo-600" />
                        פרטי חוזה - {contract.customer_name}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-6">
                    {/* Customer & Line Info */}
                    <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
                        <div>
                            <p className="text-sm text-gray-600">שם לקוח</p>
                            <p className="font-bold">{contract.customer_name}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600">טלפון</p>
                            <p className="font-mono">{contract.customer_phone || '-'}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600">מספר קו</p>
                            <p className="font-mono">{contract.msisdn || '-'}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600">ספק</p>
                            <Badge variant="outline" className="mt-1">{contract.carrier_name}</Badge>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600">תאריך הפעלה</p>
                            <p>{formatDate(contract.activation_date)}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600">זמין לחידוש</p>
                            <p className="font-bold text-green-600">{formatDate(contract.safe_retarget_date)}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600">בעלים נוכחי</p>
                            <p className="flex items-center gap-1">
                                <User className="w-4 h-4" />
                                {contract.account_owner_name}
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600">פעולה אחרונה</p>
                            <p className="text-sm">{contract.last_action_type || '-'}</p>
                            <p className="text-xs text-gray-500">{formatDateTime(contract.last_action_date)}</p>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    {!showSnoozeOptions ? (
                        <div className="grid grid-cols-2 gap-3">
                            <Button
                                onClick={() => handleStatusUpdate('RETAINED')}
                                disabled={isLoading}
                                className="bg-green-600 hover:bg-green-700 h-14 text-base"
                            >
                                <CheckCircle className="w-5 h-5 ml-2" />
                                נמכר / נשמר
                            </Button>

                            <Button
                                onClick={() => setShowSnoozeOptions(true)}
                                disabled={isLoading}
                                variant="outline"
                                className="h-14 text-base"
                            >
                                <PhoneOff className="w-5 h-5 ml-2" />
                                אין מענה
                            </Button>

                            <Button
                                onClick={() => handleStatusUpdate('IN_PROGRESS')}
                                disabled={isLoading}
                                variant="outline"
                                className="h-14 text-base"
                            >
                                <Clock className="w-5 h-5 ml-2" />
                                תזכורת לטיפול
                            </Button>

                            <Button
                                onClick={() => handleStatusUpdate('LOST')}
                                disabled={isLoading}
                                variant="outline"
                                className="h-14 text-base border-red-300 text-red-600 hover:bg-red-50"
                            >
                                <XCircle className="w-5 h-5 ml-2" />
                                לא מעוניין
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <p className="font-medium text-center">מתי להזכיר?</p>
                            <div className="grid grid-cols-2 gap-3">
                                <Button onClick={() => handleSnooze('1hour')} variant="outline">
                                    בעוד שעה
                                </Button>
                                <Button onClick={() => handleSnooze('later_today')} variant="outline">
                                    מאוחר יותר היום
                                </Button>
                                <Button onClick={() => handleSnooze('tomorrow')} variant="outline">
                                    מחר
                                </Button>
                                <Button onClick={() => handleSnooze('next_week')} variant="outline">
                                    שבוע הבא
                                </Button>
                            </div>
                            <Button 
                                onClick={() => setShowSnoozeOptions(false)} 
                                variant="ghost"
                                className="w-full"
                            >
                                ביטול
                            </Button>
                        </div>
                    )}

                    {/* Notes Section */}
                    <div className="space-y-3">
                        <h3 className="font-bold flex items-center gap-2">
                            <StickyNote className="w-5 h-5 text-indigo-600" />
                            הערות והיסטוריה
                        </h3>

                        {/* Add Note */}
                        <div className="flex gap-2">
                            <Textarea
                                placeholder="הוסף הערה..."
                                value={newNote}
                                onChange={(e) => setNewNote(e.target.value)}
                                className="flex-1"
                                rows={2}
                            />
                            <Button 
                                onClick={handleAddNote} 
                                disabled={!newNote.trim() || isLoading}
                                className="h-auto"
                            >
                                שמור
                            </Button>
                        </div>

                        {/* Internal Notes from Contract */}
                        {contract.internal_notes && (
                            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded">
                                <p className="text-sm text-gray-700">{contract.internal_notes}</p>
                            </div>
                        )}

                        {/* Notes List */}
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                            {notes.length === 0 ? (
                                <p className="text-sm text-gray-500 text-center py-4">אין הערות עדיין</p>
                            ) : (
                                notes.map((note) => (
                                    <div key={note.id} className="p-3 bg-gray-50 rounded border">
                                        <p className="text-sm">{note.note_text}</p>
                                        <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                                            <span>{note.agent_name}</span>
                                            <span>{formatDateTime(note.created_date)}</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}