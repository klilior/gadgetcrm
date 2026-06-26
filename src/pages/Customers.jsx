import React, { useState, useEffect, useMemo } from "react";
import { customersService } from "../components/utils/customersService";
import { useCustomersQuery } from "../hooks/useEntityQueries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, User, Phone, Mail, MessageCircle, MapPin, Plus, Loader2, PlusCircle, Trophy, Star, Medal, Award, Sparkles, BarChart3, Trash2, CheckSquare, Square, XCircle } from "lucide-react";
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
    const { data: clientsRaw = [], isLoading: clientsQueryLoading, refetch: refetchClients } = useCustomersQuery();
    const [searchTerm, setSearchTerm] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 50;
    const [selectedClient, setSelectedClient] = useState(null);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showMessageModal, setShowMessageModal] = useState(false);
    const [clientForMessage, setClientForMessage] = useState(null);

    const [showCustomerCard, setShowCustomerCard] = useState(false);
    const [selectedCustomerForCard, setSelectedCustomerForCard] = useState(null);
    const [isScoring, setIsScoring] = useState(false);
    const [sortBy, setSortBy] = useState('name'); // name | score | spent
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [isDeleting, setIsDeleting] = useState(false);

    const isManager = currentUser?.role === "מנהל" || currentUser?.role === "admin";

    const toggleSelect = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredClients.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredClients.map(c => c.id)));
        }
    };

    const handleDeleteSelected = async () => {
        if (selectedIds.size === 0) return;
        if (!confirm(`האם למחוק ${selectedIds.size} לקוחות? פעולה זו בלתי הפיכה.`)) return;
        setIsDeleting(true);
        try {
            for (const id of selectedIds) {
                await base44.entities.Client.delete(id);
            }
            setSelectedIds(new Set());
            setSelectionMode(false);
            await loadClients();
        } catch (e) {
            alert('שגיאה במחיקה: ' + e.message);
        }
        setIsDeleting(false);
    };

    useEffect(() => {
        // Handle openCard URL param
        const params = new URLSearchParams(window.location.search);
        const openCardId = params.get('openCard');
        if (openCardId) {
            setSelectedCustomerForCard(openCardId);
            setShowCustomerCard(true);
        }
    }, []);

    // Reset page on filter change
    useEffect(() => { setCurrentPage(1); }, [searchTerm, sortBy]);

    const filteredClients = useMemo(() => {
        let result = clientsRaw;
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
        if (sortBy === 'score') result = [...result].sort((a, b) => (b.customer_score || 0) - (a.customer_score || 0));
        else if (sortBy === 'spent') result = [...result].sort((a, b) => (b.total_spent || 0) - (a.total_spent || 0));
        else result = [...result].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
        return result;
    }, [searchTerm, clientsRaw, sortBy]);

    const isLoading = clientsQueryLoading;
    const loadClients = async () => { await refetchClients(); customersService.invalidateCache(); };

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
                        {selectionMode ? (
                            <>
                                <Button
                                    onClick={toggleSelectAll}
                                    variant="outline"
                                    size="sm"
                                >
                                    {selectedIds.size === filteredClients.length ? (
                                        <><CheckSquare className="w-4 h-4 ml-1" />בטל הכל</>
                                    ) : (
                                        <><Square className="w-4 h-4 ml-1" />סמן הכל</>
                                    )}
                                </Button>
                                <Button
                                    onClick={handleDeleteSelected}
                                    disabled={selectedIds.size === 0 || isDeleting}
                                    variant="destructive"
                                    size="sm"
                                >
                                    {isDeleting ? (
                                        <><Loader2 className="w-4 h-4 ml-1 animate-spin" />מוחק...</>
                                    ) : (
                                        <><Trash2 className="w-4 h-4 ml-1" />מחק ({selectedIds.size})</>
                                    )}
                                </Button>
                                <Button
                                    onClick={() => { setSelectionMode(false); setSelectedIds(new Set()); }}
                                    variant="ghost"
                                    size="sm"
                                >
                                    <XCircle className="w-4 h-4 ml-1" />ביטול
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button
                                    onClick={() => setSelectionMode(true)}
                                    variant="outline"
                                    size="sm"
                                    className="bg-red-50 hover:bg-red-100 border-red-300 text-red-700"
                                >
                                    <Trash2 className="w-4 h-4 ml-1" />בחר למחיקה
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
                            </>
                        )}
                    </div>
                )}
            </div>

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
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredClients.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE).map((client) => (
                                <Card 
                                    key={client.id} 
                                    className={`glass-card rounded-2xl hover:shadow-xl transition-all duration-300 border-0 ${selectionMode && selectedIds.has(client.id) ? 'ring-2 ring-red-400 bg-red-50/50' : ''}`}
                                    onClick={selectionMode ? () => toggleSelect(client.id) : undefined}
                                >
                                    <CardContent className={`p-4 space-y-3 ${selectionMode ? 'cursor-pointer' : ''}`}>
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-2">
                                                {selectionMode ? (
                                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${selectedIds.has(client.id) ? 'bg-red-500 border-red-500 text-white' : 'bg-white border-gray-300 text-gray-400'}`}>
                                                        {selectedIds.has(client.id) ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                                                    </div>
                                                ) : (
                                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg">
                                                    {client.full_name?.charAt(0)?.toUpperCase() || "?"}
                                                </div>
                                                )}
                                                <div>
                                                   <h3 
                                                        className="font-bold text-gray-900 cursor-pointer hover:text-blue-600 transition-colors"
                                                        onClick={(e) => {
                                                            if (selectionMode) return;
                                                            e.stopPropagation();
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

                        {/* Pagination */}
                        {Math.ceil(filteredClients.length / ITEMS_PER_PAGE) > 1 && (
                          <div className="flex items-center justify-center gap-4 mt-6">
                            <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>הקודם</Button>
                            <span className="text-sm text-gray-600">עמוד {currentPage} מתוך {Math.ceil(filteredClients.length / ITEMS_PER_PAGE)}</span>
                            <Button variant="outline" size="sm" disabled={currentPage >= Math.ceil(filteredClients.length / ITEMS_PER_PAGE)} onClick={() => setCurrentPage(p => p + 1)}>הבא</Button>
                          </div>
                        )}
                    </>
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