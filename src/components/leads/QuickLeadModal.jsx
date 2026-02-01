import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Lead, Employee } from '@/entities/all';
import { useUser } from '../UserAuth';
import { toast } from 'sonner';
import { Phone, User, FileText, Bell, Clock, Loader2, StickyNote } from 'lucide-react';

export default function QuickLeadModal({ isOpen, onClose, onLeadCreated }) {
  const { currentUser } = useUser();
  const [isLoading, setIsLoading] = useState(false);
  const [employees, setEmployees] = useState([]);
  
  const [formData, setFormData] = useState({
    phone: '',
    customer_name: '',
    topic: '',
    notes: '',
    assigned_to: '',
    assigned_to_name: '',
    reminder_at: '',
    sla_due_at: ''
  });

  useEffect(() => {
    if (isOpen) {
      loadEmployees();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !currentUser || employees.length === 0) return;
    const me = employees.find(e => e.employee_name === (currentUser.employee_name || currentUser.full_name));
    if (me) {
      setFormData(prev => ({
        ...prev,
        assigned_to: me.id,
        assigned_to_name: me.employee_name
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        assigned_to: currentUser.id,
        assigned_to_name: currentUser.employee_name || currentUser.full_name
      }));
    }
  }, [isOpen, currentUser, employees]);

  const loadEmployees = async () => {
    try {
      const emps = await Employee.filter({ is_active: true });
      setEmployees(emps || []);
    } catch (error) {
      console.error('Error loading employees:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.phone || !formData.topic || !formData.assigned_to) {
      toast.error('נא למלא טלפון, נושא ולהקצות לנציג');
      return;
    }

    setIsLoading(true);
    try {
      const now = new Date();
      // If no SLA set, default to 2 hours from now
      let slaDueAt = formData.sla_due_at;
      if (!slaDueAt) {
        const slaDate = new Date(now.getTime() + 2 * 60 * 60 * 1000);
        slaDueAt = slaDate.toISOString();
      }

      const leadData = {
        phone: formData.phone,
        customer_name: formData.customer_name || '',
        topic: formData.topic,
        notes: formData.notes || '',
        assigned_to: formData.assigned_to,
        assigned_to_name: formData.assigned_to_name,
        status: 'New',
        reminder_at: formData.reminder_at || null,
        reminder_done: false,
        sla_due_at: slaDueAt,
        capture_type: 'Quick',
        quick_incomplete: true
      };

      await Lead.create(leadData);
      
      toast.success(`ליד נשמר והוקצה ל-${formData.assigned_to_name}`);
      
      // Reset form
      setFormData({
        phone: '',
        customer_name: '',
        topic: '',
        notes: '',
        assigned_to: currentUser?.id || '',
        assigned_to_name: currentUser?.employee_name || currentUser?.full_name || '',
        reminder_at: '',
        sla_due_at: ''
      });
      
      if (onLeadCreated) onLeadCreated();
      onClose();
    } catch (error) {
      console.error('Error creating lead:', error);
      toast.error('שגיאה ביצירת הליד');
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <StickyNote className="w-5 h-5 text-purple-600" />
            פתק מהיר
          </DialogTitle>
        </DialogHeader>

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
              className="text-lg"
              autoFocus
            />
          </div>

          <div>
            <Label className="flex items-center gap-1 mb-1">
              <User className="w-4 h-4" />
              שם לקוח
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
            <Label className="mb-1">הערות</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="הערות נוספות..."
              rows={2}
            />
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

          <p className="text-xs text-gray-500">
            * אם לא הוגדר SLA, יוגדר אוטומטית ל-2 שעות מעכשיו
          </p>

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
                'שמור ליד'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}