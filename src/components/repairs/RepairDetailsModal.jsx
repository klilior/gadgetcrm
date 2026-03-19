import React, { useState, useEffect, useCallback } from 'react';
import { Repair, RepairLog, Client, RepairDevice, RepairVendor, Employee } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X, Save, Loader2, AlertTriangle, History, Trash2, User, Printer } from "lucide-react";
import { format } from 'date-fns';
import { sendWhatsapp } from "@/functions/sendWhatsapp";
import { sendTextMeSMS } from "@/functions/sendTextMeSMS";
import { useUser } from '../UserAuth';
import RepairLabel from './RepairLabel';
import RepairReceipt from './RepairReceipt';
import CustomerCard from '../customers/CustomerCard';
import SendSmsModal from '../sms/SendSmsModal';
import RepairSmsHistory from './RepairSmsHistory';

export default function RepairDetailsModal({ repair, isOpen, onClose, onUpdate }) {
    const { currentUser } = useUser();
    const [formData, setFormData] = useState({
        status: '',
        part_cost: '',
        final_price: '',
        notes: ''
    });
    const [client, setClient] = useState(null);
    const [device, setDevice] = useState(null);
    const [vendor, setVendor] = useState(null);
    const [creatingAgent, setCreatingAgent] = useState(null);
    const [logs, setLogs] = useState([]);
    const [isUpdating, setIsUpdating] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showPrintLabel, setShowPrintLabel] = useState(false);
    const [showPrintReceipt, setShowPrintReceipt] = useState(false);
    const [showCustomerCard, setShowCustomerCard] = useState(false);
    const [showSmsModal, setShowSmsModal] = useState(false);

    const loadRelatedData = useCallback(async () => {
        if (!repair) return;
        
        const safeGet = async (entity, id) => {
            if (!id) return null;
            try {
                if (!entity) {
                    console.error("safeGet was called with an undefined entity.");
                    return null;
                }
                return await entity.get(id);
            } catch (error) {
                if (error.message && (error.message.includes("not found") || error.message.includes("does not exist"))) {
                    console.warn(`Could not find record in ${entity.name || 'unknown entity'} with ID ${id}:`, error.message);
                } else {
                    console.error(`Error fetching record from ${entity.name || 'unknown entity'} with ID ${id}:`, error);
                }
                return null;
            }
        };

        const safeFilter = async (entity, filter) => {
            if (!entity || !filter) return null;
            try {
                const results = await entity.filter(filter);
                return results.length > 0 ? results[0] : null;
            } catch (error) {
                console.error(`Error filtering records from ${entity.name || 'unknown entity'}:`, error);
                return null;
            }
        };

        try {
            const [clientData, deviceData, vendorData, creatingAgentData] = await Promise.all([
                safeGet(Client, repair.client_id),
                safeGet(RepairDevice, repair.device_id),
                safeGet(RepairVendor, repair.vendor_id),
                repair.created_by ? safeFilter(Employee, { email: repair.created_by }) : null
            ]);
            
            setClient(clientData);
            setDevice(deviceData);
            setVendor(vendorData);
            setCreatingAgent(creatingAgentData);
        } catch (error) {
            console.error("A general error occurred while loading related data:", error);
        }
    }, [repair]);

    const loadLogs = useCallback(async () => {
        if (!repair) return;
        
        try {
            const repairLogs = await RepairLog.filter({ repair_id: repair.id }, "-created_date");
            setLogs(repairLogs);
        } catch (error) {
            console.error("Error loading logs:", error);
        }
    }, [repair]);

    useEffect(() => {
        if (repair && isOpen) {
            setFormData({
                status: repair.status || '',
                part_cost: repair.part_cost?.toString() || '',
                final_price: repair.final_price?.toString() || '',
                notes: ''
            });
            loadRelatedData();
            loadLogs();
        }
    }, [repair, isOpen, loadRelatedData, loadLogs]);

    const handleStatusUpdate = async () => {
        if (!formData.status) return;
        
        setIsUpdating(true);
        try {
            const updateData = {
                status: formData.status,
                part_cost: parseFloat(formData.part_cost) || repair.part_cost || 0,
                final_price: parseFloat(formData.final_price) || repair.final_price || 0
            };
            
            if (formData.status === 'הוזמן חלק' && repair.status !== 'הוזמן חלק') {
                updateData.part_ordered_date = new Date().toISOString();
            }
            
            // אם זה טכנאי והתיקון עדיין לא משויך, שייך אותו
            if (currentUser.role === 'טכנאי' && !repair.technician_id) {
                updateData.technician_id = currentUser.id;
            }

            await Repair.update(repair.id, updateData);

            await RepairLog.create({
                repair_id: repair.id,
                actor_user_id: currentUser.id,
                action: `עדכון סטטוס ל-${formData.status}`,
                details: formData.notes || `סטטוס עודכן ל-${formData.status} על ידי ${currentUser.employee_name}`
            });

            if (client?.full_name && client?.phone) {
                let message = null;
                switch (formData.status) {
                    case 'מכשיר סיים תיקון וממתין לאיסוף':
                        message = `שלום ${client.full_name}, תיקון #${repair.repair_id} הושלם בהצלחה! המכשיר שלך מוכן לאיסוף.`;
                        if (updateData.final_price > 0) {
                            message += ` סכום לתשלום: ${updateData.final_price} ש"ח.`;
                        }
                        message += ` ניתן לאסוף מהמעבדה בשעות העבודה. א'-ה' 9:00-18:00, ו' 9:00-13:00. Gadget-Team`;
                        break;
                    case 'בטיפול/אבחון':
                        message = `שלום ${client.full_name}, המכשיר שלך התקבל במעבדה לטיפול (תיקון #${repair.repair_id}). נעדכן אותך בהמשך התהליך. Gadget-Team`;
                        break;
                    case 'בטיפול החנות':
                        message = `שלום ${client.full_name}, המכשיר שלך התקבל לטיפול בחנות (תיקון #${repair.repair_id}). נעדכן אותך בהמשך התהליך. Gadget-Team`;
                        break;
                    case 'הוזמן חלק':
                        message = `שלום ${client.full_name}, עבור תיקון #${repair.repair_id} - הוזמן חלק ספציפי. נעדכן כשהחלק יגיע למעבדה. תודה על הסבלנות! Gadget-Team`;
                        break;
                    case 'לא ניתן לתיקון':
                        message = `שלום ${client.full_name}, לאחר בדיקה מעמיקה, לצערנו לא ניתן לתקן את המכשיר (תיקון #${repair.repair_id}). נציג ייצור עמך קשר בקרוב. Gadget-Team`;
                        break;
                    case 'תיקון נסגר':
                        message = `שלום ${client.full_name}, תיקון #${repair.repair_id} הושלם בהצלחה! תודה שבחרת בנו! Gadget-Team`;
                        break;
                }

                if (message) {
                    try {
                        const res = await sendTextMeSMS({
                            action: "send",
                            to_phone: client.phone,
                            message,
                            event_type: `repair_status_${formData.status}`,
                            fingerprint: `repair|${repair.id}|${formData.status}`,
                        });
                        const data = res.data || res;
                        console.log(data.success ? `✅ SMS sent for status "${formData.status}"` : `⚠️ SMS not sent: ${data.error}`);
                    } catch (err) {
                        console.error(`❌ SMS error for repair ${repair.repair_id}:`, err.message);
                    }
                }
            } else {
                console.warn(`⚠️ No client data for SMS - repair ${repair.repair_id}`);
            }
            
            onUpdate();
            setFormData({ ...formData, notes: '' });
            loadLogs();
        } catch (error) {
            console.error("Error updating repair:", error);
        } finally {
            setIsUpdating(false);
        }
    };

    const handleDeleteRepair = async () => {
        setIsDeleting(true);
        try {
            const repairLogs = await RepairLog.filter({ repair_id: repair.id });
            for (const log of repairLogs) {
                await RepairLog.delete(log.id);
            }
            
            await Repair.delete(repair.id);
            
            onUpdate();
            onClose();
        } catch (error) {
            console.error("Error deleting repair:", error);
            alert("שגיאה במחיקת התיקון. נסה שוב.");
        } finally {
            setIsDeleting(false);
            setShowDeleteConfirm(false);
        }
    };

    const canUpdateStatus = () => {
        return ['טכנאי', 'נציג', 'מנהל', 'מנהל משמרת'].includes(currentUser?.role);
    };

    const canDelete = () => {
        return currentUser?.role === 'מנהל';
    };

    if (!isOpen || !repair) return null;

    return (
        <>
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" dir="rtl">
                <div className="glass-card w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl">
                    <div className="sticky top-0 bg-white/90 backdrop-blur-sm p-6 border-b border-white/20 flex justify-between items-center">
                        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                            פרטי תיקון #{repair.repair_id}
                        </h2>
                        <div className="flex gap-2">
                            <Button
                                size="sm"
                                onClick={() => setShowPrintReceipt(true)}
                                className="bg-green-600 hover:bg-green-700 text-white"
                            >
                                <Printer className="w-4 h-4 ml-2" />
                                אישור קבלה
                            </Button>
                            <Button
                                size="sm"
                                onClick={() => setShowPrintLabel(true)}
                                className="bg-blue-600 hover:bg-blue-700 text-white"
                            >
                                <Printer className="w-4 h-4 ml-2" />
                                הדפס מדבקה
                            </Button>
                            {canDelete() && (
                                <Button
                                    size="sm"
                                    onClick={() => setShowDeleteConfirm(true)}
                                    className="bg-red-600 hover:bg-red-700 text-white"
                                >
                                    <Trash2 className="w-4 h-4 ml-2" />
                                    מחק תיקון
                                </Button>
                            )}
                            <Button variant="ghost" size="icon" onClick={onClose}>
                                <X className="w-5 h-5" />
                            </Button>
                        </div>
                    </div>

                    <div className="p-6 space-y-6">
                        {/* Basic Info */}
                        <div className="grid md:grid-cols-2 gap-6">
                            <Card className="glass-card">
                                <CardHeader>
                                    <CardTitle className="text-lg">פרטי לקוח ומכשיר</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    {client && (
                                        <div className="flex items-center justify-between p-2 rounded-lg hover:bg-blue-50 transition-colors">
                                            <div 
                                                className="cursor-pointer flex-1"
                                                onClick={() => setShowCustomerCard(true)}
                                            >
                                                <Label className="font-semibold">לקוח:</Label>
                                                <p className="text-blue-600 hover:underline">
                                                    {client.full_name} • {client.phone}
                                                </p>
                                            </div>
                                            {client.phone && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => setShowSmsModal(true)}
                                                    className="text-teal-700 border-teal-300 hover:bg-teal-50 gap-1 text-xs"
                                                >
                                                    SMS
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                    {device && (
                                        <div>
                                            <Label className="font-semibold">מכשיר:</Label>
                                            <p>{device.manufacturer} {device.model} ({device.color})</p>
                                            <p className="text-sm text-gray-600">סידורי: {device.serial_imei}</p>
                                        </div>
                                    )}
                                    <div>
                                        <Label className="font-semibold">בעיה:</Label>
                                        <p>{repair.issue_category} - {repair.issue_description}</p>
                                    </div>
                                    <div>
                                        <Label className="font-semibold">קוד נעילה:</Label>
                                        <p>{repair.lock_code}</p>
                                    </div>
                                    {creatingAgent && (
                                        <div>
                                            <Label className="font-semibold">נציג מכניס:</Label>
                                            <div className="flex items-center gap-2 text-gray-700">
                                                <User className="w-4 h-4" />
                                                <span>{creatingAgent.employee_name}</span>
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            <Card className="glass-card">
                                <CardHeader>
                                    <CardTitle className="text-lg">סטטוס ומחירים</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div>
                                        <Label className="font-semibold">סטטוס נוכחי:</Label>
                                        <Badge className="mr-2">{repair.status}</Badge>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <Label className="font-semibold">מחיר צפוי:</Label>
                                            <p>₪{repair.expected_price || 0}</p>
                                        </div>
                                        <div>
                                            <Label className="font-semibold">מחיר סופי:</Label>
                                            <p>₪{repair.final_price || 0}</p>
                                        </div>
                                    </div>
                                    <div>
                                        <Label className="font-semibold">עלות חלקים:</Label>
                                        <p>₪{repair.part_cost || 0}</p>
                                    </div>
                                    {repair.repair_type && (
                                        <div>
                                            <Label className="font-semibold">סוג תיקון:</Label>
                                            <p>{repair.repair_type}</p>
                                        </div>
                                    )}
                                    {vendor && (
                                        <div>
                                            <Label className="font-semibold">יבואן/מעבדה:</Label>
                                            <p>{vendor.name}</p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>

                        {/* Status Update Form - עבור טכנאים, נציגים ומנהלים */}
                        {canUpdateStatus() && (
                            <Card className="glass-card">
                                <CardHeader>
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        עדכון תיקון
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="grid md:grid-cols-3 gap-4">
                                        <div>
                                            <Label>סטטוס חדש</Label>
                                            <Select value={formData.status} onValueChange={(value) => setFormData({...formData, status: value})}>
                                                <SelectTrigger className="glass-button">
                                                    <SelectValue placeholder="בחר סטטוס..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="בטיפול/אבחון">בטיפול/אבחון</SelectItem>
                                                    <SelectItem value="הוזמן חלק">הוזמן חלק</SelectItem>
                                                    <SelectItem value="מכשיר סיים תיקון וממתין לאיסוף">מכשיר סיים תיקון וממתין לאיסוף</SelectItem>
                                                    <SelectItem value="לא ניתן לתיקון">לא ניתן לתיקון</SelectItem>
                                                    <SelectItem value="תיקון נסגר">תיקון נסגר</SelectItem>
                                                    <SelectItem value="At_Importer">אצל היבואן</SelectItem>
                                                    
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div>
                                            <Label>עלות חלקים (₪)</Label>
                                            <Input
                                                type="number"
                                                value={formData.part_cost}
                                                onChange={(e) => setFormData({...formData, part_cost: e.target.value})}
                                                className="glass-button"
                                                placeholder="0"
                                            />
                                        </div>
                                        <div>
                                            <Label>מחיר סופי (₪)</Label>
                                            <Input
                                                type="number"
                                                value={formData.final_price}
                                                onChange={(e) => setFormData({...formData, final_price: e.target.value})}
                                                className="glass-button"
                                                placeholder="0"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <Label>הערות לעדכון</Label>
                                        <Textarea
                                            value={formData.notes}
                                            onChange={(e) => setFormData({...formData, notes: e.target.value})}
                                            className="glass-button"
                                            placeholder="הערות נוספות על העדכון..."
                                            rows={3}
                                        />
                                    </div>
                                    <Button 
                                        onClick={handleStatusUpdate}
                                        disabled={isUpdating || !formData.status}
                                        className="bg-blue-600 hover:bg-blue-700 text-white"
                                    >
                                        {isUpdating ? (
                                            <>
                                                <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                                                מעדכן...
                                            </>
                                        ) : (
                                            <>
                                                <Save className="w-4 h-4 ml-2" />
                                                עדכן תיקון
                                            </>
                                        )}
                                    </Button>
                                </CardContent>
                            </Card>
                        )}

                        {/* SMS History */}
                        {client?.phone && repair?.id && (
                            <Card className="glass-card">
                                <CardContent className="pt-4">
                                    <RepairSmsHistory repairId={repair.id} clientPhone={client.phone} />
                                </CardContent>
                            </Card>
                        )}

                        {/* Activity Log */}
                        <Card className="glass-card">
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <History className="w-5 h-5" />
                                    היסטוריית פעולות
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3 max-h-64 overflow-y-auto">
                                    {logs.length === 0 ? (
                                        <p className="text-gray-600 text-center py-4">אין פעולות להצגה</p>
                                    ) : (
                                        logs.map((log) => (
                                            <div key={log.id} className="glass-card p-3 rounded-lg border border-white/20">
                                                <div className="flex justify-between items-start mb-1">
                                                    <span className="font-medium text-gray-800">{log.action}</span>
                                                    <span className="text-xs text-gray-500">
                                                        {format(new Date(log.created_date), "dd/MM HH:mm")}
                                                    </span>
                                                </div>
                                                {log.details && (
                                                    <p className="text-sm text-gray-600">{log.details}</p>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>

                {/* Delete Confirmation Modal */}
                {showDeleteConfirm && (
                    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-60">
                        <div className="glass-card p-6 rounded-2xl max-w-md w-full mx-4">
                            <div className="flex items-center gap-3 mb-4">
                                <AlertTriangle className="w-8 h-8 text-red-500" />
                                <h3 className="text-xl font-bold text-gray-800">אישור מחיקה</h3>
                            </div>
                            <div className="mb-6">
                                <p className="text-gray-700 mb-2">
                                    האם אתה בטוח שברצונך למחוק את התיקון #{repair.repair_id}?
                                </p>
                                <p className="text-red-600 text-sm font-medium">
                                    פעולה זו בלתי הפיכה ותמחק את כל ההיסטוריה של התיקון!
                                </p>
                            </div>
                            <div className="flex justify-end gap-3">
                                <Button 
                                    variant="outline" 
                                    onClick={() => setShowDeleteConfirm(false)}
                                    disabled={isDeleting}
                                >
                                    ביטול
                                </Button>
                                <Button
                                    onClick={handleDeleteRepair}
                                    disabled={isDeleting}
                                    className="bg-red-600 hover:bg-red-700 text-white"
                                >
                                    {isDeleting ? (
                                        <>
                                            <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                                            מוחק...
                                        </>
                                    ) : (
                                        <>
                                            <Trash2 className="w-4 h-4 ml-2" />
                                            מחק תיקון
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {showPrintLabel && (
                <RepairLabel
                    repair={repair}
                    client={client}
                    device={device}
                    vendor={vendor}
                    agent={creatingAgent}
                    isOpen={showPrintLabel}
                    onClose={() => setShowPrintLabel(false)}
                />
            )}

            {showPrintReceipt && (
                <RepairReceipt
                    repair={repair}
                    client={client}
                    device={device}
                    agent={creatingAgent}
                    isOpen={showPrintReceipt}
                    onClose={() => setShowPrintReceipt(false)}
                />
            )}

            {showCustomerCard && client && (
                <CustomerCard
                    customerId={client.id}
                    isOpen={showCustomerCard}
                    onClose={() => setShowCustomerCard(false)}
                    onEdit={() => {}}
                />
            )}

            <SendSmsModal
                isOpen={showSmsModal}
                onClose={() => setShowSmsModal(false)}
                phone={client?.phone}
                customerName={client?.full_name}
                context={{
                    repair_id: repair?.repair_id,
                    status: repair?.status,
                    device: device ? `${device.manufacturer} ${device.model}` : "",
                    final_price: repair?.final_price?.toString() || "",
                }}
            />
        </>
    );
}