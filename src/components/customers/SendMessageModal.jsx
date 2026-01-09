import React, { useState } from 'react';
import { sendWhatsapp } from '@/functions/sendWhatsapp';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { X, Send, Loader2, AlertTriangle } from 'lucide-react';
import { useUser } from '../UserAuth';
import { base44 } from '@/api/base44Client';
import { customersService } from "../utils/customersService";

export default function SendMessageModal({ isOpen, onClose, customer, ticketId }) {
    const [message, setMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const { currentUser } = useUser();

    const handleSend = async () => {
        if (!message.trim() || !customer?.phone) {
            setError('יש להזין תוכן להודעה ולוודא שللקוח יש מספר טלפון תקין.');
            return;
        }
        
        setIsSending(true);
        setError('');
        setSuccess('');
        
        try {
            const messageObject = {
                type: "text",
                text: { body: message },
                ticket_id: ticketId || null
            };

            const { data, error: sendError } = await sendWhatsapp({ to: customer.phone, messageObject });

            if (sendError || !data?.success) {
                // בדוק אם זה שגיאת bot.it ספציפית
                if (data?.error_type === "bot_it_error" && data?.message?.includes("No active WhatsApp instance")) {
                    setError(`⚠️ מספר הוואטסאפ במערכת אינו פעיל.\n\nלפתרון הבעיה:\n1. היכנס להגדרות המערכת\n2. עדכן את מספר הוואטסאפ הציבורי\n3. וודא שהמספר פעיל ב-bot.it\n\nההודעה לא נשלחה.`);
                } else {
                    throw new Error(data?.message || sendError?.message || "שליחת ההודעה נכשלה");
                }
                return;
            }
            
            // שמור את ההתכתבות ב-Activity
            try {
                // מצא את ה-client מתוך customer
                const clients = await base44.entities.Client.filter({ 
                    phone: customer.phone 
                });
                
                await base44.entities.Activity.create({
                    summary: `הודעת וואטסאפ ללקוח ${customer.full_name}`,
                    activity_type: "וואטסאפ יוצא",
                    content: message,
                    agent_id: currentUser?.id || null,
                    ticket_id: ticketId || null,
                    order_id: clients.length > 0 ? clients[0].id : null
                });
            } catch (activityError) {
                console.error("Failed to save activity:", activityError);
                // לא עוצרים את התהליך אם שמירת ה-Activity נכשלה
            }
            
            setSuccess('ההודעה נשלחה בהצלחה! ✅');
            setMessage('');
            
            // סגור את המודל אחרי 2 שניות
            setTimeout(() => {
                onClose();
                setSuccess('');
            }, 2000);

        } catch (e) {
            console.error("Error sending WhatsApp message:", e);
            setError(`שגיאה בשליחת ההודעה: ${e.message}`);
        } finally {
            setIsSending(false);
        }
    };

    if (!isOpen || !customer) return null;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" dir="rtl">
            <div className="glass-card w-full max-w-lg p-6 rounded-3xl">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-gray-800">שליחת וואטסאפ ל{customer.full_name}</h2>
                    <Button variant="ghost" size="icon" onClick={onClose}><X /></Button>
                </div>
                
                <div className="space-y-4">
                    <div>
                        <Label htmlFor="whatsapp-message">הודעה</Label>
                        <Textarea
                            id="whatsapp-message"
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder="כתוב את ההודעה שלך כאן..."
                            rows={5}
                            className="glass-button"
                        />
                    </div>
                    
                    {error && (
                        <Alert className="bg-red-50 border-red-200">
                            <AlertTriangle className="w-4 h-4 text-red-600" />
                            <AlertDescription className="text-red-700 whitespace-pre-line">
                                {error}
                            </AlertDescription>
                        </Alert>
                    )}
                    
                    {success && (
                        <Alert className="bg-green-50 border-green-200">
                            <AlertDescription className="text-green-700">
                                {success}
                            </AlertDescription>
                        </Alert>
                    )}
                    
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={onClose} disabled={isSending}>ביטול</Button>
                        <Button 
                            onClick={handleSend} 
                            disabled={isSending || !message.trim() || !customer?.phone} 
                            className="bg-green-600 hover:bg-green-700 text-white"
                        >
                            {isSending ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Send className="w-4 h-4 ml-2" />}
                            {isSending ? 'שולח...' : 'שלח'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}