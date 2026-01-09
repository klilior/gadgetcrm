import React, { useState, useEffect } from "react";
import { Activity, Employee, Ticket } from "@/entities/all";
import { customersService } from "../components/utils/customersService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, MessageCircle, PlayCircle, User } from "lucide-react";
import { format } from "date-fns";
import SendMessageModal from "../components/customers/SendMessageModal";

export default function TodaysCalls() {
  const [calls, setCalls] = useState([]);
  const [employeesMap, setEmployeesMap] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [whatsAppCall, setWhatsAppCall] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [fetchedCalls, fetchedEmployees] = await Promise.all([
        Activity.filter({
            activity_type: { $in: ["שיחה נכנסת", "שיחה יוצאת"] },
            created_date: { $gte: today.toISOString() }
        }, "-created_date"),
        Employee.list()
    ]);
    
    const empMap = fetchedEmployees.reduce((acc, emp) => ({...acc, [emp.id]: emp}), {});
    
    const ticketIds = [...new Set(fetchedCalls.map(c => c.ticket_id).filter(Boolean))];
    if (ticketIds.length > 0) {
        const tickets = await Ticket.filter({ id: { $in: ticketIds } });
        const customerIds = [...new Set(tickets.map(t => t.customer_id).filter(Boolean))];
        const customers = customerIds.length > 0 ? await customersService.getByIds(customerIds) : [];

        const ticketMap = tickets.reduce((acc, t) => ({...acc, [t.id]: t}), {});
        const customerMap = customers.reduce((acc, c) => ({...acc, [c.id]: c}), {});

        const enrichedCalls = fetchedCalls.map(call => {
            const ticket = ticketMap[call.ticket_id];
            const customer = ticket ? customerMap[ticket.customer_id] : null;
            return { ...call, customer };
        });
        
        setCalls(enrichedCalls);
    } else {
        setCalls(fetchedCalls);
    }

    setEmployeesMap(empMap);
    setIsLoading(false);
  };
  
  const getActivityIcon = (type) => {
    switch (type) {
      case "שיחה נכנסת": return <PhoneIncoming className="w-4 h-4 text-green-500" />;
      case "שיחה יוצאת": return <PhoneOutgoing className="w-4 h-4 text-blue-500" />;
      default: return <PhoneMissed className="w-4 h-4 text-red-500" />;
    }
  };

  const formatTime = (dateString) => {
    if (!dateString) return "";
    try {
        return format(new Date(dateString), "HH:mm");
    } catch {
        return "שעה לא תקינה";
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">שיחות להיום</h1>
      
      <Card className="glass-card border-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="w-5 h-5"/>
            יומן שיחות
          </CardTitle>
        </CardHeader>
        <CardContent>
            {/* Mobile View */}
            <div className="space-y-4 md:hidden">
              {isLoading ? (
                Array(3).fill(0).map((_, i) => <div key={i} className="glass-card p-4 animate-pulse h-28 rounded-2xl"></div>)
              ) : calls.length === 0 ? (
                <div className="text-center py-10 text-gray-500">אין שיחות להצגה להיום.</div>
              ) : (
                calls.map((call) => (
                    <div key={call.id} className="glass-card p-4 rounded-2xl space-y-3">
                        <div className="flex justify-between items-start">
                            <div className="flex items-center gap-2 font-bold">
                                {getActivityIcon(call.activity_type)}
                                <span>{call.activity_type}</span>
                            </div>
                            <span className="text-sm text-gray-600">{formatTime(call.created_date)}</span>
                        </div>
                        <p className="text-sm">{call.content}</p>
                        <div className="text-sm flex items-center gap-2 text-gray-700">
                            <User className="w-4 h-4"/>
                            <span>{employeesMap[call.agent_id]?.employee_name || "לא משויך"}</span>
                        </div>
                         <div className="flex gap-2 pt-2 border-t border-white/20">
                            {call.recording_url && (
                                <Button variant="outline" size="sm" className="glass-button flex-1" onClick={() => window.open(call.recording_url, "_blank")}>
                                <PlayCircle className="w-4 h-4 ml-2" />
                                הקלטה
                                </Button>
                            )}
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="glass-button flex-1"
                                onClick={() => call.customer && setWhatsAppCall(call)}
                                disabled={!call.customer}
                            >
                                <MessageCircle className="w-4 h-4 ml-2" />
                                וואטסאפ
                            </Button>
                         </div>
                    </div>
                ))
              )}
            </div>

            {/* Desktop View */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>סוג</TableHead>
                    <TableHead>נציג</TableHead>
                    <TableHead>לקוח</TableHead>
                    <TableHead>תוכן</TableHead>
                    <TableHead>שעה</TableHead>
                    <TableHead>פעולות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array(5).fill(0).map((_, i) => (
                      <TableRow key={i} className="animate-pulse">
                        <TableCell><div className="h-5 w-5 rounded-full bg-white/20"></div></TableCell>
                        <TableCell><div className="h-4 w-24 rounded bg-white/20"></div></TableCell>
                        <TableCell><div className="h-4 w-24 rounded bg-white/20"></div></TableCell>
                        <TableCell><div className="h-4 w-48 rounded bg-white/20"></div></TableCell>
                        <TableCell><div className="h-4 w-16 rounded bg-white/20"></div></TableCell>
                        <TableCell><div className="h-8 w-24 rounded-lg bg-white/20"></div></TableCell>
                      </TableRow>
                    ))
                  ) : calls.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-10 text-gray-500">
                          אין שיחות להצגה להיום.
                        </TableCell>
                      </TableRow>
                  ) : (
                    calls.map((call) => (
                      <TableRow key={call.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getActivityIcon(call.activity_type)}
                            <span>{call.activity_type}</span>
                          </div>
                        </TableCell>
                        <TableCell>{employeesMap[call.agent_id]?.employee_name || "לא משויך"}</TableCell>
                        <TableCell>{call.customer?.full_name || 'לא משויך'}</TableCell>
                        <TableCell>{call.content}</TableCell>
                        <TableCell>{formatTime(call.created_date)}</TableCell>
                        <TableCell className="flex gap-2">
                          {call.recording_url && (
                            <Button variant="outline" size="sm" className="glass-button" onClick={() => window.open(call.recording_url, "_blank")}>
                              <PlayCircle className="w-4 h-4 ml-2" />
                              הקלטה
                            </Button>
                          )}
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="glass-button"
                            onClick={() => call.customer && setWhatsAppCall(call)}
                            disabled={!call.customer}
                           >
                            <MessageCircle className="w-4 h-4 ml-2" />
                            וואטסאפ
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
        </CardContent>
      </Card>
      <SendMessageModal
        isOpen={!!whatsAppCall}
        onClose={() => setWhatsAppCall(null)}
        customer={whatsAppCall?.customer}
        ticketId={whatsAppCall?.ticket_id}
      />
    </div>
  );
}