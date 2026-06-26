import React, { useState, useEffect } from 'react';
import { Ticket } from '@/entities/all';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Loader2 } from 'lucide-react';
import { useUser } from '../UserAuth';
import { base44 } from "@/api/base44Client";

function normalizePhone(phone) {
    if (!phone) return "";
    let s = phone.replace(/\s|-/g, "").replace(/^\+/, "");
    if (/^0\d{9}$/.test(s)) {
        s = "972" + s.slice(1);
    }
    return s;
}

export default function NewTicketModal({ isOpen, onClose, onTicketCreated, initialClient }) {
  const [clientDetails, setClientDetails] = useState({ full_name: '', phone: '', email: '' });
  const [ticketDetails, setTicketDetails] = useState({ subject: '', inquiry_type: '', description: '' });
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState('');
  const { currentUser } = useUser();

  useEffect(() => {
    if (isOpen) {
      setTicketDetails({ subject: '', inquiry_type: '', description: '' });
      if (initialClient) {
        setClientDetails({
          full_name: initialClient.full_name || '',
          phone: initialClient.phone || '',
          email: initialClient.email || ''
        });
      } else {
        setClientDetails({ full_name: '', phone: '', email: '' });
      }
      setMessage('');
    }
  }, [isOpen, initialClient]);

  const handleCreateTicket = async () => {
    alert('יצירת טיקטים מוקפאת כרגע.');
    return;

    if (!clientDetails.full_name || !ticketDetails.inquiry_type || !ticketDetails.subject) {
        alert("יש למלא שם לקוח, נושא וסוג פנייה.");
        return;
    }

    setIsCreating(true);
    setMessage('');

    try {
        // Use findOrCreateClient function to prevent duplicates
        const normalizedPhone = normalizePhone(clientDetails.phone);
        const normalizedEmail = clientDetails.email?.toLowerCase().trim() || '';
        
        setMessage('מאמת לקוח...');
        
        const { data: clientResponse, error: clientError } = await base44.functions.invoke('findOrCreateClient', {
            phone: normalizedPhone || undefined,
            full_name: clientDetails.full_name,
            email: normalizedEmail || undefined,
            preferred_channel: 'phone'
        });

        if (clientError) {
            throw new Error(clientError.message || 'שגיאה באימות לקוח');
        }

        const client = clientResponse.client;
        
        if (clientResponse.isNew) {
            setMessage('✅ לקוח חדש נוצר');
        } else {
            setMessage('✅ לקוח קיים נמצא במערכת');
        }

        // Get the highest ticket number and add 1
        setMessage('יוצר טיקט...');
        const lastTickets = await Ticket.filter({}, "-ticket_number", 1);
        const newTicketNumber = (lastTickets[0]?.ticket_number || 1000) + 1;

        const newTicket = await Ticket.create({
          ...ticketDetails,
          ticket_number: newTicketNumber,
          customer_id: client.id,
          customer_name: client.full_name,
          customer_phone: client.phone,
          customer_email: client.email,
          status: 'חדש',
          priority: 'בינונית',
          assigned_to: currentUser?.id,
          contact_channel: 'in_person'
        });
        
        setMessage('✅ טיקט נוצר בהצלחה!');

        // Send automatic acknowledgment if phone exists
        try {
            if (client.phone) {
                const ackMessage = `שלום ${client.full_name},\n\nתודה על פנייתך! 🙏\n\nקיבלנו את הפנייה שלך ומספר הטיקט שלך הוא: #${newTicketNumber}\n\nנחזור אליך בהקדם.\n\nצוות Gadget`;
                
                await base44.functions.invoke('sendWhatsapp', {
                    to: client.phone,
                    messageObject: {
                        type: "text",
                        text: { body: ackMessage },
                        ticket_id: newTicket.id
                    }
                });
            }
        } catch (ackError) {
            console.error('Failed to send acknowledgment:', ackError);
        }
        
        setTimeout(() => {
            onTicketCreated();
            onClose();
        }, 1000);
        
    } catch (error) {
        console.error("Error creating ticket:", error);
        setMessage('❌ שגיאה: ' + error.message);
    } finally {
        setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" dir="rtl">
      <div className="glass-card w-full max-w-2xl p-8 rounded-3xl m-4">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-800">יצירת טיקט חדש</h2>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={isCreating}><X /></Button>
        </div>
        
        {message && (
            <div className={`mb-4 p-3 rounded-lg text-center font-medium ${
                message.includes('❌') ? 'bg-red-100 text-red-800' :
                message.includes('✅') ? 'bg-green-100 text-green-800' :
                'bg-blue-100 text-blue-800'
            }`}>
                {message}
            </div>
        )}
        
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold mb-4">פרטי הלקוח</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <Label>שם מלא *</Label>
                        <Input 
                            value={clientDetails.full_name} 
                            onChange={e => setClientDetails({...clientDetails, full_name: e.target.value})} 
                            className="glass-button"
                            disabled={isCreating}
                        />
                    </div>
                    <div>
                        <Label>טלפון</Label>
                        <Input 
                            value={clientDetails.phone} 
                            onChange={e => setClientDetails({...clientDetails, phone: e.target.value})} 
                            className="glass-button"
                            disabled={isCreating}
                        />
                    </div>
                </div>
                 <div className="mt-4">
                     <Label>דוא"ל</Label>
                     <Input 
                         type="email" 
                         value={clientDetails.email} 
                         onChange={e => setClientDetails({...clientDetails, email: e.target.value})} 
                         className="glass-button"
                         disabled={isCreating}
                     />
                 </div>
            </div>

            <hr className="border-white/30"/>

            <div>
                <h3 className="text-lg font-semibold mb-4">פרטי הטיקט</h3>
                <div className="space-y-4">
                    <div>
                        <Label>נושא *</Label>
                        <Input 
                            value={ticketDetails.subject} 
                            onChange={e => setTicketDetails({...ticketDetails, subject: e.target.value})} 
                            className="glass-button"
                            disabled={isCreating}
                        />
                    </div>

                    <div>
                        <Label>סוג פנייה *</Label>
                        <Select 
                            onValueChange={value => setTicketDetails({...ticketDetails, inquiry_type: value})}
                            disabled={isCreating}
                        >
                            <SelectTrigger className="glass-button">
                                <SelectValue placeholder="בחר סוג פנייה..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="חקירת מכירה">חקירת מכירה</SelectItem>
                                <SelectItem value="שירות לקוחות">שירות לקוחות</SelectItem>
                                <SelectItem value="שירות תיקונים במעבדה">שירות תיקונים במעבדה</SelectItem>
                                <SelectItem value="שירות ואחריות">שירות ואחריות</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                     <div>
                        <Label>תיאור</Label>
                        <Textarea 
                            value={ticketDetails.description} 
                            onChange={e => setTicketDetails({...ticketDetails, description: e.target.value})} 
                            className="glass-button"
                            disabled={isCreating}
                        />
                    </div>
                </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
                <Button variant="ghost" onClick={onClose} disabled={isCreating}>ביטול</Button>
                <Button 
                    onClick={handleCreateTicket} 
                    className="glass-button bg-gray-100 text-gray-500"
                    disabled={true}
                >
                    יצירת טיקטים מוקפאת
                </Button>
            </div>
        </div>
      </div>
    </div>
  );
}