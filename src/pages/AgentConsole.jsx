import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Ticket, Employee, Client } from "@/entities/all"; // Using new Client entity
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, User, ChevronDown, PlusCircle, Bell, Inbox, Zap, MessageSquare, Phone, Mail, Globe } from "lucide-react";
import { format } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import { useUser } from "../components/UserAuth";
import TicketDetails from "../components/tickets/TicketDetails";
import NewTicketModal from "../components/tickets/NewTicketModal";
import TicketFilters from "../components/tickets/TicketFilters";
import { forceProcessReminders } from "@/functions/forceProcessReminders";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TicketRow = ({ ticket, customer, assignedAgent, onSelect, isSelected, isUnassigned, onAssignToMe, category }) => {
    const getCategoryClass = (category) => {
        const cat = category || 'שירות';
        switch (cat) {
            case "מכירות": return "bg-green-100 text-green-800 border-green-200";
            case "תיקון": return "bg-orange-100 text-orange-800 border-orange-200";
            case "שירות": default: return "bg-blue-100 text-blue-800 border-blue-200";
        }
    };
    
    const getStatusClass = (status) => {
        const statusStr = status || '';
        if (["נסגר", "נסגר ללא מענה"].includes(statusStr)) return "bg-gray-200 text-gray-700";
        if (statusStr === "חדש") return "bg-teal-100 text-teal-800 border-teal-200";
        return "bg-slate-200 text-slate-800";
    };

    const getChannelInfo = (channel) => {
        const channelStr = channel || '';
        switch (channelStr) {
            case "whatsapp":
                return { icon: <MessageSquare className="w-3 h-3 text-green-600" />, text: "וואטסאפ" };
            case "phone":
                return { icon: <Phone className="w-3 h-3 text-blue-600" />, text: "טלפון" };
            case "email":
                return { icon: <Mail className="w-3 h-3 text-purple-600" />, text: "מייל" };
            case "website":
                return { icon: <Globe className="w-3 h-3 text-indigo-600" />, text: "אתר" };
            default:
                return { icon: <Zap className="w-3 h-3 text-gray-400" />, text: channelStr || "אחר" };
        }
    };

    const channelInfo = getChannelInfo(ticket?.contact_channel);
    const isOverdue = ticket?.sla_target && new Date() > new Date(ticket.sla_target);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className={`rounded-xl transition-all duration-300 ${isSelected ? 'bg-white ring-2 ring-blue-500 shadow-lg' : 'bg-white/70 hover:bg-white shadow-sm'}`}
        >
            {isUnassigned && (
                <motion.div 
                    className="h-1 bg-red-400 rounded-t-xl"
                    animate={{ opacity: [0, 1, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity, repeatType: "loop", ease: "easeInOut" }}
                />
            )}
            <div className="grid grid-cols-12 items-center p-3 gap-2 text-sm" onClick={() => onSelect(ticket)}>
                <div className="col-span-12 md:col-span-3 cursor-pointer">
                    <div className="font-semibold text-gray-800 truncate">
                        #{ticket?.ticket_number || 'N/A'} - {ticket?.subject || 'ללא נושא'}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                        {customer?.full_name || 'לקוח לא ידוע'}
                    </div>
                </div>
                <div className="col-span-4 md:col-span-1 text-center cursor-pointer">
                    <Badge className={`border ${getCategoryClass(category)}`}>{category || 'שירות'}</Badge>
                </div>
                <div className="col-span-4 md:col-span-2 text-center cursor-pointer">
                    <div className="flex items-center justify-center gap-1.5 text-gray-600 text-xs">
                        {channelInfo.icon}
                        <span>{channelInfo.text}</span>
                    </div>
                </div>
                <div className="col-span-4 md:col-span-2 text-center cursor-pointer">
                    <Badge className={`border ${getStatusClass(ticket?.status)}`}>{ticket?.status || 'לא ידוע'}</Badge>
                </div>
                <div className="col-span-6 md:col-span-2 text-xs text-gray-600 truncate text-center cursor-pointer">
                    <div className="flex items-center justify-center gap-1">
                        {isUnassigned ? (
                            <Badge variant="destructive">לא הוקצה</Badge>
                        ) : ( 
                            <> 
                                <User className="w-3 h-3" /> 
                                {assignedAgent?.employee_name || 'לא משויך'} 
                            </>
                        )}
                    </div>
                </div>
                <div className="col-span-3 md:col-span-1 text-xs text-gray-500 text-center cursor-pointer">
                    {ticket?.created_date && format(new Date(ticket.created_date), "dd/MM")}
                </div>
                <div className="col-span-3 md:col-span-1 flex justify-end items-center gap-2">
                    {isUnassigned && (
                        <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white rounded-full px-3 py-1 h-auto text-xs" onClick={(e) => { e.stopPropagation(); onAssignToMe(ticket); }}>
                            <Zap className="w-3 h-3 ml-1" /> קח
                        </Button>
                    )}
                    {isOverdue && <AlertCircle className="w-4 h-4 text-red-500" title="חריגת SLA" />}
                    <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${isSelected ? 'rotate-180' : ''}`} />
                </div>
            </div>
        </motion.div>
    );
};

export default function AgentConsole() {
    const { currentUser } = useUser();
    
    const [allTickets, setAllTickets] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [clients, setClients] = useState([]); // Using 'clients' state
    const [selectedTicket, setSelectedTicket] = useState(null);
    const [isNewTicketModalOpen, setIsNewTicketModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isCheckingReminders, setIsCheckingReminders] = useState(false);
    const [currentView, setCurrentView] = useState('my');
    const [filters, setFilters] = useState({
        searchTerm: "",
        assigneeId: "all",
        category: "all"
    });

    const loadData = useCallback(async (isSilent = false) => {
        if (!currentUser) return;
        if (!isSilent) setIsLoading(true);

        try {
            console.log("🔄 Loading data...");
            
            // 1. Load Tickets and Employees in parallel
            const [ticketsData, employeesData] = await Promise.all([
                Promise.race([
                    Ticket.filter({ status: { $nin: ["נסגר", "נסגר ללא מענה"] } }, "-updated_date", 100),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Tickets timeout')), 20000))
                ]).catch(err => {
                    console.error("❌ Error loading tickets:", err.message);
                    return [];
                }),
                Promise.race([
                    Employee.list("-updated_date", 50),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Employees timeout')), 20000))
                ]).catch(err => {
                    console.error("❌ Error loading employees:", err.message);
                    return [];
                })
            ]);

            // 2. Load relevant clients based on tickets
            const customerIds = [...new Set(ticketsData.map(t => t.customer_id).filter(Boolean))];
            
            let clientsData = [];
            if (customerIds.length > 0) {
                clientsData = await Promise.race([
                    Client.filter({ id: { $in: customerIds } }, "-updated_date", 200),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Clients timeout')), 20000))
                ]).catch(err => {
                    console.error("❌ Error loading clients:", err.message);
                    return [];
                });
            }

            console.log(`✅ Loaded ${ticketsData.length} tickets, ${employeesData.length} employees, ${clientsData.length} clients`);
            
            setAllTickets(ticketsData);
            setEmployees(employeesData);
            setClients(clientsData);
            
        } catch (error) {
            console.error("❌ Error loading data:", error.message);
            // Don't clear data on error if we fetched some
        } finally {
            if (!isSilent) setIsLoading(false);
        }
    }, [currentUser]);

    useEffect(() => {
        loadData();
        const interval = setInterval(() => {
            loadData(true).catch(err => {
                console.error("❌ Error during automatic sync:", err.message || err);
            });
        }, 30000);
        return () => clearInterval(interval);
    }, [loadData]);

    const handleAssignToMe = async (ticket) => {
        if (!currentUser || !ticket?.id) return;
        await Ticket.update(ticket.id, { assigned_to: currentUser.id, status: 'בטיפול' });
        loadData(true);
    };

    const handleTicketSelect = (ticket) => {
        if (selectedTicket?.id === ticket?.id) {
            setSelectedTicket(null);
        } else {
            setSelectedTicket(ticket);
        }
    };

    const handleTicketUpdate = async () => {
        await loadData(true);
        if (selectedTicket?.id) {
            try {
                const updatedTicket = await Ticket.get(selectedTicket.id);
                setSelectedTicket(updatedTicket);
            } catch {
                setSelectedTicket(null);
            }
        }
    };

    const getTicketCategory = useCallback((ticket) => {
        if (!ticket) return 'שירות';
        const subject = ticket.subject || '';
        const inquiryType = ticket.inquiry_type || '';
        
        if (subject.includes('תיקון') || inquiryType.includes('תיקון')) return 'תיקון';
        if (subject.includes('מכירה') || inquiryType.includes('מכירה') || inquiryType.includes('ליד')) return 'מכירות';
        return 'שירות';
    }, []);

    const getEmployeeById = useCallback((id) => {
        if (!id || !employees) return null;
        return employees.find(e => e && e.id === id) || null;
    }, [employees]);
    
    const getClientById = useCallback((id) => {
        if (!id || !clients) return null;
        return clients.find(c => c && c.id === id) || null;
    }, [clients]);

    const ticketsToShow = useMemo(() => {
        if (!Array.isArray(allTickets)) return [];
        
        let baseTickets = [];
        if (currentView === 'my') {
            baseTickets = allTickets.filter(t => t && t.assigned_to === currentUser?.id);
        } else if (currentView === 'unassigned') {
            baseTickets = allTickets.filter(t => t && !t.assigned_to);
        } else {
            baseTickets = allTickets.filter(t => t);
        }

        return baseTickets.filter(ticket => {
            if (!ticket) return false;
            const client = getClientById(ticket.customer_id); // Use getClientById
            
            const searchTerm = (filters && filters.searchTerm) ? filters.searchTerm : '';
            const normalizedSearch = searchTerm.toLowerCase().trim();
            
            const searchMatch = !normalizedSearch || 
                (ticket.ticket_number && ticket.ticket_number.toString().includes(normalizedSearch)) ||
                (ticket.subject && ticket.subject.toLowerCase().includes(normalizedSearch)) ||
                (client && client.full_name && client.full_name.toLowerCase().includes(normalizedSearch)) ||
                (client && client.phone && client.phone.includes(normalizedSearch));

            const assigneeFilter = (filters && filters.assigneeId) ? filters.assigneeId : 'all';
            const categoryFilter = (filters && filters.category) ? filters.category : 'all';
            
            const assigneeMatch = currentView !== 'all' || assigneeFilter === 'all' || ticket.assigned_to === assigneeFilter;
            const categoryMatch = categoryFilter === 'all' || getTicketCategory(ticket) === categoryFilter;

            return searchMatch && assigneeMatch && categoryMatch;
        });
    }, [allTickets, currentView, filters, currentUser, getClientById, getTicketCategory]);
    
    const myTicketsCount = useMemo(() => allTickets.filter(t => t?.assigned_to === currentUser?.id).length, [allTickets, currentUser?.id]);
    const unassignedTicketsCount = useMemo(() => allTickets.filter(t => !t?.assigned_to).length, [allTickets]);

    const handleCheckReminders = async () => {
        setIsCheckingReminders(true);
        try {
            const { data } = await forceProcessReminders();
            alert(data?.sent > 0 ? `נשלחו ${data.sent} תזכורות!` : "אין תזכורות חדשות לשליחה.");
        } catch (error) {
            console.error("Error checking reminders:", error);
            alert("שגיאה בבדיקת התזכורות.");
        } finally {
            setIsCheckingReminders(false);
        }
    };

    if (isLoading) {
        return <div className="p-6 text-center text-gray-500">טוען נתונים...</div>;
    }

    return (
        <div className="p-2 sm:p-4 md:p-6 space-y-4">
            
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-0">
                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">קונסולת נציג</h1>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                    <Button onClick={() => setIsNewTicketModalOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white text-sm">
                        <PlusCircle className="w-4 h-4 ml-2" /> 
                        טיקט חדש
                    </Button>
                    <Button onClick={handleCheckReminders} disabled={isCheckingReminders} variant="outline" className="text-sm">
                        <Bell className="w-4 h-4 ml-2" /> 
                        {isCheckingReminders ? "בודק..." : "בדוק תזכורות"}
                    </Button>
                </div>
            </div>

            <Tabs value={currentView} onValueChange={setCurrentView} className="w-full">
                <TabsList className="grid w-full grid-cols-2 md:grid-cols-3 bg-slate-100/80 p-1 rounded-xl h-auto">
                    <TabsTrigger value="my" className="text-xs sm:text-sm py-2">הטיקטים שלי ({myTicketsCount})</TabsTrigger>
                    <TabsTrigger value="unassigned" className="relative text-xs sm:text-sm py-2">
                        פניות חדשות ({unassignedTicketsCount})
                        {unassignedTicketsCount > 0 && (
                            <span className="absolute -top-1 -right-1 h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                            </span>
                        )}
                    </TabsTrigger>
                    {(currentUser?.role === 'מנהל' || currentUser?.role === 'מנהל משמרת') && (
                        <TabsTrigger value="all" className="text-xs sm:text-sm py-2">כל הפתוחים ({allTickets.length})</TabsTrigger>
                    )}
                </TabsList>
            </Tabs>

            <TicketFilters 
                employees={employees} 
                onFilterChange={setFilters} 
                initialFilters={filters} 
            />

            <div className="space-y-2">
                <AnimatePresence>
                    {ticketsToShow.length > 0 ? (
                        ticketsToShow.map((ticket) => {
                            const client = getClientById(ticket.customer_id); // Use client
                            return (
                                <React.Fragment key={ticket?.id}>
                                    <TicketRow
                                        ticket={ticket}
                                        customer={client} // Pass client as customer
                                        assignedAgent={getEmployeeById(ticket?.assigned_to)}
                                        onSelect={handleTicketSelect}
                                        isSelected={selectedTicket?.id === ticket?.id}
                                        isUnassigned={!ticket?.assigned_to}
                                        onAssignToMe={handleAssignToMe}
                                        category={getTicketCategory(ticket)}
                                    />
                                    <AnimatePresence>
                                        {selectedTicket?.id === ticket?.id && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: "auto" }}
                                                exit={{ opacity: 0, height: 0 }}
                                                className="overflow-hidden"
                                            >
                                                <div className="bg-slate-50 p-2 sm:p-4 my-2 rounded-lg border">
                                                    <TicketDetails 
                                                        ticket={selectedTicket} 
                                                        customer={getClientById(selectedTicket.customer_id)} // Pass client
                                                        employees={employees} 
                                                        onTicketUpdate={handleTicketUpdate}
                                                    />
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </React.Fragment>
                            )
                        })
                    ) : (
                        <div className="text-center py-8 sm:py-16 text-gray-500 glass-card rounded-2xl">
                            <Inbox className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-4 text-gray-400" />
                            <p className="text-sm sm:text-base">אין טיקטים להצגה בתצוגה זו</p>
                        </div>
                    )}
                </AnimatePresence>
            </div>
            
            <NewTicketModal 
                isOpen={isNewTicketModalOpen} 
                onClose={() => setIsNewTicketModalOpen(false)} 
                onTicketCreated={() => loadData(false)} 
            />
        </div>
    );
}