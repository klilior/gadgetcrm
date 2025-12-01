import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
// import { sendWhatsapp } from "@/functions/sendWhatsapp"; // This import is no longer used after the update
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageCircle, Send, Loader2, AlertTriangle, ArrowRightLeft, StickyNote, BellPlus, Mail, Phone, Paperclip, Image, FileText, Video, Mic, XCircle, Download, User, Clock, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import { useUser } from "../UserAuth";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CustomerInfoCard from "../customers/CustomerInfoCard";
import EditCustomerModal from '../customers/EditCustomerModal';
import CustomerCard from '../customers/CustomerCard';

const retryApiCall = async (fn, retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            console.log(`⚠️ Attempt ${i + 1} failed:`, error.message);
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
        }
    }
};

export default function TicketDetails({ ticket, customer, employees, key, onTicketUpdate }) {
    const [activities, setActivities] = useState([]);
    const [predefinedResponses, setPredefinedResponses] = useState([]);
    const [messageDraft, setMessageDraft] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [sendError, setSendError] = useState(null);
    const [isLoadingActivities, setIsLoadingActivities] = useState(false);
    const [newAssignee, setNewAssignee] = useState(ticket?.assigned_to || "");
    const [showInternalNote, setShowInternalNote] = useState(false);
    const [internalNoteText, setInternalNoteText] = useState("");
    const [reminderText, setReminderText] = useState("");
    const [reminderDate, setReminderDate] = useState("");
    const [reminderTime, setReminderTime] = useState("");
    const [transferSuccess, setTransferSuccess] = useState("");
    const [reminderSuccess, setReminderSuccess] = useState("");
    const [showEscalationModal, setShowEscalationModal] = useState(false);
    const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
    const [closeReason, setCloseReason] = useState("");
    const [escalationReason, setEscalationReason] = useState("");
    const [isEscalating, setIsEscalating] = useState(false);
    const { currentUser } = useUser();
    const [selectedFile, setSelectedFile] = useState(null);
    const [filePreview, setFilePreview] = useState(null);
    const [isEditCustomerModalOpen, setIsEditCustomerModalOpen] = useState(false);
    const [clientData, setClientData] = useState(customer);
    const [showCustomerCard, setShowCustomerCard] = useState(false);
    const [activeChannel, setActiveChannel] = useState("whatsapp");

    useEffect(() => {
        if (ticket?.id) {
            console.log('🔄 [TicketDetails] Loading activities for ticket:', ticket.id);
            loadActivities(ticket.id);
            
            const interval = setInterval(() => {
                console.log('⏰ [TicketDetails] Auto-refresh activities');
                loadActivities(ticket.id, true);
            }, 3000); // Reduced to 3 seconds for faster updates
            
            return () => clearInterval(interval);
        }
    }, [ticket?.id]);

    const loadActivities = async (ticketId, silent = false) => {
        if (!silent) setIsLoadingActivities(true);
        
        try {
            console.log(`📡 [TicketDetails] Fetching activities for ticket ${ticketId}...`);
            const data = await retryApiCall(() => 
                base44.entities.Activity.filter(
                    { ticket_id: ticketId },
                    '-created_date',
                    100
                )
            );
            
            console.log(`✅ [TicketDetails] Loaded ${data.length} activities:`, data.map(a => ({
                id: a.id,
                type: a.activity_type,
                content: a.content?.substring(0, 30)
            })));
            setActivities(data);
            if (!silent) setSendError(null);
        } catch (error) {
            console.error('❌ [TicketDetails] Error loading activities:', error);
            if (!silent) {
                setSendError('שגיאה בטעינת ההודעות');
            }
        } finally {
            if (!silent) setIsLoadingActivities(false);
        }
    };

    useEffect(() => {
        loadPredefinedResponses();
    }, []);

    const loadPredefinedResponses = async () => {
        try {
            const responses = await retryApiCall(() => 
                base44.entities.PredefinedResponse.filter({ is_active: true })
            );
            setPredefinedResponses(responses);
        } catch (error) {
            console.error('Error loading predefined responses:', error);
        }
    };

    const handleAddInternalNote = async () => {
        if (!internalNoteText.trim()) return;
        
        try {
            await retryApiCall(() => base44.entities.Activity.create({
                content: internalNoteText,
                ticket_id: ticket.id,
                activity_type: 'הערה',
                summary: `הערה פנימית נוספה על ידי ${currentUser?.employee_name || 'אנונימי'}`,
                agent_id: currentUser?.id
            }));
            
            setInternalNoteText("");
            setShowInternalNote(false);
            loadActivities(ticket.id);
        } catch (error) {
            console.error("Error adding internal note:", error);
            setSendError("שגיאה בהוספת הערה פנימית.");
        }
    };

    const handleCloseTicket = async () => {
        if (!closeReason) {
            alert("יש לבחור סיבת סגירה.");
            return;
        }
        
        try {
            await retryApiCall(() => base44.entities.Ticket.update(ticket.id, {
                status: closeReason,
                closed_date: new Date().toISOString()
            }));

            await retryApiCall(() => base44.entities.Activity.create({
                content: `הטיקט נסגר. סיבה: ${closeReason}`,
                ticket_id: ticket.id,
                activity_type: 'שינוי סטטוס',
                summary: `הטיקט נסגר על ידי ${currentUser?.employee_name}`,
                agent_id: currentUser?.id
            }));
            
            setIsCloseModalOpen(false);
            onTicketUpdate();
            loadActivities(ticket.id);
        } catch (error) {
            console.error("Error closing ticket:", error);
            alert("שגיאה בסגירת הטיקט.");
        }
    };

    const handleSetReminder = async () => {
        if (!reminderText.trim() || !reminderDate || !reminderTime) {
            alert("נא למלא את תוכן התזכורת, ולבחור תאריך ושעה.");
            return;
        }

        try {
            const combinedDateTimeString = `${reminderDate}T${reminderTime}:00`;
            const assignedAgentId = newAssignee || ticket.assigned_to;

            await retryApiCall(() => base44.entities.Task.create({
                title: reminderText,
                due_date: combinedDateTimeString,
                ticket_id: ticket.id,
                assigned_to_id: assignedAgentId,
                status: 'pending'
            }));

            const displayDate = new Date(combinedDateTimeString);
            await retryApiCall(() => base44.entities.Activity.create({
                content: `תזכורת נקבעה לתאריך ${format(displayDate, 'dd/MM/yyyy')} בשעה ${format(displayDate, 'HH:mm')}: "${reminderText}"`,
                ticket_id: ticket.id,
                activity_type: 'תזכורת',
                summary: 'תזכורת נקבעה לטיפול',
                agent_id: currentUser?.id
            }));

            setReminderSuccess(`תזכורת נקבעה בהצלחה ל-${format(displayDate, 'dd/MM/yy HH:mm')}`);
            setTimeout(() => setReminderSuccess(""), 5000);

            setReminderText("");
            setReminderDate("");
            setReminderTime("");
            loadActivities(ticket.id);

        } catch (error) {
            console.error("שגיאה ביצירת תזכורת:", error);
            alert("שגיאה ביצירת התזכורת. נסה שוב.");
        }
    };

    const setQuickReminder = (type) => {
        const israelTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
        let targetTime = new Date(israelTime);

        switch (type) {
            case "2hours":
                targetTime.setHours(targetTime.getHours() + 2);
                setReminderText("חזרה ללקוח בעוד שעתיים");
                break;
            case "tomorrow":
                targetTime.setDate(targetTime.getDate() + 1);
                targetTime.setHours(9, 0, 0, 0);
                setReminderText("חזרה ללקוח מחר בבוקר");
                break;
            case "nextweek":
                targetTime.setDate(targetTime.getDate() + 7);
                targetTime.setHours(9, 0, 0, 0);
                setReminderText("מעקב שבועי עם הלקוח");
                break;
            default:
                break;
        }

        const year = targetTime.getFullYear();
        const month = String(targetTime.getMonth() + 1).padStart(2, '0');
        const day = String(targetTime.getDate()).padStart(2, '0');
        const hours = String(targetTime.getHours()).padStart(2, '0');
        const minutes = String(targetTime.getMinutes()).padStart(2, '0');

        setReminderDate(`${year}-${month}-${day}`);
        setReminderTime(`${hours}:${minutes}`);
    };

    const handleFileSelect = (event) => {
        const file = event.target.files[0];
        if (file) {
            setSelectedFile(file);
            
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => setFilePreview(e.target.result);
                reader.readAsDataURL(file);
            } else {
                setFilePreview(null);
            }
        }
    };

    const handleSendMessage = async () => {
        if ((!messageDraft.trim() && !selectedFile) || !clientData) {
            alert("נא להזין תוכן להודעה או לצרף קובץ.");
            return;
        }
        
        setIsSending(true);
        setSendError(null);
        
        try {
            if (activeChannel === 'whatsapp') {
                await handleSendWhatsApp();
            } else if (activeChannel === 'email') {
                await handleSendEmail();
            }
        } catch (error) {
            console.error("❌ [TicketDetails] Error sending message:", error);
            setSendError(error.message);
        } finally {
            setIsSending(false);
        }
    };

    const handleSendWhatsApp = async () => {
        if (!clientData?.phone) {
            throw new Error("מספר טלפון של הלקוח אינו זמין");
        }

        console.log('📤 [TicketDetails] Starting WhatsApp send to:', clientData.phone);

        let uploadedFileUrl = null;
        
        if (selectedFile) {
            console.log('📎 [TicketDetails] Uploading file:', selectedFile.name);
            try {
                const { file_url } = await base44.integrations.Core.UploadFile({ file: selectedFile });
                
                if (!file_url) {
                    throw new Error("שגיאה בהעלאת הקובץ");
                }
                
                uploadedFileUrl = file_url;
                console.log('✅ [TicketDetails] File uploaded:', uploadedFileUrl);
            } catch (uploadError) {
                console.error('❌ [TicketDetails] Upload error:', uploadError);
                throw new Error(`שגיאה בהעלאת הקובץ: ${uploadError.message}`);
            }
        }
        
        let messageObject;
        
        if (uploadedFileUrl) {
            const fileType = selectedFile.type;
            
            if (fileType.startsWith('image/')) {
                messageObject = {
                    type: "image",
                    image: { link: uploadedFileUrl, caption: messageDraft || "" },
                    ticket_id: ticket.id
                };
            } else if (fileType.startsWith('audio/')) {
                messageObject = {
                    type: "audio",
                    audio: { link: uploadedFileUrl },
                    ticket_id: ticket.id
                };
            } else if (fileType.startsWith('video/')) {
                messageObject = {
                    type: "video",
                    video: { link: uploadedFileUrl, caption: messageDraft || "" },
                    ticket_id: ticket.id
                };
            } else {
                messageObject = {
                    type: "document",
                    document: { link: uploadedFileUrl, filename: selectedFile.name, caption: messageDraft || "" },
                    ticket_id: ticket.id
                };
            }
        } else {
            messageObject = {
                type: "text",
                text: { body: messageDraft },
                ticket_id: ticket.id
            };
        }

        console.log('📦 [TicketDetails] Message object:', messageObject);
        console.log('🌐 [TicketDetails] Calling sendWhatsapp function...');

        try {
            const response = await base44.functions.invoke('sendWhatsapp', {
                to: clientData.phone,
                messageObject
            });

            console.log('📡 [TicketDetails] Response:', response);

            if (!response?.data) {
                throw new Error("לא התקבלה תשובה מהשרת");
            }

            if (!response.data.success) {
                throw new Error(response.data.message || "שגיאה בשליחת ההודעה");
            }

            console.log('✅ [TicketDetails] Message sent successfully, clearing form...');

            setMessageDraft("");
            setSelectedFile(null);
            setFilePreview(null);
            
            console.log('⏳ [TicketDetails] Waiting 2 seconds before refreshing activities...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            console.log('🔄 [TicketDetails] Refreshing activities now...');
            await loadActivities(ticket.id);
            await onTicketUpdate();
            
        } catch (error) {
            console.error('❌ [TicketDetails] Send error:', error);
            throw new Error(error.response?.data?.message || error.message || "שגיאה בשליחת ההודעה");
        }
    };

    const handleSendEmail = async () => {
        let attachmentUrls = [];
        
        if (selectedFile) {
            try {
                const { file_url } = await base44.integrations.Core.UploadFile({ file: selectedFile });
                
                if (!file_url) {
                    throw new Error("שגיאה בהעלאת הקובץ");
                }
                
                attachmentUrls.push(file_url);
            } catch (uploadError) {
                throw new Error(`שגיאה בהעלאת הקובץ: ${uploadError.message}`);
            }
        }

        const { data } = await retryApiCall(() => base44.functions.invoke('sendEmail', {
            to: clientData?.email || 'no-email@example.com',
            subject: `[T#${ticket.ticket_number}] ${ticket.subject}`,
            body: messageDraft,
            ticketId: ticket.id,
            attachments: attachmentUrls
        }));

        if (!data?.success) {
            throw new Error(data?.error || "Failed to send email");
        }

        await retryApiCall(() => base44.entities.Ticket.update(ticket.id, {
            status: "ממתין ללקוח",
            last_channel: "email"
        }));

        setMessageDraft("");
        setSelectedFile(null);
        setFilePreview(null);
        loadActivities(ticket.id);
        onTicketUpdate();
    };

    const handleTransfer = async () => {
        if (!newAssignee || newAssignee === ticket.assigned_to) return;

        const selectedAgent = employees.find(emp => emp.id === newAssignee);
        try {
            await retryApiCall(() => base44.entities.Ticket.update(ticket.id, { assigned_to: newAssignee }));

            await retryApiCall(() => base44.entities.Activity.create({
                content: `הטיקט הועבר לטיפול של ${selectedAgent?.employee_name || 'נציג אחר'}`,
                ticket_id: ticket.id,
                activity_type: 'העברת טיפול',
                summary: `הועבר ל-${selectedAgent?.employee_name}`,
                agent_id: currentUser?.id
            }));

            setTransferSuccess(`הטיפול הועבר ל-${selectedAgent?.employee_name || 'הנציג החדש'}`);
            setTimeout(() => setTransferSuccess(""), 3000);
            onTicketUpdate();
            loadActivities(ticket.id);
        } catch (error) {
            console.error("Error transferring ticket:", error);
            alert("שגיאה בהעברת הטיפול.");
        }
    };

    const handleEscalate = () => {
        setShowEscalationModal(true);
    };

    const handleConfirmEscalation = async () => {
        if (!escalationReason.trim()) {
            alert("נא להסביר את סיבת ההסלמה");
            return;
        }

        setIsEscalating(true);
        try {
            const manager = employees.find(e => e.employee_name === "ליאור כהן");
            if (!manager) {
                alert("לא נמצא מנהל להסלמה");
                setIsEscalating(false);
                return;
            }

            await retryApiCall(() => base44.entities.Ticket.update(ticket.id, {
                assigned_to: manager.id,
                priority: "דחוף",
                status: "בטיפול"
            }));

            await retryApiCall(() => base44.entities.Activity.create({
                content: `הסלמה למנהל: ${escalationReason}`,
                ticket_id: ticket.id,
                activity_type: 'הסלמה דחופה',
                summary: `הוסלם למנהל עם הסבר: ${escalationReason}`,
                agent_id: currentUser?.id
            }));

            await retryApiCall(() => base44.entities.Task.create({
                title: `הסלמה דחופה: ${ticket.subject} מאת ${currentUser?.employee_name || 'נציג לא ידוע'}`,
                due_date: new Date().toISOString(),
                assigned_to_id: manager.id,
                ticket_id: ticket.id,
                status: 'pending'
            }));

            try {
                const notificationMessage = `🚨 הסלמה דחופה למנהל\n\n` +
                    `📋 טיקט: #${ticket.ticket_number || 'לא ידוע'}\n` +
                    `👤 לקוח: ${clientData?.full_name || 'לא ידוע'}\n` +
                    `🔄 מאת: ${currentUser?.employee_name || 'לא ידוע'}\n\n` +
                    `📝 סיבת הסלמה:\n${escalationReason}\n\n` +
                    `⏰ זמן הסלמה: ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}\n\n` +
                    `נא להיכנס למערכת לטיפול מיידי.`;

                const { data: notificationData } = await retryApiCall(() => base44.functions.invoke('sendWhatsapp', {
                    to: manager.phone,
                    messageObject: {
                        type: "text",
                        text: { body: notificationMessage },
                        ticket_id: ticket.id
                    }
                }));

                if (!notificationData.success) {
                    console.error("Failed to send WhatsApp notification to manager:", notificationData.message);
                }
            } catch (whatsappError) {
                console.error("Failed to send WhatsApp notification:", whatsappError);
            }

            setShowEscalationModal(false);
            setEscalationReason("");
            onTicketUpdate();
            loadActivities(ticket.id);
            
            alert(`הטיקט הועבר בהצלחה למנהל ${manager.employee_name}`);

        } catch (error) {
            console.error("Escalation failed:", error);
            alert("שגיאה בהסלמה. נסה שוב.");
        } finally {
            setIsEscalating(false);
        }
    };

    const formatTime = (dateString) => {
        if (!dateString) return "";
        try {
            return format(new Date(dateString), "HH:mm");
        } catch {
            return "";
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return "";
        try {
            const date = new Date(dateString);
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            
            if (date.toDateString() === today.toDateString()) {
                return "היום";
            } else if (date.toDateString() === yesterday.toDateString()) {
                return "אתמול";
            } else {
                return format(date, "dd/MM/yyyy");
            }
        } catch {
            return "";
        }
    };

    const getCategoryLabel = () => {
        const subject = ticket?.subject || '';
        const inquiryType = ticket?.inquiry_type || '';
        
        if (subject.includes('תיקון') || inquiryType.includes('תיקון')) return 'תיקון';
        if (subject.includes('מכירה') || inquiryType.includes('מכירה') || inquiryType.includes('ליד')) return 'מכירות';
        return 'שירות';
    };

    const handleCustomerSave = async () => {
        setIsEditCustomerModalOpen(false);
        onTicketUpdate();
    };

    if (!ticket) {
        return null;
    }

    const category = getCategoryLabel();

    return (
        <>
            <div className="flex flex-col lg:flex-row gap-4 h-full">
                {/* עמודה ראשית - צ'אט */}
                <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-lg overflow-hidden">
                    {/* כותרת */}
                    <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-4">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                                <MessageCircle className="w-6 h-6" />
                                <div>
                                    <h3 className="text-lg font-bold">שיחה #{ticket.ticket_number}</h3>
                                    <p className="text-sm opacity-90">{ticket.subject}</p>
                                </div>
                            </div>
                            <Button 
                                onClick={() => setIsCloseModalOpen(true)}
                                className="bg-white/20 hover:bg-white/30 text-white border-0"
                                size="sm"
                            >
                                <CheckCircle className="w-4 h-4 ml-2" />
                                סגור
                            </Button>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                            <Badge className={`${
                                category === 'מכירות' ? 'bg-green-400' :
                                category === 'תיקון' ? 'bg-orange-400' :
                                'bg-blue-400'
                            } text-white border-0`}>
                                {category}
                            </Badge>
                            <span className="opacity-90">•</span>
                            <span>{ticket.inquiry_type || 'שירות כללי'}</span>
                            {ticket.tags && ticket.tags.length > 0 && (
                                <>
                                    <span className="opacity-90">•</span>
                                    <div className="flex gap-1">
                                        {ticket.tags.map(tag => (
                                            <span key={tag} className="bg-white/20 px-1.5 rounded text-xs">{tag}</span>
                                        ))}
                                    </div>
                                </>
                            )}
                            </div>
                            </div>

                    {/* אזור ההודעות */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-slate-50 to-white" style={{ maxHeight: '500px' }}>
                        {isLoadingActivities && activities.length === 0 ? (
                            <div className="text-center text-gray-500 py-12">
                                <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-blue-500" />
                                <p>טוען הודעות...</p>
                            </div>
                        ) : activities.length === 0 ? (
                            <div className="text-center text-gray-500 py-12">
                                <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
                                <p>השיחה מתחילה כאן...</p>
                                <p className="text-xs mt-2">הודעות שיגיעו יופיעו כאן אוטומטית</p>
                            </div>
                        ) : (
                            activities.map((activity, index) => {
                                const isAgent = activity.activity_type?.includes('יוצא') || activity.activity_type === 'הערה';
                                const isInternal = activity.activity_type === 'הערה';
                                const isSystem = activity.activity_type?.includes('טיפול') || 
                                               activity.activity_type?.includes('סטטוס') || 
                                               activity.activity_type === 'תזכורת' ||
                                               activity.activity_type === 'התראת הסלמה' ||
                                               activity.activity_type === 'הסלמה דחופה' ||
                                               activity.activity_type === 'העברת טיפול';
                                
                                const showDate = index === 0 || 
                                    formatDate(activity.created_date) !== formatDate(activities[index - 1]?.created_date);

                                return (
                                    <React.Fragment key={activity.id}>
                                        {showDate && (
                                            <div className="flex justify-center my-4">
                                                <span className="bg-slate-200 text-slate-600 px-3 py-1 rounded-full text-xs font-medium">
                                                    {formatDate(activity.created_date)}
                                                </span>
                                            </div>
                                        )}
                                        
                                        {isSystem ? (
                                            <div className="flex justify-center my-2">
                                                <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2 rounded-full text-xs max-w-md text-center">
                                                    <Clock className="w-3 h-3 inline ml-1" />
                                                    {activity.content || '[אין תוכן]'}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className={`flex ${isAgent ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`max-w-[75%] ${isAgent ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                                                    <div className={`rounded-2xl px-4 py-2 ${
                                                        isInternal ? 'bg-yellow-50 border-2 border-yellow-300 border-dashed' :
                                                        isAgent ? 'bg-gradient-to-br from-purple-500 to-indigo-600 text-white' :
                                                        'bg-white border border-slate-200 shadow-sm'
                                                    }`}>
                                                        {isInternal && (
                                                            <div className="flex items-center gap-1 text-yellow-700 text-xs font-medium mb-1">
                                                                <StickyNote className="w-3 h-3" />
                                                                הערה פנימית
                                                            </div>
                                                        )}
                                                        <p className={`text-sm ${isAgent && !isInternal ? 'text-white' : 'text-slate-800'} whitespace-pre-wrap leading-relaxed`}>
                                                            {activity.content || '[אין תוכן להצגה]'}
                                                        </p>
                                                        {activity.attachments && activity.attachments.length > 0 && (
                                                            <div className="mt-2 space-y-1">
                                                                {activity.attachments.map((url, i) => (
                                                                    <a 
                                                                        key={i}
                                                                        href={url} 
                                                                        target="_blank" 
                                                                        rel="noopener noreferrer"
                                                                        className={`flex items-center gap-2 text-xs ${isAgent && !isInternal ? 'text-white/90 hover:text-white' : 'text-blue-600 hover:text-blue-800'} underline`}
                                                                    >
                                                                        <Paperclip className="w-3 h-3" />
                                                                        {url.split('/').pop() || 'קובץ מצורף'}
                                                                    </a>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <span className="text-xs text-slate-500 px-2">
                                                        {formatTime(activity.created_date)}
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                    </React.Fragment>
                                );
                            })
                        )}
                    </div>

                    {/* טופס שליחה */}
                    <div className="border-t bg-white p-4">
                        {sendError && (
                            <div className="mb-3 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
                                {sendError}
                            </div>
                        )}
                        
                        <div className="flex gap-2 mb-3">
                            <Button
                                variant={activeChannel === 'whatsapp' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setActiveChannel('whatsapp')}
                                className={activeChannel === 'whatsapp' ? 'bg-green-600 hover:bg-green-700' : ''}
                            >
                                <MessageCircle className="w-4 h-4 ml-1" />
                                וואטסאפ
                            </Button>
                            <Button
                                variant={activeChannel === 'email' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setActiveChannel('email')}
                                className={activeChannel === 'email' ? 'bg-blue-600 hover:bg-blue-700' : ''}
                            >
                                <Mail className="w-4 h-4 ml-1" />
                                מייל
                            </Button>
                        </div>

                        <div className="space-y-2">
                            <Select onValueChange={(id) => {
                                const response = predefinedResponses.find(r => r.id === id);
                                if (response) setMessageDraft(response.content);
                            }}>
                                <SelectTrigger className="text-sm bg-slate-50">
                                    <SelectValue placeholder="בחר תשובה מוכנה..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {predefinedResponses.map((res) => (
                                        <SelectItem key={res.id} value={res.id}>{res.response_name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Textarea
                                value={messageDraft}
                                onChange={(e) => setMessageDraft(e.target.value)}
                                placeholder="הקלד הודעה..."
                                rows={3}
                                className="resize-none"
                            />

                            {selectedFile && (
                                <div className="flex items-center gap-2 p-2 bg-slate-100 rounded-lg text-sm">
                                    <Paperclip className="w-4 h-4 text-slate-500" />
                                    <span className="flex-1 truncate">{selectedFile.name}</span>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-6 w-6"
                                        onClick={() => {
                                            setSelectedFile(null);
                                            setFilePreview(null);
                                        }}
                                    >
                                        <XCircle className="w-4 h-4" />
                                    </Button>
                                </div>
                            )}

                            <div className="flex gap-2">
                                <label className="cursor-pointer">
                                    <input type="file" className="hidden" onChange={handleFileSelect} />
                                    <div className="flex items-center gap-2 px-3 py-2 border rounded-lg hover:bg-slate-50 transition-colors">
                                        <Paperclip className="w-4 h-4" />
                                        <span className="text-sm">צרף קובץ</span>
                                    </div>
                                </label>
                                
                                <Button
                                    onClick={handleSendMessage}
                                    disabled={isSending || (!messageDraft.trim() && !selectedFile)}
                                    className="flex-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
                                >
                                    {isSending ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Send className="w-4 h-4 ml-2" />}
                                    שלח
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* עמודה צדדית - פרטים ופעולות */}
                <div className="lg:w-80 space-y-4">
                    {/* פרטי לקוח */}
                    {clientData && (
                        <div onClick={() => setShowCustomerCard(true)} className="cursor-pointer">
                            <CustomerInfoCard customer={clientData} onEdit={() => setIsEditCustomerModalOpen(true)} />
                        </div>
                    )}

                    {/* פעולות */}
                    <Card className="bg-white shadow-lg">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg">פעולות</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {/* הערה פנימית */}
                            {!showInternalNote ? (
                                <Button
                                    onClick={() => setShowInternalNote(true)}
                                    variant="outline"
                                    className="w-full justify-start"
                                >
                                    <StickyNote className="w-4 h-4 ml-2" />
                                    הוסף הערה פנימית
                                </Button>
                            ) : (
                                <div className="space-y-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                                    <div className="flex items-center gap-2 text-yellow-700 font-medium text-sm">
                                        <StickyNote className="w-4 h-4" />
                                        הערה פנימית
                                    </div>
                                    <Textarea
                                        value={internalNoteText}
                                        onChange={(e) => setInternalNoteText(e.target.value)}
                                        placeholder="רק נציגים יראו את זה..."
                                        rows={2}
                                        className="text-sm"
                                    />
                                    <div className="flex gap-2">
                                        <Button onClick={handleAddInternalNote} size="sm" className="flex-1">
                                            <CheckCircle className="w-3 h-3 ml-1" />
                                            שמור
                                        </Button>
                                        <Button onClick={() => {
                                            setShowInternalNote(false);
                                            setInternalNoteText("");
                                        }} variant="outline" size="sm">
                                            ביטול
                                        </Button>
                                    </div>
                                </div>
                            )}

                            <hr className="border-slate-200" />

                            {/* תזכורת */}
                            <div className="space-y-2">
                                <div className="text-sm font-medium text-slate-700 flex items-center gap-2">
                                    <BellPlus className="w-4 h-4" />
                                    תזכורת
                                </div>
                                <div className="flex gap-1">
                                    <Button type="button" variant="outline" size="sm" onClick={() => setQuickReminder("2hours")} className="flex-1 text-xs">
                                        בעוד 2 שעות
                                    </Button>
                                    <Button type="button" variant="outline" size="sm" onClick={() => setQuickReminder("tomorrow")} className="flex-1 text-xs">
                                        מחר
                                    </Button>
                                    <Button type="button" variant="outline" size="sm" onClick={() => setQuickReminder("nextweek")} className="flex-1 text-xs">
                                        שבוע
                                    </Button>
                                </div>
                                <Input
                                    value={reminderText}
                                    onChange={(e) => setReminderText(e.target.value)}
                                    placeholder="תוכן התזכורת..."
                                    className="text-sm"
                                />
                                <div className="grid grid-cols-2 gap-2">
                                    <Input
                                        type="date"
                                        value={reminderDate}
                                        onChange={(e) => setReminderDate(e.target.value)}
                                        className="text-sm"
                                    />
                                    <Input
                                        type="time"
                                        value={reminderTime}
                                        onChange={(e) => setReminderTime(e.target.value)}
                                        className="text-sm"
                                    />
                                </div>
                                <Button onClick={handleSetReminder} size="sm" className="w-full bg-purple-600 hover:bg-purple-700">
                                    <BellPlus className="w-3 h-3 ml-1" />
                                    קבע תזכורת
                                </Button>
                                {reminderSuccess && (
                                    <p className="text-xs text-green-600 text-center">{reminderSuccess}</p>
                                )}
                            </div>

                            <hr className="border-slate-200" />

                            {/* העברת טיפול */}
                            <div className="space-y-2">
                                <div className="text-sm font-medium text-slate-700 flex items-center gap-2">
                                    <ArrowRightLeft className="w-4 h-4" />
                                    העברת טיפול
                                </div>
                                <Select value={newAssignee} onValueChange={setNewAssignee}>
                                    <SelectTrigger className="text-sm">
                                        <SelectValue placeholder="בחר נציג..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {employees.map((emp) => (
                                            <SelectItem key={emp.id} value={emp.id}>{emp.employee_name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button
                                    onClick={handleTransfer}
                                    disabled={!newAssignee || newAssignee === ticket.assigned_to}
                                    size="sm"
                                    className="w-full bg-indigo-600 hover:bg-indigo-700"
                                >
                                    <ArrowRightLeft className="w-3 h-3 ml-1" />
                                    העבר
                                </Button>
                                {transferSuccess && (
                                    <p className="text-xs text-green-600 text-center">{transferSuccess}</p>
                                )}
                            </div>

                            <hr className="border-slate-200" />

                            {/* הסלמה */}
                            <Button
                                onClick={handleEscalate}
                                variant="destructive"
                                size="sm"
                                className="w-full"
                            >
                                <AlertTriangle className="w-4 h-4 ml-2" />
                                הסלמה למנהל
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Modals */}
            {showEscalationModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" dir="rtl">
                    <div className="bg-white w-full max-w-lg p-6 rounded-3xl m-4">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-red-600 flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5"/>
                                הסלמה דחופה למנהל
                            </h3>
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => {
                                    setShowEscalationModal(false);
                                    setEscalationReason("");
                                }}
                            >
                                ✕
                            </Button>
                        </div>
                        
                        <div className="space-y-4">
                            <div className="bg-red-50 p-4 rounded-xl border border-red-200">
                                <p className="text-sm text-red-800 text-center">
                                    הטיקט יועבר למנהל ויקבל עדיפות דחופה.
                                </p>
                            </div>
                            
                            <Textarea
                                value={escalationReason}
                                onChange={(e) => setEscalationReason(e.target.value)}
                                placeholder="הסבר למנהל את סיבת ההסלמה..."
                                rows={4}
                                required
                            />
                            
                            <div className="flex justify-end gap-3 pt-2">
                                <Button 
                                    variant="outline" 
                                    onClick={() => {
                                        setShowEscalationModal(false);
                                        setEscalationReason("");
                                    }}
                                    disabled={isEscalating}
                                >
                                    ביטול
                                </Button>
                                <Button
                                    onClick={handleConfirmEscalation}
                                    disabled={isEscalating || !escalationReason.trim()}
                                    className="bg-red-600 hover:bg-red-700 text-white"
                                >
                                    {isEscalating ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            מבצע הסלמה...
                                        </>
                                    ) : (
                                        <>
                                            <AlertTriangle className="w-4 h-4 mr-2"/>
                                            בצע הסלמה
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {isCloseModalOpen && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" dir="rtl">
                    <div className="bg-white w-full max-w-md p-6 rounded-3xl m-4">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-gray-800">
                                סגירת טיקט #{ticket.ticket_number}
                            </h3>
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => setIsCloseModalOpen(false)}
                            >
                                <XCircle />
                            </Button>
                        </div>
                        
                        <div className="space-y-4">
                            <p className="text-sm text-gray-600">
                                נא לבחור את סיבת הסגירה.
                            </p>
                            
                            <Select onValueChange={setCloseReason} value={closeReason}>
                                <SelectTrigger>
                                    <SelectValue placeholder="בחר סיבת סגירה..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="נסגר">הטיפול הושלם בהצלחה</SelectItem>
                                    <SelectItem value="נסגר ללא מענה">נסגר עקב חוסר מענה מהלקוח</SelectItem>
                                </SelectContent>
                            </Select>
                            
                            <div className="flex justify-end gap-3 pt-2">
                                <Button 
                                    variant="outline" 
                                    onClick={() => setIsCloseModalOpen(false)}
                                >
                                    ביטול
                                </Button>
                                <Button
                                    onClick={handleCloseTicket}
                                    disabled={!closeReason}
                                    className="bg-green-600 hover:bg-green-700 text-white"
                                >
                                    <CheckCircle className="w-4 h-4 ml-2"/>
                                    אשר סגירה
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <EditCustomerModal
                isOpen={isEditCustomerModalOpen}
                onClose={() => setIsEditCustomerModalOpen(false)}
                customer={clientData}
                onSave={handleCustomerSave}
            />

            {showCustomerCard && clientData && (
                <CustomerCard
                    customerId={clientData.id}
                    isOpen={showCustomerCard}
                    onClose={() => setShowCustomerCard(false)}
                    onEdit={() => {}}
                />
            )}
        </>
    );
}