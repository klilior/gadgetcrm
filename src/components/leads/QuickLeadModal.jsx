import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Lead } from '@/entities/all';
import { base44 } from '@/api/base44Client';
import CustomerLookupPanel, { buildCustomerNote } from '@/components/customers/CustomerLookupPanel';
import UPSShipmentForm from '@/components/shipping/UPSShipmentForm';
import CargoShipmentForm from '@/components/shipping/CargoShipmentForm';
import GetPackageShipmentForm from '@/components/shipping/GetPackageShipmentForm';
import { useUser } from '../UserAuth';
import { useEmployees } from '../EmployeeProvider';
import { toast } from 'sonner';
import { Phone, User, FileText, Bell, Clock, Loader2, StickyNote, Truck, MapPin } from 'lucide-react';

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
    email: '',
    city: '',
    street: '',
    house: '',
    zip: '',
    floor: '',
    apartment: '',
    entrance: '',
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

  const buildFullAddress = (data = formData) => [data.street, data.house].filter(Boolean).join(' ').trim();

  const buildShipmentCustomer = (leadId = '') => ({
    name: formData.customer_name || selectedCustomer?.full_name || '',
    phone: formData.phone || selectedCustomer?.phone || '',
    email: formData.email || selectedCustomer?.email || '',
    city: formData.city || selectedCustomer?.city || '',
    street: formData.street || selectedCustomer?.full_address || '',
    house: formData.house || '',
    zip: formData.zip || '',
    floor: formData.floor || '',
    apartment: formData.apartment || '',
    entrance: formData.entrance || '',
    address: buildFullAddress() || selectedCustomer?.full_address || '',
    notes: [formData.floor ? `קומה ${formData.floor}` : '', formData.apartment ? `דירה ${formData.apartment}` : '', formData.entrance ? `כניסה ${formData.entrance}` : ''].filter(Boolean).join(', '),
    reference: leadId,
    customer: selectedCustomer || null,
  });

  const applyCustomer = (customer) => {
    setSelectedCustomer(customer);
    const customerNote = buildCustomerNote(customer);
    setFormData(prev => ({
      ...prev,
      phone: customer.phone || prev.phone,
      customer_name: customer.full_name || prev.customer_name,
      email: customer.email || prev.email,
      city: customer.city || prev.city,
      street: customer.full_address || prev.street,
      notes: prev.notes?.includes('פרטי לקוח קיימים:') ? prev.notes : [prev.notes, customerNote].filter(Boolean).join('\n\n')
    }));
  };

  const handleSubmit = async (e, createShipmentAfter = false) => {
    e.preventDefault();
    
    const assignedTo = formData.assigned_to || currentUser?.id || '';
    const assignedName = formData.assigned_to_name || currentUser?.employee_name || currentUser?.full_name || '';

    if (!formData.phone || !assignedTo || (!createShipmentAfter && !formData.topic)) {
      toast.error(createShipmentAfter ? 'נא למלא לפחות טלפון ולהקצות לנציג' : 'נא למלא טלפון, נושא ולהקצות לנציג');
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

      const fullAddress = buildFullAddress();
      const addressNote = [
        fullAddress ? `כתובת למשלוח: ${fullAddress}` : null,
        formData.city ? `עיר: ${formData.city}` : null,
        formData.floor ? `קומה: ${formData.floor}` : null,
        formData.apartment ? `דירה: ${formData.apartment}` : null,
        formData.entrance ? `כניסה: ${formData.entrance}` : null,
      ].filter(Boolean).join('\n');
      const mergedNotes = [formData.notes || '', addressNote].filter(Boolean).join('\n\n');

      const leadData = {
        phone: formData.phone,
        customer_name: formData.customer_name || '',
        email: formData.email || '',
        city: formData.city || '',
        street: formData.street || '',
        house: formData.house || '',
        zip: formData.zip || '',
        floor: formData.floor || '',
        apartment: formData.apartment || '',
        entrance: formData.entrance || '',
        full_address: fullAddress,
        topic: formData.topic || 'משלוח מהיר',
        notes: mergedNotes,
        assigned_to: assignedTo,
        assigned_to_name: assignedName,
        status: 'New',
        reminder_at: formData.reminder_at || null,
        reminder_done: false,
        sla_due_at: slaDueAt,
        capture_type: 'Quick',
        quick_incomplete: true
      };

      const createdLead = await Lead.create(leadData);

      if (selectedCustomer?.id) {
        await base44.entities.Client.update(selectedCustomer.id, {
          full_name: formData.customer_name || selectedCustomer.full_name || '',
          phone: formData.phone || selectedCustomer.phone || '',
          email: formData.email || selectedCustomer.email || '',
          city: formData.city || selectedCustomer.city || '',
          full_address: fullAddress || selectedCustomer.full_address || '',
        });
      }
      
      toast.success(`ליד נשמר והוקצה ל-${assignedName}`);
      
      if (onLeadCreated) onLeadCreated();

      if (createShipmentAfter) {
        setShipmentCustomerData(buildShipmentCustomer(createdLead?.id || ''));
        setShowShipmentCreator(true);
        return;
      }
      
      // Reset form
      setFormData({
        phone: '',
        customer_name: '',
        email: '',
        city: '',
        street: '',
        house: '',
        zip: '',
        floor: '',
        apartment: '',
        entrance: '',
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              <Label className="mb-1">אימייל</Label>
              <Input
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="אימייל לקוח"
                dir="ltr"
                className="text-right"
              />
            </div>
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-800">
              <MapPin className="w-4 h-4" />
              כתובת למשלוח — ימולא אוטומטית מלקוח קיים או ידנית ללקוח חדש
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <Label>עיר</Label>
                <Input value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label>רחוב / כתובת</Label>
                <Input value={formData.street} onChange={(e) => setFormData({ ...formData, street: e.target.value })} />
              </div>
              <div>
                <Label>בית</Label>
                <Input value={formData.house} onChange={(e) => setFormData({ ...formData, house: e.target.value })} />
              </div>
              <div>
                <Label>קומה</Label>
                <Input value={formData.floor} onChange={(e) => setFormData({ ...formData, floor: e.target.value })} />
              </div>
              <div>
                <Label>דירה</Label>
                <Input value={formData.apartment} onChange={(e) => setFormData({ ...formData, apartment: e.target.value })} />
              </div>
              <div>
                <Label>כניסה</Label>
                <Input value={formData.entrance} onChange={(e) => setFormData({ ...formData, entrance: e.target.value })} />
              </div>
              <div>
                <Label>מיקוד</Label>
                <Input value={formData.zip} onChange={(e) => setFormData({ ...formData, zip: e.target.value })} dir="ltr" className="text-right" />
              </div>
            </div>
          </div>

          <div>
            <Label className="flex items-center gap-1 mb-1">
              <FileText className="w-4 h-4" />
              נושא
            </Label>
            <Input
              value={formData.topic}
              onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
              placeholder="נדרש רק לשמירת פתק רגילה"
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