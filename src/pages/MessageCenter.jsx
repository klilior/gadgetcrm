import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { customersService } from "../components/utils/customersService";
import { useUser } from "../components/UserAuth";
import { useEmployees } from "../components/EmployeeProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageSquare, Search, Bell, UserPlus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import ConversationList from "../components/messages/ConversationList";
import ChatView from "../components/messages/ChatView";
import NewConversationModal from "../components/messages/NewConversationModal";

export default function MessageCenter() {
    const { currentUser } = useUser();
    const { employees: employeesData } = useEmployees();
    const [conversations, setConversations] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [activities, setActivities] = useState([]);
    const [selectedConversation, setSelectedConversation] = useState(null);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [currentView, setCurrentView] = useState('new');
    const [isLoading, setIsLoading] = useState(true);
    const [isNewConversationModalOpen, setIsNewConversationModalOpen] = useState(false);
    const [lastLoadTime, setLastLoadTime] = useState(null);

    const loadData = useCallback(async (silent = false) => {
        if (!currentUser) return;
        if (!silent) setIsLoading(true);

        try {
            console.log('🔄 Loading message center data...');

            // 1. Load Conversations (employees come from EmployeeProvider)
            const conversationsData = await base44.entities.Conversation.list('-last_message_date', 200).catch(() => []);

            // 2. Extract Customer IDs and fetch ONLY them (much more efficient)
            const customerIds = [...new Set(conversationsData.map(c => c.customer_id).filter(Boolean))];
            
            // 3. Fetch Customers and Activities in parallel
            // We fetch customers by ID to avoid loading 1000+ irrelevant records
            // We chunk IDs to avoid query limits if needed, but for 200 it's usually fine
            const [customersData, activitiesData] = await Promise.all([
            customerIds.length > 0 
                ? customersService.getByIds(customerIds)
                : [],
            base44.entities.Activity.list('-created_date', 1000).catch(() => [])
            ]);

            console.log(`✅ Loaded ${customersData.length} customers, ${activitiesData.length} activities, ${conversationsData.length} conversations`);

            setCustomers(customersData);
            setActivities(activitiesData);

            // 4. Build conversations map synchronously (no more network calls inside map)
            const conversationsArray = conversationsData.map(conv => {
                let customer = customersData.find(c => c.id === conv.customer_id);
                
                if (!customer) {
                    customer = {
                        id: conv.customer_id,
                        full_name: 'לקוח לא ידוע',
                        phone: '???',
                        notes: 'פרטי לקוח חסרים'
                    };
                }

                // Calculate real-time unread count
                const customerActivities = activitiesData.filter(a => 
                    a.order_id === conv.customer_id &&
                    a.activity_type?.includes('נכנס')
                );

                const unreadCount = customerActivities.filter(a => {
                    const readBy = a.read_by || [];
                    return !readBy.includes(currentUser.id);
                }).length;

                return {
                    ...conv,
                    customer: customer,
                    unread_count: unreadCount
                };
            });

            const validConversations = conversationsArray;

            // Sort by last message date
            conversationsArray.sort((a, b) => 
                new Date(b.last_message_date) - new Date(a.last_message_date)
            );

            // Filter by view
            let filteredConversations = conversationsArray;
            if (currentView === 'my') {
                filteredConversations = conversationsArray.filter(c => c.assigned_to === currentUser.id);
            } else if (currentView === 'new') {
                filteredConversations = conversationsArray.filter(c => c.unread_count > 0);
            }

            console.log(`📊 View: ${currentView}, Total conversations: ${conversationsArray.length}, Filtered: ${filteredConversations.length}`);
            console.log('Unread counts:', conversationsArray.map(c => ({ customer: c.customer?.full_name, unread: c.unread_count })));
            
            // Always set all conversations, not just filtered
            setConversations(currentView === 'all' ? conversationsArray : filteredConversations);
            setLastLoadTime(new Date());

        } catch (error) {
            console.error('❌ Error loading data:', error);
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, [currentUser, currentView]);

    useEffect(() => {
        loadData();
        // Poll every 30 seconds (was 5s — reduced API load significantly)
        const interval = setInterval(() => loadData(true), 30000);
        return () => clearInterval(interval);
    }, [loadData]);

    const handleSelectConversation = (conv) => {
        setSelectedConversation(conv);
        setSelectedCustomer(conv.customer);
    };

    // Update selected conversation when data refreshes
    useEffect(() => {
        if (selectedConversation) {
            const updated = conversations.find(c => c.customer_id === selectedConversation.customer_id);
            if (updated) {
                setSelectedConversation(updated);
            }
        }
    }, [conversations]);

    const getConversationMessages = () => {
        if (!selectedConversation) return [];
        return activities
            .filter(a => 
                a.order_id === selectedConversation.customer_id &&
                (a.activity_type?.includes('וואטסאפ') || 
                 a.activity_type?.includes('מייל') || 
                 a.activity_type?.includes('שיחה') ||
                 a.activity_type === 'הערה')
            )
            .sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    };

    const newMessagesCount = conversations.filter(c => c.unread_count > 0).length;
    const myConversationsCount = conversations.filter(c => c.assigned_to === currentUser?.id).length;
    const allConversationsCount = conversations.length;

    if (isLoading) {
        return (
            <div className="h-screen flex items-center justify-center">
                <div className="text-center">
                    <RefreshCw className="w-12 h-12 mx-auto mb-4 animate-spin text-blue-600" />
                    <p className="text-gray-600">טוען מרכז הודעות...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-[calc(100vh-8rem)] flex flex-col gap-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white rounded-xl border shadow-sm p-4">
                <div className="flex items-center gap-3">
                    <div className="bg-gradient-to-br from-blue-500 to-purple-600 p-3 rounded-xl">
                        <MessageSquare className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">מרכז הודעות</h1>
                        <p className="text-sm text-gray-500">
                            כל השיחות במקום אחד • עדכון אחרון: {lastLoadTime ? new Date(lastLoadTime).toLocaleTimeString('he-IL') : ''}
                        </p>
                    </div>
                    {newMessagesCount > 0 && (
                        <div className="relative">
                            <Badge className="bg-red-500 text-white text-lg px-4 py-2 shadow-lg">
                                {newMessagesCount} חדש
                            </Badge>
                            <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                            </span>
                        </div>
                    )}
                </div>
                <div className="flex gap-2">
                    <Button 
                        onClick={() => loadData(false)} 
                        variant="outline"
                        size="sm"
                        className="gap-2"
                    >
                        <RefreshCw className="w-4 h-4" />
                        רענן
                    </Button>
                    <Button 
                        onClick={() => setIsNewConversationModalOpen(true)} 
                        className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 shadow-lg gap-2"
                    >
                        <UserPlus className="w-4 h-4" />
                        שיחה חדשה
                    </Button>
                </div>
            </div>

            {/* Tabs */}
            <Tabs value={currentView} onValueChange={setCurrentView} className="bg-white rounded-xl border shadow-sm p-2">
                <TabsList className="grid w-full grid-cols-3 bg-gray-100 p-1 rounded-lg">
                    <TabsTrigger value="new" className="relative data-[state=active]:bg-white data-[state=active]:shadow">
                        <div className="flex items-center gap-2">
                            <Bell className="w-4 h-4" />
                            <span className="hidden sm:inline">הודעות חדשות</span>
                            <span className="sm:hidden">חדש</span>
                            {newMessagesCount > 0 && (
                                <Badge className="bg-red-500 text-white text-xs px-2 py-0">
                                    {newMessagesCount}
                                </Badge>
                            )}
                        </div>
                        {newMessagesCount > 0 && (
                            <span className="absolute -top-1 -right-1 h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                            </span>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="my" className="data-[state=active]:bg-white data-[state=active]:shadow">
                        <div className="flex items-center gap-2">
                            <MessageSquare className="w-4 h-4" />
                            <span className="hidden sm:inline">השיחות שלי</span>
                            <span className="sm:hidden">שלי</span>
                            <Badge variant="outline" className="text-xs">
                                {myConversationsCount}
                            </Badge>
                        </div>
                    </TabsTrigger>
                    <TabsTrigger value="all" className="data-[state=active]:bg-white data-[state=active]:shadow">
                        <div className="flex items-center gap-2">
                            <MessageSquare className="w-4 h-4" />
                            <span className="hidden sm:inline">כל השיחות</span>
                            <span className="sm:hidden">הכל</span>
                            <Badge variant="outline" className="text-xs">
                                {allConversationsCount}
                            </Badge>
                        </div>
                    </TabsTrigger>
                </TabsList>
            </Tabs>

            {/* Search */}
            <div className="bg-white rounded-xl border shadow-sm p-3">
                <div className="relative">
                    <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <Input
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="חפש לפי שם, טלפון או תוכן הודעה..."
                        className="pr-10 h-11 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                    />
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-4 min-h-0">
                {/* Conversations List */}
                <div className="md:col-span-4 bg-white rounded-xl border shadow-sm overflow-hidden flex flex-col">
                    <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-4 py-3 border-b">
                        <h3 className="font-semibold text-gray-700 flex items-center gap-2">
                            <MessageSquare className="w-4 h-4" />
                            שיחות ({conversations.length})
                        </h3>
                    </div>
                    <div className="flex-1 overflow-hidden">
                        <ConversationList
                            conversations={conversations}
                            selectedId={selectedConversation?.id}
                            onSelect={handleSelectConversation}
                            searchTerm={searchTerm}
                        />
                    </div>
                </div>

                {/* Chat View */}
                <div className="md:col-span-8 bg-white rounded-xl border shadow-sm overflow-hidden">
                    <ChatView
                        conversation={selectedConversation}
                        customer={selectedCustomer}
                        messages={getConversationMessages()}
                        onMessageSent={() => loadData(true)}
                        currentUser={currentUser}
                    />
                </div>
            </div>

            <NewConversationModal
                isOpen={isNewConversationModalOpen}
                onClose={() => setIsNewConversationModalOpen(false)}
                onConversationCreated={async (customer) => {
                    setIsNewConversationModalOpen(false);
                    
                    // Build a temporary conversation
                    const tempConv = {
                        id: customer.id,
                        customer_id: customer.id,
                        customer: customer,
                        last_message: 'שיחה נפתחה',
                        last_message_date: new Date().toISOString(),
                        last_channel: 'whatsapp',
                        unread_count: 0,
                        assigned_to: currentUser?.id,
                        status: 'פתוח',
                        tags: []
                    };
                    
                    setSelectedConversation(tempConv);
                    setSelectedCustomer(customer);
                    
                    // Reload data in background
                    await loadData(true);
                }}
                customers={customers}
            />
        </div>
    );
}