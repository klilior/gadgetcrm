import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { 
  Package, Phone, MessageCircle, ChevronDown, ChevronUp, 
  Truck, Clock, X, Search, Filter, RefreshCw
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { he } from "date-fns/locale";
import UndeliveredOrderCard from "./UndeliveredOrderCard";

const TRIGGER_SKU = "963258741";

export default function UndeliveredOrdersWidget({ 
  currentUser, 
  isManager = false,
  employees = [],
  compact = false,
  onRefresh
}) {
  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedTask, setExpandedTask] = useState(null);
  
  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRep, setSelectedRep] = useState("all");
  
  // Close modal state
  const [closeModal, setCloseModal] = useState({ open: false, task: null, reason: null });
  const [closeNote, setCloseNote] = useState("");
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    loadTasks();
  }, [currentUser, selectedRep]);

  const loadTasks = async () => {
    if (!currentUser) return;
    setIsLoading(true);
    try {
      let query = { status: "Open" };
      
      if (isManager && selectedRep !== "all") {
        query.owner_user_id = selectedRep;
      }
      
      const data = await base44.entities.UndeliveredOrderTask.filter(query, '-created_date', 100).catch(() => []);
      setTasks(data);
    } catch (e) {
      console.error("Error loading undelivered orders:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCloseTask = async () => {
    if (!closeModal.task || !closeModal.reason) return;
    
    // Require note for cancellation
    if (closeModal.reason === "Cancelled" && !closeNote.trim()) {
      alert("יש להזין הערה בעת ביטול");
      return;
    }
    
    setIsClosing(true);
    try {
      const now = new Date().toISOString();
      const existingLog = closeModal.task.activity_log ? JSON.parse(closeModal.task.activity_log) : [];
      const newLog = [
        ...existingLog,
        {
          action: `סגירה: ${getReasonLabel(closeModal.reason)}`,
          user: currentUser.employee_name || currentUser.email,
          timestamp: now,
          note: closeNote || null
        }
      ];
      
      await base44.entities.UndeliveredOrderTask.update(closeModal.task.id, {
        status: "Closed",
        close_reason: closeModal.reason,
        close_note: closeNote || null,
        closed_at: now,
        activity_log: JSON.stringify(newLog)
      });
      
      setCloseModal({ open: false, task: null, reason: null });
      setCloseNote("");
      loadTasks();
      if (onRefresh) onRefresh();
    } catch (e) {
      console.error("Error closing task:", e);
      alert("שגיאה בסגירת המשימה");
    } finally {
      setIsClosing(false);
    }
  };

  const getReasonLabel = (reason) => {
    const labels = {
      Cargo: "נשלח בקרגו",
      UPS: "נשלח UPS",
      Pickup: "איסוף עצמי",
      Cancelled: "בוטל"
    };
    return labels[reason] || reason;
  };

  const getAgeDays = (task) => {
    if (!task.created_date) return 0;
    return differenceInDays(new Date(), new Date(task.created_date));
  };

  const getAgeColor = (days) => {
    if (days <= 1) return "bg-green-100 text-green-700";
    if (days <= 3) return "bg-yellow-100 text-yellow-700";
    return "bg-red-100 text-red-700";
  };

  const parseProducts = (productsJson) => {
    try {
      return JSON.parse(productsJson || "[]");
    } catch {
      return [];
    }
  };

  const openCloseModal = (task, reason) => {
    setCloseModal({ open: true, task, reason });
    setCloseNote("");
  };

  // Filter tasks by search
  const filteredTasks = tasks.filter(t => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      t.source_doc_number?.toLowerCase().includes(term) ||
      t.customer_name?.toLowerCase().includes(term) ||
      t.customer_phone?.includes(term)
    );
  });

  // Get unique reps for filter
  const uniqueReps = [...new Set(tasks.map(t => t.owner_user_id).filter(Boolean))];
  const repsWithNames = uniqueReps.map(id => {
    const emp = employees.find(e => e.id === id);
    const task = tasks.find(t => t.owner_user_id === id);
    return { id, name: emp?.employee_name || task?.owner_name || id };
  });

  if (compact && filteredTasks.length === 0) {
    return null;
  }

  return (
    <>
      <Card className="border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base md:text-lg flex items-center gap-2">
              <Package className="w-5 h-5 text-orange-600" />
              הזמנות שלא סופקו
              {filteredTasks.length > 0 && (
                <Badge className="bg-orange-500 text-white">{filteredTasks.length}</Badge>
              )}
            </CardTitle>
            
            <div className="flex items-center gap-2">
              {!compact && isManager && (
                <Select value={selectedRep} onValueChange={setSelectedRep}>
                  <SelectTrigger className="w-32 h-8 text-xs">
                    <SelectValue placeholder="כל הנציגים" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">כל הנציגים</SelectItem>
                    {repsWithNames.map(r => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              
              {!compact && (
                <div className="relative">
                  <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                  <Input 
                    placeholder="חיפוש..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-32 h-8 text-xs pr-7"
                  />
                </div>
              )}
              
              <Button variant="ghost" size="sm" onClick={loadTasks} disabled={isLoading}>
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        
        <CardContent>
          {isLoading ? (
            <div className="text-center py-4 text-gray-500">טוען...</div>
          ) : filteredTasks.length === 0 ? (
            <div className="text-center py-4 text-gray-500">
              <Package className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              אין הזמנות פתוחות
            </div>
          ) : (
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {filteredTasks.map(task => (
                <UndeliveredOrderCard
                  key={task.id}
                  task={task}
                  currentUser={currentUser}
                  isManager={isManager}
                  onTaskUpdated={() => {
                    loadTasks();
                    if (onRefresh) onRefresh();
                  }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Close Confirmation Modal */}
      <Dialog open={closeModal.open} onOpenChange={(open) => !open && setCloseModal({ open: false, task: null, reason: null })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>אישור סגירה</DialogTitle>
          </DialogHeader>
          
          <div className="py-4">
            <p className="text-gray-700">
              לאשר סגירת המשימה כ-<strong>{getReasonLabel(closeModal.reason)}</strong>?
            </p>
            
            {closeModal.task && (
              <div className="mt-3 p-3 bg-gray-50 rounded-lg text-sm">
                <div>מסמך: #{closeModal.task.source_doc_number}</div>
                <div>לקוח: {closeModal.task.customer_name}</div>
              </div>
            )}
            
            {closeModal.reason === "Cancelled" && (
              <div className="mt-4">
                <label className="text-sm font-medium text-gray-700">
                  הערת ביטול (חובה)
                </label>
                <Textarea 
                  value={closeNote}
                  onChange={e => setCloseNote(e.target.value)}
                  placeholder="נא לציין את סיבת הביטול..."
                  className="mt-1"
                  rows={3}
                />
              </div>
            )}
            
            {closeModal.reason !== "Cancelled" && (
              <div className="mt-4">
                <label className="text-sm font-medium text-gray-700">
                  הערה (אופציונלי)
                </label>
                <Textarea 
                  value={closeNote}
                  onChange={e => setCloseNote(e.target.value)}
                  placeholder="הערה נוספת..."
                  className="mt-1"
                  rows={2}
                />
              </div>
            )}
          </div>
          
          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => setCloseModal({ open: false, task: null, reason: null })}
            >
              ביטול
            </Button>
            <Button 
              onClick={handleCloseTask}
              disabled={isClosing || (closeModal.reason === "Cancelled" && !closeNote.trim())}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {isClosing ? "סוגר..." : "אישור"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}