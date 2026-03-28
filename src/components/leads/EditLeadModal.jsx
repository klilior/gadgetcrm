import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Lead } from '@/entities/all';
import { toast } from 'sonner';
import { useEmployees } from '../EmployeeProvider';
import { Phone, User, FileText, Bell, Clock, Loader2, Save, StickyNote } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function EditLeadModal({ isOpen, onClose, lead, onLeadUpdated }) {
  const { employees } = useEmployees();
  const [isLoading, setIsLoading] = useState(false);
  
  const [formData, setFormData] = useState({
    phone: '',
    customer_name: '',
    topic: '',
    notes: '',
    assigned_to: '',
    assigned_to_name: '',
    status: 'New',
    reminder_at: '',
    sla_due_at: ''
  });

  useEffect(() => {
    if (isOpen && lead) {
      setFormData({
        phone: lead.phone || '',
        customer_name: lead.customer_name || '',
        topic: lead.topic || '',
        notes: lead.notes || '',
        assigned_to: lead.assigned_to || '',
        assigned_to_name: lead.assigned_to_name || '',
        status: lead.status || 'New',
        reminder_at: lead.reminder_at ? lead.reminder_at.slice(0, 16) : '',
        sla_due_at: lead.sla_due_at ? lead.sla_due_at.slice(0, 16) : ''
      });
    }
  }, [isOpen, lead]);

  const shouldMarkComplete = (data) => {
    // Check if lead should exit quick_incomplete status
    if (data.customer_name && data.customer_name.trim()) return true;
    if (data.notes && data.notes.length >= 30) return true;
    if (data.status === 'InProgress') return true;
    if (data.reminder_at) return true;
    return false;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.phone || !formData.topic || !formData.assigned_to) {
      toast.error('נא למלא טלפון, נושא ולהקצות לנציג');
      return;
    }

    setIsLoading(true);
    try {
      const updateData = {
        phone: formData.phone,
        customer_name: formData.customer_name || '',
        topic: formData.topic,
        notes: formData.notes || '',
        assigned_to: formData.assigned_to,
        assigned_to_name: formData.assigned_to_name,
        status: formData.status,
        reminder_at: formData.reminder_at || null,
        sla_due_at: formData.sla_due_at || lead.sla_due_at
      };

      // Check if we should mark as complete
      if (lead.quick_incomplete && shouldMarkComplete(updateData)) {
        updateData.quick_incomplete = false;
        updateData.capture_type = 'Full';
      }

      await Lead.update(lead.id, updateData);
      
      toast.success('הליד עודכן בהצלחה');
      
      if (onLeadUpdated) onLeadUpdated();
      onClose();
    } catch (error) {
      console.error('Error updating lead:', error);
      toast.error('שגיאה בעדכון הליד');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAssigneeChange = (userId) => {
    const emp = employees.find(e => e.id === userId);
    setFormData(prev => ({
      ...prev,
      assigned_to: userId,
      assigned_to_name: emp?.employee_name || ''
    }));
  };

  if (!lead) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <FileText className="w-5 h-5 text-purple-600" />
            עריכת ליד
            {lead.quick_incomplete && (
              <Badge className="bg-purple-100 text-purple-800 text-xs mr-2">QUICK</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {lead.quick_incomplete && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-800">
            <StickyNote className="w-4 h-4 inline ml-1" />
            זהו פתק מהיר. השלם את הפרטים כדי להוציא מרשימת ההשלמה.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="flex items-center gap-1 mb-1">
              <Phone className="w-4 h-4" />
              טלפון *
            </Label>
            <Input
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="05X-XXXXXXX"
            />
          </div>

          <div>
            <Label className="flex items-center gap-1 mb-1">
              <User className="w-4 h-4" />
              שם לקוח
              {lead.quick_incomplete && <span className="text-purple-600 text-xs">(ימלא להשלמה)</span>}
            </Label>
            <Input
              value={formData.customer_name}
              onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
              placeholder="שם הלקוח"
            />
          </div>

          <div>
            <Label className="flex items-center gap-1 mb-1">
              <FileText className="w-4 h-4" />
              נושא *
            </Label>
            <Input
              value={formData.topic}
              onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
              placeholder="נושא הפנייה"
            />
          </div>

          <div>
            <Label className="mb-1">
              הערות
              {lead.quick_incomplete && <span className="text-purple-600 text-xs mr-1">(30+ תווים להשלמה)</span>}
            </Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="הערות נוספות..."
              rows={3}
            />
            {formData.notes && (
              <p className="text-xs text-gray-500 mt-1">{formData.notes.length} תווים</p>
            )}
          </div>

          <div>
            <Label className="flex items-center gap-1 mb-1">
              <User className="w-4 h-4" />
              הקצה לנציג *
            </Label>
            <Select value={formData.assigned_to} onValueChange={handleAssigneeChange}>
              <SelectTrigger>
                <SelectValue placeholder="בחר נציג" />
              </SelectTrigger>
              <SelectContent>
                {employees.map(emp => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {emp.employee_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-1">סטטוס</Label>
            <Select value={formData.status} onValueChange={(val) => setFormData({ ...formData, status: val })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="New">חדש</SelectItem>
                <SelectItem value="InProgress">בטיפול</SelectItem>
                <SelectItem value="Closed">נסגר</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="flex items-center gap-1 mb-1">
                <Bell className="w-4 h-4" />
                תזכורת
              </Label>
              <Input
                type="datetime-local"
                value={formData.reminder_at}
                onChange={(e) => setFormData({ ...formData, reminder_at: e.target.value })}
              />
            </div>
            <div>
              <Label className="flex items-center gap-1 mb-1">
                <Clock className="w-4 h-4" />
                יעד SLA
              </Label>
              <Input
                type="datetime-local"
                value={formData.sla_due_at}
                onChange={(e) => setFormData({ ...formData, sla_due_at: e.target.value })}
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              ביטול
            </Button>
            <Button 
              type="submit" 
              disabled={isLoading}
              className="flex-1 bg-purple-600 hover:bg-purple-700"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  שומר...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 ml-2" />
                  שמור
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}