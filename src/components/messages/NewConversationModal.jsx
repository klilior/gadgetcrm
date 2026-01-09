import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Search, Phone, User, Plus } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { customersService } from "../utils/customersService";

export default function NewConversationModal({ isOpen, onClose, onConversationCreated, customers }) {
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedMode, setSelectedMode] = useState("select"); // "select" or "new"
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [newPhone, setNewPhone] = useState("");
    const [newName, setNewName] = useState("");
    const [isCreating, setIsCreating] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setSearchTerm("");
            setSelectedMode("select");
            setSelectedCustomer(null);
            setNewPhone("");
            setNewName("");
        }
    }, [isOpen]);

    const filteredCustomers = customers.filter(c => 
        c.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.phone?.includes(searchTerm) ||
        c.email?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const normalizePhone = (phone) => {
        let cleaned = phone.replace(/\D/g, '');
        // Handle international format: 972... -> 05...
        if (cleaned.startsWith('972')) {
            cleaned = '0' + cleaned.substring(3);
        }
        // Handle missing leading zero: 5... -> 05...
        if (cleaned.length === 9 && cleaned[0] === '5') {
            cleaned = '0' + cleaned;
        }
        return cleaned;
    };

    const handleStartConversation = async () => {
        if (selectedMode === "select" && !selectedCustomer) {
            alert("אנא בחר לקוח");
            return;
        }
        
        if (selectedMode === "new" && !newPhone) {
            alert("אנא הזן מספר טלפון");
            return;
        }
        
        setIsCreating(true);
        try {
            let customer;

            if (selectedMode === "select") {
                customer = selectedCustomer;
            } else if (selectedMode === "new") {
                const normalizedPhone = normalizePhone(newPhone);

                // Check if customer exists
                const existing = await customersService.findByPhone(normalizedPhone);

                if (existing) {
                    customer = existing;
                } else {
                    // Create new customer
                    customer = await customersService.create({
                        full_name: newName || normalizedPhone,
                        phone: normalizedPhone,
                        preferred_channel: 'whatsapp'
                    });
                }
                }

                // Create or get conversation
                const existingConvs = await base44.entities.Conversation.filter({
                customer_id: customer.id
                });

                if (existingConvs.length === 0) {
                await base44.entities.Conversation.create({
                    customer_id: customer.id,
                    last_message: 'שיחה נפתחה ידנית',
                    last_message_date: new Date().toISOString(),
                    last_channel: 'whatsapp',
                    unread_count: 0,
                    status: 'פתוח'
                });
                }

                // Create initial activity
                await base44.entities.Activity.create({
                summary: `שיחה חדשה עם ${customer.full_name}`,
                activity_type: 'הערה',
                content: 'שיחה נפתחה ידנית - ערוץ WhatsApp',
                order_id: customer.id
                });

                onConversationCreated(customer);
        } catch (error) {
            console.error("Error starting conversation:", error);
            alert("שגיאה בפתיחת שיחה: " + error.message);
            setIsCreating(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" dir="rtl">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-6 flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-white">שיחה חדשה</h2>
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={onClose} 
                        className="text-white hover:bg-white/20"
                    >
                        <X className="w-5 h-5" />
                    </Button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Mode Selection */}
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={() => setSelectedMode("select")}
                            className={`p-4 rounded-xl border-2 transition-all ${
                                selectedMode === "select"
                                    ? "border-blue-500 bg-blue-50"
                                    : "border-gray-200 hover:border-gray-300"
                            }`}
                        >
                            <User className="w-6 h-6 mx-auto mb-2 text-blue-600" />
                            <p className="font-semibold">בחר לקוח קיים</p>
                        </button>
                        <button
                            onClick={() => setSelectedMode("new")}
                            className={`p-4 rounded-xl border-2 transition-all ${
                                selectedMode === "new"
                                    ? "border-blue-500 bg-blue-50"
                                    : "border-gray-200 hover:border-gray-300"
                            }`}
                        >
                            <Plus className="w-6 h-6 mx-auto mb-2 text-purple-600" />
                            <p className="font-semibold">מספר חדש</p>
                        </button>
                    </div>

                    {/* Select Customer Mode */}
                    {selectedMode === "select" && (
                        <div className="space-y-4">
                            <div className="relative">
                                <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <Input
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="חפש לפי שם, טלפון או אימייל..."
                                    className="pr-10"
                                />
                            </div>

                            <div className="border rounded-xl max-h-[400px] overflow-y-auto">
                                {filteredCustomers.length > 0 ? (
                                    filteredCustomers.map(customer => (
                                        <div
                                            key={customer.id}
                                            onClick={() => setSelectedCustomer(customer)}
                                            className={`p-4 border-b cursor-pointer transition-colors ${
                                                selectedCustomer?.id === customer.id
                                                    ? "bg-blue-50 border-blue-200"
                                                    : "hover:bg-gray-50"
                                            }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="font-semibold text-gray-900">
                                                        {customer.full_name}
                                                    </p>
                                                    <div className="flex gap-3 mt-1">
                                                        {customer.phone && (
                                                            <span className="text-sm text-gray-600 flex items-center gap-1">
                                                                <Phone className="w-3 h-3" />
                                                                {customer.phone}
                                                            </span>
                                                        )}
                                                        {customer.email && (
                                                            <span className="text-sm text-gray-500">
                                                                {customer.email}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                {selectedCustomer?.id === customer.id && (
                                                    <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                                                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                        </svg>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="p-8 text-center text-gray-500">
                                        <User className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                                        <p>לא נמצאו לקוחות</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* New Phone Mode */}
                    {selectedMode === "new" && (
                        <div className="space-y-4">
                            <div>
                                <Label>מספר טלפון *</Label>
                                <div className="relative">
                                    <Phone className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                                    <Input
                                        value={newPhone}
                                        onChange={(e) => setNewPhone(e.target.value)}
                                        placeholder="05X-XXXXXXX"
                                        className="pr-10"
                                        dir="ltr"
                                    />
                                </div>
                            </div>
                            <div>
                                <Label>שם (אופציונלי)</Label>
                                <Input
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    placeholder="שם הלקוח"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    אם לא יוזן שם, ישמר מספר הטלפון
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex justify-end gap-3 pt-4 border-t">
                        <Button 
                            variant="outline" 
                            onClick={onClose}
                            disabled={isCreating}
                        >
                            ביטול
                        </Button>
                        <Button
                            onClick={handleStartConversation}
                            disabled={isCreating || (selectedMode === "select" && !selectedCustomer) || (selectedMode === "new" && !newPhone)}
                            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                        >
                            {isCreating ? "פותח שיחה..." : "פתח שיחה"}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}