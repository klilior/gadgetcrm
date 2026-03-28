import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Ticket } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { useEmployees } from "../components/EmployeeProvider";
import { useCustomersQuery, useInvalidateEntity } from "../hooks/useEntityQueries";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, User, ChevronDown, PlusCircle, Inbox, Trash2, CheckSquare, Square } from "lucide-react";
import { format } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import NewTicketModal from "../components/tickets/NewTicketModal";
import TicketDetails from "../components/tickets/TicketDetails";
import TicketFilters from "../components/tickets/TicketFilters";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUser } from "../components/UserAuth";

// Helper function moved outside to be a stable reference
const getTicketCategory = (ticket) => {
    if (!ticket) return 'שירות';
    const subject = ticket.subject || '';
    const inquiryType = ticket.inquiry_type || '';
    
    if (subject.includes('תיקון') || inquiryType.includes('תיקון')) return 'תיקון';
    if (subject.includes('מכירה') || inquiryType.includes('מכירה') || inquiryType.includes('ליד')) return 'מכירות';
    return 'שירות';
};

const TicketRow = React.memo(({ ticket, customer, assignedAgent, onSelect, isSelected, onDelete, isManager, isChecked, onCheck }) => {
    const getCategoryClass = (category) => {
        const cat = category || 'שירות';
        switch (cat) {
            case "מכירות": return "bg-green-100 text-green-800";
            case "תיקון": return "bg-orange-100 text-orange-800";
            default: return "bg-blue-100 text-blue-800";
        }
    };
    
    const getStatusClass = (status) => {
        const statusStr = status || '';
        if (["נסגר", "נסגר ללא מענה"].includes(statusStr)) return "bg-gray-200 text-gray-700";
        if (statusStr === "חדש") return "bg-green-200 text-green-800";
        return "bg-slate-200 text-slate-800";
    }

    const category = getTicketCategory(ticket);
    const ticketStatus = ticket?.status || '';
    const isOverdue = ticket?.sla_target && new Date() > new Date(ticket.sla_target) && !["נסגר", "נסגר ללא מענה"].includes(ticketStatus);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`bg-white rounded-xl shadow-sm transition-all duration-300 ${isSelected ? 'ring-2 ring-blue-500 shadow-lg' : 'hover:shadow-md'}`}
        >
            <div className="grid grid-cols-12 items-center p-3 gap-2 text-sm">
                {isManager && (
                    <div className="col-span-1 flex justify-center items-center" onClick={(e) => e.stopPropagation()}>
                        <button
                            onClick={() => onCheck(ticket.id)}
                            className="hover:bg-gray-100 p-2 rounded-lg transition-colors"
                        >
                            {isChecked ? (
                                <CheckSquare className="w-5 h-5 text-blue-600" />
                            ) : (
                                <Square className="w-5 h-5 text-gray-400" />
                            )}
                        </button>
                    </div>
                )}
                
                <div className={`${isManager ? 'col-span-11' : 'col-span-11'} md:col-span-${isManager ? '3' : '4'} cursor-pointer`} onClick={() => onSelect(ticket)}>
                    <div className="font-semibold text-gray-800 truncate">
                        #{ticket?.ticket_number || 'N/A'} - {ticket?.subject || 'ללא נושא'}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                        {customer?.full_name || 'לקוח לא ידוע'}
                    </div>
                </div>

                <div className="col-span-6 md:col-span-2 text-center cursor-pointer" onClick={() => onSelect(ticket)}>
                    <Badge className={getCategoryClass(category)}>{category}</Badge>
                </div>
                
                <div className="col-span-6 md:col-span-2 text-center cursor-pointer" onClick={() => onSelect(ticket)}>
                    <Badge className={getStatusClass(ticketStatus)}>{ticketStatus || 'לא ידוע'}</Badge>
                </div>

                <div className="col-span-6 md:col-span-2 text-xs text-gray-600 truncate text-center cursor-pointer" onClick={() => onSelect(ticket)}>
                    <div className="flex items-center justify-center gap-1">
                        <User className="w-3 h-3" />
                        {assignedAgent?.employee_name || 'לא משויך'}
                    </div>
                </div>

                <div className="col-span-6 md:col-span-1 text-xs text-gray-500 text-center cursor-pointer" onClick={() => onSelect(ticket)}>
                    {ticket?.created_date && format(new Date(ticket.created_date), "dd/MM")}
                </div>

                <div className="col-span-1 flex justify-center items-center gap-2">
                     {isOverdue && <AlertCircle className="w-4 h-4 text-red-500" />}
                     <Button variant="ghost" size="icon" className="w-7 h-7 text-red-500" onClick={(e) => { e.stopPropagation(); onDelete(ticket); }}>
                         <Trash2 className="w-4 h-4" />
                     </Button>
                     <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${isSelected ? 'rotate-180' : ''}`} />
                </div>
            </div>
        </motion.div>
    );
});

const TICKETS_PER_PAGE = 30;

export default function TicketsPage() {
  const { currentUser } = useUser();
  const isManager = currentUser?.role === "מנהל";
  
  const { employees, employeesMap } = useEmployees();
  const { data: clients = [], isLoading: clientsLoading } = useCustomersQuery();
  const invalidateTickets = useInvalidateEntity('tickets');
  
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [isNewTicketModalOpen, setIsNewTicketModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("open");
  const [filters, setFilters] = useState({
      searchTerm: "",
      assigneeId: "all",
      category: "all"
  });
  const [selectedTicketIds, setSelectedTicketIds] = useState([]);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    loadTickets();
  }, []);

  const loadTickets = async () => {
    const start = Date.now();
    setIsLoading(true);
    try {
        const fetchedTickets = await Ticket.list("-updated_date", 200);
        setTickets(fetchedTickets);
        console.log(`⏱️ [Tickets] Loaded ${fetchedTickets.length} tickets in ${Date.now() - start}ms`);
    } catch (error) {
        console.error("❌ Error loading tickets:", error);
    } finally {
        setIsLoading(false);
    }
  };
  
  const handleTicketCreated = () => {
      loadTickets();
  }

  const handleTicketSelect = (ticket) => {
    if (selectedTicket?.id === ticket.id) {
        setSelectedTicket(null);
    } else {
        setSelectedTicket(ticket);
    }
  };

  const handleTicketUpdate = async () => {
    await loadTickets();
    if (selectedTicket?.id) {
      try {
        const updatedTicket = await Ticket.get(selectedTicket.id);
        setSelectedTicket(updatedTicket);
      } catch (error) {
        console.error("Error updating ticket:", error);
        setSelectedTicket(null);
      }
    }
  };

  const handleDeleteTicket = async (ticket) => {
    if (window.confirm(`האם למחוק את טיקט #${ticket.ticket_number}?`)) {
      try {
        await Ticket.delete(ticket.id);
        if (selectedTicket?.id === ticket.id) {
            setSelectedTicket(null);
        }
        loadTickets();
      } catch (error) {
        console.error("Error deleting ticket:", error);
        alert("שגיאה במחיקת הטיקט.");
      }
    }
  };

  const handleCheckTicket = (ticketId) => {
    setSelectedTicketIds(prev => {
      if (prev.includes(ticketId)) {
        return prev.filter(id => id !== ticketId);
      } else {
        return [...prev, ticketId];
      }
    });
  };

  const handleSelectAll = () => {
    if (selectedTicketIds.length === filteredTickets.length) {
      setSelectedTicketIds([]);
    } else {
      setSelectedTicketIds(filteredTickets.map(t => t.id));
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedTicketIds.length === 0) return;
    
    if (window.confirm(`האם למחוק ${selectedTicketIds.length} טיקטים נבחרים? פעולה זו בלתי הפיכה!`)) {
      setIsDeleting(true);
      const idsToDelete = [...selectedTicketIds];
      const count = idsToDelete.length;
      let successCount = 0;
      let failCount = 0;
      
      for (const id of idsToDelete) {
        try {
          await Ticket.delete(id);
          successCount++;
        } catch (error) {
          console.error(`Error deleting ticket ${id}:`, error);
          failCount++;
        }
      }
      
      setSelectedTicketIds([]);
      setSelectedTicket(null);
      await loadTickets();
      
      if (failCount === 0) {
        alert(`✅ נמחקו ${successCount} טיקטים בהצלחה`);
      } else {
        alert(`נמחקו ${successCount} טיקטים, ${failCount} נכשלו`);
      }
      
      setIsDeleting(false);
    }
  };

  // Reset page on filter change
  useEffect(() => { setCurrentPage(1); }, [filters, statusFilter]);

  const clientsMap = useMemo(() => {
    const map = {};
    clients.forEach(c => { if (c?.id) map[c.id] = c; });
    return map;
  }, [clients]);

  const getClientById = useCallback((id) => {
    if (!id) return null;
    return clientsMap[id] || null;
  }, [clientsMap]);

  const filteredTickets = useMemo(() => {
      if (!Array.isArray(tickets)) return [];
      
      return tickets.filter(ticket => {
          if (!ticket) return false;
          const client = getClientById(ticket.customer_id);

          const ticketStatus = ticket.status || '';
          const isClosed = ["נסגר", "נסגר ללא מענה"].includes(ticketStatus);
          let statusMatch = true;
          if (statusFilter === 'open') {
              statusMatch = !isClosed;
          } else if (statusFilter === 'closed') {
              statusMatch = isClosed;
          } 

          const searchTerm = filters?.searchTerm || '';
          const normalizedSearch = searchTerm.toLowerCase().trim();

          let phoneMatch = false;
          if (client?.phone && /\d/.test(normalizedSearch)) {
              const normalizePhone = (str) => (str || '').replace(/\D/g, '');
              const normalizedClientPhone = normalizePhone(client.phone);
              const normalizedSearchPhone = normalizePhone(normalizedSearch);

              if (normalizedSearchPhone.length >= 4) {
                  phoneMatch = normalizedClientPhone.includes(normalizedSearchPhone);
              }
          }

          const searchTermMatch = !normalizedSearch ||
              (ticket.ticket_number != null && ticket.ticket_number.toString().includes(normalizedSearch)) ||
              (ticket.subject && ticket.subject.toLowerCase().includes(normalizedSearch)) ||
              (client?.full_name && client.full_name.toLowerCase().includes(normalizedSearch)) ||
              phoneMatch || 
              (client?.email && client.email.toLowerCase().includes(normalizedSearch));

          const assigneeFilter = filters?.assigneeId || 'all';
          const categoryFilter = filters?.category || 'all';
          
          const assigneeMatch = (assigneeFilter === 'all') || (ticket.assigned_to === assigneeFilter);
          const categoryMatch = (categoryFilter === 'all') || (getTicketCategory(ticket) === categoryFilter);

          return statusMatch && searchTermMatch && assigneeMatch && categoryMatch;
      });
  }, [tickets, filters, statusFilter, getClientById]);

  return (
    <div className="p-2 sm:p-4 md:p-6 space-y-4 max-w-full overflow-hidden">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">ניהול טיקטים</h1>
            <div className="flex gap-2">
                {isManager && selectedTicketIds.length > 0 && (
                    <Button 
                        onClick={handleDeleteSelected}
                        disabled={isDeleting}
                        variant="destructive"
                        className="shadow-md text-sm"
                    >
                        <Trash2 className="w-4 h-4 ml-2" />
                        {isDeleting ? 'מוחק...' : `מחק ${selectedTicketIds.length} נבחרים`}
                    </Button>
                )}
                <Button onClick={() => setIsNewTicketModalOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white shadow-md w-full sm:w-auto text-sm">
                    <PlusCircle className="w-4 h-4 ml-2" />
                    צור טיקט חדש
                </Button>
            </div>
        </div>
      
        <Tabs value={statusFilter} onValueChange={setStatusFilter} className="w-full">
            <TabsList className="grid w-full grid-cols-3 h-auto">
                <TabsTrigger value="open" className="text-sm py-2">פתוחים</TabsTrigger>
                <TabsTrigger value="closed" className="text-sm py-2">סגורים</TabsTrigger>
                <TabsTrigger value="all" className="text-sm py-2">הכל</TabsTrigger>
            </TabsList>
        </Tabs>
        
        <TicketFilters employees={employees} onFilterChange={setFilters} />

        {isManager && filteredTickets.length > 0 && (
            <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <button
                    onClick={handleSelectAll}
                    className="flex items-center gap-2 hover:bg-blue-100 px-3 py-2 rounded-lg transition-colors"
                >
                    {selectedTicketIds.length === filteredTickets.length ? (
                        <CheckSquare className="w-5 h-5 text-blue-600" />
                    ) : (
                        <Square className="w-5 h-5 text-gray-400" />
                    )}
                    <span className="text-sm font-medium">
                        {selectedTicketIds.length === filteredTickets.length ? 'בטל בחירת הכל' : 'בחר הכל'}
                    </span>
                </button>
                {selectedTicketIds.length > 0 && (
                    <Badge variant="secondary" className="text-sm">
                        {selectedTicketIds.length} נבחרו
                    </Badge>
                )}
            </div>
        )}

        <div className="space-y-2">
            <AnimatePresence>
                {(isLoading || clientsLoading) ? (
                    <div className="text-center py-8 sm:py-16 text-gray-500 glass-card rounded-2xl">
                        <Inbox className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-4 text-gray-400" />
                        <p className="text-sm sm:text-base">אין טיקטים להצגה התואמים לסינון.</p>
                    </div>
                ) : (
                    filteredTickets.slice((currentPage - 1) * TICKETS_PER_PAGE, currentPage * TICKETS_PER_PAGE).map((ticket) => {
                       const client = getClientById(ticket.customer_id);
                       return (
                           <React.Fragment key={ticket.id}>
                                <TicketRow
                                    ticket={ticket}
                                    customer={client}
                                    assignedAgent={employeesMap[ticket.assigned_to]}
                                    onSelect={handleTicketSelect}
                                    isSelected={selectedTicket?.id === ticket.id}
                                    onDelete={handleDeleteTicket}
                                    isManager={isManager}
                                    isChecked={selectedTicketIds.includes(ticket.id)}
                                    onCheck={handleCheckTicket}
                                />
                                <AnimatePresence>
                                    {selectedTicket?.id === ticket.id && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: "auto" }}
                                            exit={{ opacity: 0, height: 0 }}
                                            transition={{ duration: 0.3 }}
                                            className="overflow-hidden"
                                        >
                                            <div className="bg-slate-50 p-2 sm:p-4 my-2 rounded-lg border">
                                                <TicketDetails 
                                                    ticket={selectedTicket} 
                                                    customer={client}
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
                )}
            </AnimatePresence>
        </div>

        {/* Pagination */}
        {Math.ceil(filteredTickets.length / TICKETS_PER_PAGE) > 1 && (
          <div className="flex items-center justify-center gap-4 mt-4">
            <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>הקודם</Button>
            <span className="text-sm text-gray-600">עמוד {currentPage} מתוך {Math.ceil(filteredTickets.length / TICKETS_PER_PAGE)}</span>
            <Button variant="outline" size="sm" disabled={currentPage >= Math.ceil(filteredTickets.length / TICKETS_PER_PAGE)} onClick={() => setCurrentPage(p => p + 1)}>הבא</Button>
          </div>
        )}
        
        <NewTicketModal 
            isOpen={isNewTicketModalOpen}
            onClose={() => setIsNewTicketModalOpen(false)}
            onTicketCreated={loadTickets}
        />
    </div>
  );
}