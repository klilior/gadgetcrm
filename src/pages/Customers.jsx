import React, { useState, useEffect } from "react";
import { customersService } from "../components/utils/customersService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, User, Phone, Mail, MessageCircle, MapPin, Plus, Trash2, AlertTriangle, Loader2, PlusCircle, Trophy, Star, Medal, Award, Sparkles, BarChart3, RefreshCw } from "lucide-react";
import EditCustomerModal from "../components/customers/EditCustomerModal";
import SendMessageModal from "../components/customers/SendMessageModal";
import CustomerCard from "../components/customers/CustomerCard";
import CustomerScoreBadge from "../components/customers/CustomerScoreBadge";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { calculateCustomerScore } from "@/functions/calculateCustomerScore";

export default function CustomersPage() {
    const { currentUser } = useUser();
    const navigate = useNavigate();
    const [clients, setClients] = useState([]);
    const [filteredClients, setFilteredClients] = useState([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [selectedClient, setSelectedClient] = useState(null);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showMessageModal, setShowMessageModal] = useState(false);
    const [clientForMessage, setClientForMessage] = useState(null);
    const [isCleaningDuplicates, setIsCleaningDuplicates] = useState(false);
    const [cleanupResult, setCleanupResult] = useState(null);
    const [showCustomerCard, setShowCustomerCard] = useState(false);
    const [selectedCustomerForCard, setSelectedCustomerForCard] = useState(null);
    const [isScoring, setIsScoring] = useState(false);
    const [sortBy, setSortBy] = useState('name'); // name | score | spent

    const isManager = currentUser?.role === "מנהל";

    useEffect(() => {
        loadClients();
        // Handle openCard URL param (from call log link)
        const params = new URLSearchParams(window.location.search);
        const openCardId = params.get('openCard');
        if (openCardId) {
            setSelectedCustomerForCard(openCardId);
            setShowCustomerCard(true);
        }
    }, []);

    useEffect(() => {
        let result = clients;
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            result = result.filter(client => 
                client.full_name?.toLowerCase().includes(term) ||
                client.phone?.includes(term) ||
                client.email?.toLowerCase().includes(term) ||
                client.city?.toLowerCase().includes(term) ||
                client.customer_tier?.includes(term)
            );
        }
        // Sort
        if (sortBy === 'score') result = [...result].sort((a, b) => (b.customer_score || 0) - (a.customer_score || 0));
        else if (sortBy === 'spent') result = [...result].sort((a, b) => (b.total_spent || 0) - (a.total_spent || 0));
        else result = [...result].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
        setFilteredClients(result);
    }, [searchTerm, clients, sortBy]);

    const loadClients = async () => {
        setIsLoading(true);
        try {
            const data = await customersService.list();
            setClients(data);
            setFilteredClients(data);
        } catch (error) {
            console.error("Error loading clients:", error);
        }
        setIsLoading(false);
    };

    const handleClientUpdate = async () => {
        await loadClients();
        setShowEditModal(false);
        setSelectedClient(null);
    };

    const handleSendWhatsApp = (client) => {
        if (!client.phone) {
            alert("אין מספר טלפון ללקוח זה");
            return;
        }
        setClientForMessage(client);
        setShowMessageModal(true);
    };

    const handleCleanupDuplicates = async (phase = 'delete_no_phone') => {
        const phaseLabels = {
            'delete_no_phone': 'מחיקת לקוחות ללא טלפון',
            'merge_duplicates': 'מיזוג כפילויות לפי טלפון',
            'merge_email_duplicates': 'מיזוג כפילויות לפי אימייל'
        };
        if (!confirm(`האם להריץ: ${phaseLabels[phase]}?`)) return;

        setIsCleaningDuplicates(true);
        setCleanupResult(null);

        try {
            let offset = 0;
            let totalDeleted = 0, totalSkipped = 0, totalMerged = 0;
            let hasMore = true;

            while (hasMore) {
                const response = await base44.functions.invoke('cleanupClientsNoPhone', { phase, batch_size: 50, offset });
                const d = response.data;
                totalDeleted += d.deleted || 0;
                totalSkipped += d.skipped || 0;
                totalMerged += d.merged || 0;
                hasMore = d.has_more;
                offset = d.next_offset;
            }
            
            setCleanupResult({ deleted: totalDeleted, skipped: totalSkipped, merged: totalMerged, phase });
            await loadClients();
        } catch (error) {
            console.error("Error cleaning up:", error);
            alert("❌ שגיאה: " + error.message);
        } finally {
            setIsCleaningDuplicates(false);
        }
    };

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-3">
                        <User className="w-8 h-8 text-blue-600" />
                        לקוחות
                    </h1>
                    <p className="text-gray-600 mt-1">ניהול מאגר הלקוחות</p>
                </div>
                {isManager && (
                    <div className="flex gap-2 flex-wrap">
                        <Button
                            onClick={() => handleCleanupDuplicates('delete_no_phone')}
                            disabled={isCleaningDuplicates}
                            variant="outline"
                            size="sm"
                            className="bg-orange-50 hover:bg-orange-100 border-orange-300"
                        >
                            {isCleaningDuplicates ? (
                                <><Loader2 className="w-4 h-4 ml-1 animate-spin" />מנקה...</>
                            ) : (
                                <><Trash2 className="w-4 h-4 ml-1" />מחק ללא טלפון</>
                            )}
                        </Button>
                        <Button
                            onClick={() => handleCleanupDuplicates('merge_duplicates')}
                            disabled={isCleaningDuplicates}
                            variant="outline"
                            size="sm"
                            className="bg-blue-50 hover:bg-blue-100 border-blue-300"
                        >
                            <RefreshCw className="w-4 h-4 ml-1" />מזג טלפון
                        </Button>
                        <Button
                            onClick={() => handleCleanupDuplicates('merge_email_duplicates')}
                            disabled={isCleaningDuplicates}
                            variant="outline"
                            size="sm"
                            className="bg-cyan-50 hover:bg-cyan-100 border-cyan-300"
                        >
                            <RefreshCw className="w-4 h-4 ml-1" />מזג אימייל
                        </Button>
                        <Button
                            onClick={async () => {
                                setIsScoring(true);
                                try {
                                    await calculateCustomerScore({ batch_size: 50, offset: 0 });
                                    alert('✅ ציונים חושבו! רענן את הדף.');
                                    await loadClients();
                                } catch (e) { alert('שגיאה: ' + e.message); }
                                setIsScoring(false);
                            }}
                            disabled={isScoring}
                            variant="outline"
                            size="sm"
                            className="bg-purple-50 hover:bg-purple-100 border-purple-300"
                        >
                            {isScoring ? (
                                <><Loader2 className="w-4 h-4 ml-1 animate-spin" />מחשב...</>
                            ) : (
                                <><BarChart3 className="w-4 h-4 ml-1" />חשב ציונים</>
                            )}
                        </Button>
                    </div>
                )}
            </div>

            {cleanupResult && (
                <Card className="glass-card border-green-300 bg-green-50">
                    <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <h3 className="font-bold text-green-900 mb-2">✅ באצ' הושלם!</h3>
                                <div className="text-sm text-green-800 space-y-1">
                                    <p>• נמחקו: {cleanupResult.deleted || 0}</p>
                                    <p>• דולגו (יש רשומות מקושרות): {cleanupResult.skipped || 0}</p>
                                    <p>• מוזגו: {cleanupResult.merged || 0}</p>
                                </div>
                                <Button variant="ghost" size="sm" onClick={() => setCleanupResult(null)} className="mt-2">סגור</Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            <Card className="glass-card border-0">
                <CardHeader>
                    <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                        <div className="relative flex-1 w-full">
                            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <Input
                                placeholder="חיפוש לפי שם, טלפון, דוא״ל או עיר..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pr-10 glass-button"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <select 
                                value={sortBy} 
                                onChange={e => setSortBy(e.target.value)}
                                className="text-xs border rounded-lg px-2 py-1.5 bg-white"
                            >
                                <option value="name">מיון: שם</option>
                                <option value="score">מיון: ציון</option>
                                <option value="spent">מיון: הוצאות</option>
                            </select>
                            <Badge variant="outline" className="text-sm">
                                {filteredClients.length} לקוחות
                            </Badge>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="text-center py-8">
                            <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600 mb-2" />
                            <div className="text-lg">טוען לקוחות...</div>
                        </div>
                    ) : filteredClients.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            {searchTerm ? "לא נמצאו לקוחות התואמים לחיפוש" : "אין לקוחות במערכת"}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredClients.map((client) => (
                                <Card key={client.id} className="glass-card rounded-2xl hover:shadow-xl transition-all duration-300 border-0">
                                    <CardContent className="p-4 space-y-3">
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-2">
                                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg">
                                                    {client.full_name?.charAt(0)?.toUpperCase() || "?"}
                                                </div>
                                                <div>
                                                   <h3 
                                                        className="font-bold text-gray-900 cursor-pointer hover:text-blue-600 transition-colors"
                                                        onClick={() => {
                                                            setSelectedCustomerForCard(client.id);
                                                            setShowCustomerCard(true);
                                                        }}
                                                    >
                                                        {client.full_name}
                                                    </h3>
                                                    <div className="flex gap-1.5 mt-1 flex-wrap">
                                                        {client.customer_tier && (
                                                            <CustomerScoreBadge score={client.customer_score || 0} tier={client.customer_tier} size="sm" />
                                                        )}
                                                        {client.total_spent > 0 && (
                                                            <Badge variant="secondary" className="text-[10px]">
                                                                ₪{(client.total_spent || 0).toLocaleString()}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-2 text-sm">
                                            {client.phone && (
                                                <button
                                                    onClick={() => handleSendWhatsApp(client)}
                                                    className="flex items-center gap-2 w-full p-2 rounded-lg hover:bg-green-50 transition-colors text-right group"
                                                >
                                                    <MessageCircle className="w-4 h-4 text-green-600 group-hover:scale-110 transition-transform" />
                                                    <span className="text-gray-700 group-hover:text-green-700 font-medium">{client.phone}</span>
                                                </button>
                                            )}
                                            {client.email && (
                                                <div className="flex items-center gap-2 text-gray-600">
                                                    <Mail className="w-4 h-4" />
                                                    <span className="truncate">{client.email}</span>
                                                </div>
                                            )}
                                            {client.city && (
                                                <div className="flex items-center gap-2 text-gray-600">
                                                    <MapPin className="w-4 h-4" />
                                                    <span>{client.city}</span>
                                                </div>
                                            )}
                                        </div>

                                        {client.notes && (
                                            <div className="text-xs text-gray-600 bg-gray-50 p-2 rounded">
                                                {client.notes}
                                            </div>
                                        )}

                                        <div className="flex gap-2 mt-3">
                                            <Button
                                                onClick={() => {
                                                    const url = createPageUrl('MessageCenter') + `?createTicketFor=${client.id}`;
                                                    navigate(url);
                                                }}
                                                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                                                size="sm"
                                            >
                                                <PlusCircle className="w-4 h-4 ml-2" />
                                                צור טיקט
                                            </Button>
                                            <Button
                                                onClick={() => {
                                                    setSelectedClient(client);
                                                    setShowEditModal(true);
                                                }}
                                                variant="outline"
                                                className="flex-1"
                                                size="sm"
                                            >
                                                עריכה
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {selectedClient && showEditModal && (
                <EditCustomerModal
                    isOpen={showEditModal}
                    onClose={() => {
                        setShowEditModal(false);
                        setSelectedClient(null);
                    }}
                    customer={selectedClient}
                    onSave={handleClientUpdate}
                />
            )}

            {clientForMessage && showMessageModal && (
                <SendMessageModal
                    isOpen={showMessageModal}
                    onClose={() => {
                        setShowMessageModal(false);
                        setClientForMessage(null);
                    }}
                    customer={clientForMessage}
                />
            )}

            <CustomerCard
                customerId={selectedCustomerForCard}
                isOpen={showCustomerCard}
                onClose={() => {
                    setShowCustomerCard(false);
                    setSelectedCustomerForCard(null);
                }}
                onEdit={() => {}}
            />
        </div>
    );
}