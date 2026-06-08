import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Lead } from '@/entities/all';
import { base44 } from '@/api/base44Client';
import CustomerLookupPanel, { buildCustomerNote, customerToShipmentData } from '@/components/customers/CustomerLookupPanel';
import UPSShipmentForm from '@/components/shipping/UPSShipmentForm';
import CargoShipmentForm from '@/components/shipping/CargoShipmentForm';
import GetPackageShipmentForm from '@/components/shipping/GetPackageShipmentForm';
import { useUser } from '../UserAuth';
import { useEmployees } from '../EmployeeProvider';
import { toast } from 'sonner';
import { Phone, User, FileText, Bell, Clock, Loader2, StickyNote, Truck } from 'lucide-react';

export default function QuickLeadModal({ isOpen, onClose, onLeadCreated }) {
  const { currentUser } = useUser();
  const { employees } = useEmployees();
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showShipmentCreator, setShowShipmentCreator] = useState(false);
  const [shipmentProvider, setShipmentProvider] = useState('ups');
  const [activeProviders, setActiveProviders] = useState({ ups: true, cargo: false, getpackage: false });
  const [shipmentCustomerData, setShipmentCustomerData] = useState(null);
  
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
    if (isOpen) return;
    setShowShipmentCreator(false);
    setShipmentCustomerData(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const loadProviders = async () => {
      const map = { ups: true, cargo: false, getpackage: false };
      const providers = await base44.entities.ShippingProvider.list().catch(() => []);
      providers.forEach(p => { if (p.provider_type === 'cargo' && p.is_active) map.cargo = true; });
      const gpSettings = await base44.entities.GetPackageSettings.list('-created_date', 1).catch(() => []);
      if (gpSettings?.[0]?.is_active) map.getpackage = true;
      setActiveProviders(map);
    };
    loadProviders();
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

  const applyCustomer = (customer) => {
    setSelectedCustomer(customer);
    const customerNote = buildCustomerNote(customer);
    setFormData(prev => ({
      ...prev,
      phone: customer.phone || prev.phone,
      customer_name: customer.full_name || prev.customer_name,
      notes: prev.notes?.includes('פרטי לקוח קיימים:') ? prev.notes : [prev.notes, customerNote].filter(Boolean).join('\n\n')
    }));
  };

  const handleSubmit = async (e, createShipmentAfter = false) => {
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

      const createdLead = await Lead.create(leadData);
      
      toast.success(`ליד נשמר והוקצה ל-${formData.assigned_to_name}`);
      
      if (onLeadCreated) onLeadCreated();

      if (createShipmentAfter) {
        setShipmentCustomerData(selectedCustomer ? customerToShipmentData(selectedCustomer) : {
          name: formData.customer_name,
          phone: formData.phone,
          city: '',
          address: '',
          email: '',
          customer: null,
          reference: createdLead?.id || ''
        });
        setShowShipmentCreator(true);
        return;
      }
      
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
      setSelectedCustomer(null);
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

  if (showShipmentCreator) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Truck className="w-5 h-5 text-blue-600" />
              יצירת משלוח מהפתק
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <Button type="button" variant={shipmentProvider === 'ups' ? 'default' : 'outline'} disabled={!activeProviders.ups} onClick={() => setShipmentProvider('ups')}>UPS</Button>
              <Button type="button" variant={shipmentProvider === 'cargo' ? 'default' : 'outline'} disabled={!activeProviders.cargo} onClick={() => setShipmentProvider('cargo')}>קארגו</Button>
              <Button type="button" variant={shipmentProvider === 'getpackage' ? 'default' : 'outline'} disabled={!activeProviders.getpackage} onClick={() => setShipmentProvider('getpackage')}>GetPackage</Button>
            </div>

            {shipmentProvider === 'ups' && <UPSShipmentForm initialCustomer={shipmentCustomerData} />}
            {shipmentProvider === 'cargo' && <CargoShipmentForm initialCustomer={shipmentCustomerData} />}
            {shipmentProvider === 'getpackage' && <GetPackageShipmentForm initialCustomer={shipmentCustomerData} />}

            <Button type="button" variant="outline" onClick={onClose} className="w-full">סגור</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

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

          <CustomerLookupPanel
            phoneValue={formData.phone}
            onSelect={applyCustomer}
            compact
          />

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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              ביטול
            </Button>
            <Button 
              type="button"
              disabled={isLoading}
              onClick={(e) => handleSubmit(e, true)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Truck className="w-4 h-4 ml-1" />
              שמור וצור משלוח
            </Button>
            <Button 
              type="submit" 
              disabled={isLoading}
              className="bg-purple-600 hover:bg-purple-700"
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