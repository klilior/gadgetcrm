import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Send, Phone, Mail, MessageSquare, Paperclip, X, Ticket, ShoppingCart, StickyNote, Trash2, MoreVertical, User, CreditCard } from "lucide-react";
import { format } from "date-fns";
import { base44 } from "@/api/base44Client";
import CustomerCard from "../customers/CustomerCard";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export default function ChatView({ conversation, customer, messages, onMessageSent, currentUser }) {
    const [showCustomerCard, setShowCustomerCard] = useState(false);
    const [newMessage, setNewMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [isInternalNote, setIsInternalNote] = useState(false);
    const [showActions, setShowActions] = useState(false);
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Auto-refresh: scroll to bottom when new messages arrive
    useEffect(() => {
        if (messages.length > 0) {
            const timer = setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [messages.length]);

    // Mark messages as read when conversation opens
    useEffect(() => {
        if (conversation?.id && messages.length > 0) {
            markAsRead();
        }
    }, [conversation?.id, messages.length]);

    const markAsRead = async () => {
        try {
            const unreadMessages = messages.filter(m => 
                m.activity_type?.includes('נכנס') && 
                (!m.read_by || !m.read_by.includes(currentUser?.id))
            );

            if (unreadMessages.length === 0) return;

            for (const msg of unreadMessages) {
                const readBy = msg.read_by || [];
                if (!readBy.includes(currentUser?.id)) {
                    await base44.entities.Activity.update(msg.id, {
                        read_by: [...readBy, currentUser.id]
                    });
                }
            }

            onMessageSent?.();
        } catch (error) {
            console.error('Error marking as read:', error);
        }
    };

    const handleFileSelect = (e) => {
        const files = Array.from(e.target.files || []);
        setSelectedFiles(prev => [...prev, ...files]);
    };

    const removeFile = (index) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleCreateTicket = async (inquiryType) => {
        try {
            const allTickets = await base44.entities.Ticket.list('-ticket_number', 1);
            const nextTicketNumber = (allTickets[0]?.ticket_number || 1000) + 1;

            const ticket = await base44.entities.Ticket.create({
                subject: `${inquiryType} - ${customer.full_name}`,
                ticket_number: nextTicketNumber,
                customer_id: customer.id,
                customer_name: customer.full_name,
                customer_phone: customer.phone,
                customer_email: customer.email,
                inquiry_type: inquiryType,
                status: 'חדש',
                priority: 'בינונית',
                assigned_to: currentUser?.id,
                contact_channel: conversation.last_channel || 'whatsapp',
                last_channel: conversation.last_channel || 'whatsapp'
            });

            await base44.entities.Activity.create({
                summary: `טיקט נוצר מתוך שיחה`,
                activity_type: 'הערה',
                content: `נוצר טיקט #${nextTicketNumber} - ${inquiryType}`,
                order_id: customer.id,
                ticket_id: ticket.id,
                agent_id: currentUser?.id
            });

            alert(`✅ טיקט #${nextTicketNumber} נוצר בהצלחה!`);
            onMessageSent?.();
        } catch (error) {
            console.error('Error creating ticket:', error);
            alert('שגיאה ביצירת טיקט');
        }
    };

    const handleDeleteConversation = async () => {
        if (!confirm('האם אתה בטוח שברצונך למחוק את השיחה? פעולה זו תמחק את כל ההודעות.')) return;
        
        try {
            // Delete all activities for this customer
            const customerActivities = messages;
            for (const activity of customerActivities) {
                await base44.entities.Activity.delete(activity.id);
            }
            
            alert('✅ השיחה נמחקה בהצלחה');
            onMessageSent?.();
        } catch (error) {
            console.error('Error deleting conversation:', error);
            alert('שגיאה במחיקת השיחה');
        }
    };

    const handleSend = async () => {
        if (!newMessage.trim() && selectedFiles.length === 0) return;
        
        setIsSending(true);
        try {
            // If internal note, just create activity
            if (isInternalNote) {
                await base44.entities.Activity.create({
                    summary: `הערה פנימית`,
                    activity_type: 'הערה',
                    content: newMessage,
                    agent_id: currentUser?.id,
                    order_id: customer.id
                });

                setNewMessage('');
                setSelectedFiles([]);
                setIsInternalNote(false);
                onMessageSent?.();
                setIsSending(false);
                return;
            }

            const channel = conversation.last_channel || 'whatsapp';
            
            // Upload files if any
            const fileUrls = [];
            for (const file of selectedFiles) {
                const formData = new FormData();
                formData.append('file', file);
                const { file_url } = await base44.integrations.Core.UploadFile({ file });
                fileUrls.push(file_url);
            }

            // Send via appropriate channel
            if (channel === 'whatsapp') {
                let messageObject;
                
                if (fileUrls.length > 0) {
                    const fileUrl = fileUrls[0];
                    const fileType = selectedFiles[0].type;
                    
                    if (fileType.startsWith('image/')) {
                        messageObject = {
                            type: "image",
                            image: { link: fileUrl, caption: newMessage || "" }
                        };
                    } else if (fileType.startsWith('video/')) {
                        messageObject = {
                            type: "video",
                            video: { link: fileUrl, caption: newMessage || "" }
                        };
                    } else if (fileType.startsWith('audio/')) {
                        messageObject = {
                            type: "audio",
                            audio: { link: fileUrl }
                        };
                    } else {
                        messageObject = {
                            type: "document",
                            document: { link: fileUrl, filename: selectedFiles[0].name, caption: newMessage || "" }
                        };
                    }
                } else {
                    messageObject = {
                        type: "text",
                        text: { body: newMessage }
                    };
                }
                
                await base44.functions.invoke('sendWhatsapp', { 
                    to: customer.phone, 
                    messageObject 
                });
            } else if (channel === 'email') {
                await base44.integrations.Core.SendEmail({
                    to: customer.email,
                    subject: `תגובה מ-${currentUser?.employee_name}`,
                    body: newMessage
                });
            }

            // Create activity record
            await base44.entities.Activity.create({
                summary: `הודעה ל-${customer.full_name}`,
                activity_type: channel === 'whatsapp' ? 'וואטסאפ יוצא' : 
                               channel === 'email' ? 'מייל יוצא' : 'שיחה יוצאת',
                content: newMessage,
                agent_id: currentUser?.id,
                order_id: customer.id,
                attachments: fileUrls
            });

            // Refresh messages
            await new Promise(resolve => setTimeout(resolve, 1000));

            setNewMessage('');
            setSelectedFiles([]);
            setIsInternalNote(false);
            onMessageSent?.();

        } catch (error) {
            console.error('Error sending message:', error);
            alert('שגיאה בשליחת ההודעה');
        } finally {
            setIsSending(false);
        }
    };

    if (!conversation) {
        return (
            <div className="h-full flex items-center justify-center text-gray-500">
                <div className="text-center">
                    <MessageSquare className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <p>בחר שיחה כדי להתחיל</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b p-4 flex items-center justify-between">
                <div 
                    className="cursor-pointer hover:bg-gray-50 p-2 rounded-lg transition-colors"
                    onClick={() => setShowCustomerCard(true)}
                >
                    <h3 className="font-bold text-lg flex items-center gap-2">
                        <User className="w-5 h-5 text-blue-600" />
                        {customer?.full_name || 'לקוח'}
                    </h3>
                    <p className="text-sm text-gray-600">{customer?.phone || customer?.email}</p>
                </div>
                <div className="flex items-center gap-2">
                    {conversation.tags?.map(tag => (
                        <Badge key={tag} variant="outline" className="text-xs">
                            {tag}
                        </Badge>
                    ))}
                    
                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => handleCreateTicket('שירות לקוחות')}
                        className="hidden md:flex gap-2 bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100"
                    >
                        <Ticket className="w-4 h-4" />
                        פתח טיקט
                    </Button>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                                <MoreVertical className="w-5 h-5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem onClick={() => handleCreateTicket('שירות לקוחות')}>
                                <Ticket className="w-4 h-4 ml-2" />
                                פתח טיקט שירות
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleCreateTicket('חקירת מכירה')}>
                                <ShoppingCart className="w-4 h-4 ml-2" />
                                פתח טיקט מכירה
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                                onClick={handleDeleteConversation}
                                className="text-red-600 focus:text-red-600"
                            >
                                <Trash2 className="w-4 h-4 ml-2" />
                                מחק שיחה
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map(msg => {
                    const isIncoming = msg.activity_type?.includes('נכנס');
                    const isInternalNote = msg.activity_type === 'הערה';
                    const isUnread = isIncoming && (!msg.read_by || !msg.read_by.includes(currentUser?.id));
                    const agentName = msg.agent_id ? window.employees?.find(e => e.id === msg.agent_id)?.employee_name : null;
                    
                    // Internal notes - yellow background
                    if (isInternalNote) {
                        return (
                            <div key={msg.id} className="flex justify-center">
                                <div className="max-w-[80%] bg-yellow-50 border-2 border-yellow-300 rounded-xl px-4 py-2">
                                    <div className="flex items-center gap-2 mb-1">
                                        <StickyNote className="w-4 h-4 text-yellow-700" />
                                        <span className="text-xs font-semibold text-yellow-700">הערה פנימית</span>
                                        {agentName && (
                                            <span className="text-xs text-yellow-600">• {agentName}</span>
                                        )}
                                    </div>
                                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{msg.content}</p>
                                    <div className="text-xs text-yellow-600 mt-1">
                                        {format(new Date(msg.created_date), 'HH:mm dd/MM')}
                                    </div>
                                </div>
                            </div>
                        );
                    }
                    
                    return (
                        <div
                            key={msg.id}
                            className={`flex ${isIncoming ? 'justify-start' : 'justify-end'}`}
                        >
                            <div className="max-w-[70%]">
                                {!isIncoming && agentName && (
                                    <div className="text-xs text-gray-500 mb-1 flex items-center gap-1 justify-end">
                                        <User className="w-3 h-3" />
                                        {agentName}
                                    </div>
                                )}
                                <div className={`rounded-2xl px-4 py-2 ${
                                    isIncoming 
                                        ? `bg-white border ${isUnread ? 'border-blue-500 shadow-lg' : 'border-gray-200'}` 
                                        : msg.activity_type?.includes('וואטסאפ') 
                                            ? 'bg-green-600 text-white' 
                                            : msg.activity_type?.includes('מייל')
                                                ? 'bg-purple-600 text-white'
                                                : 'bg-blue-600 text-white'
                                }`}>
                                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                                    {msg.attachments && msg.attachments.length > 0 && (
                                        <div className="mt-2 space-y-1">
                                            {msg.attachments.map((url, i) => (
                                                <a key={i} href={url} target="_blank" className="text-xs underline block">
                                                    קובץ מצורף {i + 1}
                                                </a>
                                            ))}
                                        </div>
                                    )}
                                    <div className={`text-xs mt-1 ${isIncoming ? 'text-gray-500' : 'text-white/80'}`}>
                                        {format(new Date(msg.created_date), 'HH:mm')}
                                        {isUnread && <Badge className="mr-2 bg-red-500 text-white text-xs">חדש</Badge>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            {/* Customer Card Modal */}
            {showCustomerCard && customer && (
                <CustomerCard
                    customer={customer}
                    onClose={() => setShowCustomerCard(false)}
                />
            )}

            {/* Input */}
            <div className="bg-white border-t p-4">
                {isInternalNote && (
                    <div className="mb-2 bg-yellow-50 border border-yellow-300 rounded-lg p-2 flex items-center gap-2">
                        <StickyNote className="w-4 h-4 text-yellow-700" />
                        <span className="text-sm font-semibold text-yellow-700">מצב הערה פנימית</span>
                        <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => setIsInternalNote(false)}
                            className="mr-auto text-xs"
                        >
                            ביטול
                        </Button>
                    </div>
                )}
                {selectedFiles.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                        {selectedFiles.map((file, i) => (
                            <div key={i} className="bg-gray-100 rounded px-3 py-1 flex items-center gap-2 text-sm">
                                <Paperclip className="w-3 h-3" />
                                {file.name}
                                <X className="w-3 h-3 cursor-pointer" onClick={() => removeFile(i)} />
                            </div>
                        ))}
                    </div>
                )}
                <div className="flex gap-2">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        className="hidden"
                        multiple
                    />
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => fileInputRef.current?.click()}
                        title="צרף קובץ"
                    >
                        <Paperclip className="w-4 h-4" />
                    </Button>
                    <Button
                        variant={isInternalNote ? "default" : "outline"}
                        size="icon"
                        onClick={() => setIsInternalNote(!isInternalNote)}
                        title="הערה פנימית"
                        className={isInternalNote ? "bg-yellow-500 hover:bg-yellow-600" : ""}
                    >
                        <StickyNote className="w-4 h-4" />
                    </Button>
                    <Textarea
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder={isInternalNote ? "כתוב הערה פנימית..." : "כתוב הודעה..."}
                        className={`flex-1 min-h-[60px] max-h-[120px] ${isInternalNote ? 'border-yellow-300 focus:border-yellow-500' : ''}`}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                    />
                    <Button
                        onClick={handleSend}
                        disabled={isSending || (!newMessage.trim() && selectedFiles.length === 0)}
                        className={isInternalNote ? "bg-yellow-500 hover:bg-yellow-600" : "bg-green-600 hover:bg-green-700"}
                    >
                        <Send className="w-4 h-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}