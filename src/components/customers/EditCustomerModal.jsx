import React, { useState, useEffect } from 'react';
import { customersService } from '../utils/customersService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { X, User, Phone, Mail, MapPin, FileText, Save } from 'lucide-react';
import { toast } from 'sonner';

export default function EditCustomerModal({ isOpen, onClose, customer, onSave }) {
  const [clientData, setClientData] = useState(null);
  const [phoneError, setPhoneError] = useState("");

  useEffect(() => {
    if (customer) {
      setClientData({ ...customer });
      setPhoneError("");
    }
  }, [customer]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (clientData) {
      setClientData(prev => ({ ...prev, [name]: value }));
      if (name === "phone") setPhoneError("");
    }
  };

  const handleSave = async () => {
    if (!clientData || !clientData.id) return;
    
    if (!clientData.phone || !clientData.phone.trim()) {
      setPhoneError("מספר טלפון הוא שדה חובה");
      toast.error("חובה להזין מספר טלפון");
      return;
    }

    try {
      await customersService.update(clientData.id, clientData);
      toast.success("פרטי הלקוח נשמרו בהצלחה");
      onSave();
    } catch (error) {
      console.error("Failed to save client:", error);
      toast.error("שגיאה בשמירת פרטי הלקוח");
    }
  };

  if (!isOpen || !clientData) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" dir="rtl">
      <div className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b p-5 rounded-t-2xl z-10">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold text-gray-900">עריכת פרטי לקוח</h2>
              <p className="text-sm text-gray-500 mt-0.5">{clientData.full_name || "לקוח חדש"}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full hover:bg-gray-100">
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>
        
        {/* Content */}
        <div className="p-5 space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-purple-700 uppercase tracking-wide flex items-center gap-2 border-b pb-2">
              <User className="w-4 h-4" />
              פרטים בסיסיים
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="full_name" className="text-sm font-medium text-gray-700">שם מלא</Label>
                <Input
                  id="full_name"
                  name="full_name"
                  value={clientData.full_name || ""}
                  onChange={handleChange}
                  placeholder="הכנס שם מלא..."
                  className="border-gray-300 focus:border-purple-500 focus:ring-purple-500"
                />
              </div>
              
              <div className="space-y-1.5">
                <Label htmlFor="phone" className="text-sm font-medium text-gray-700 flex items-center gap-1">
                  טלפון <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="phone"
                  name="phone"
                  value={clientData.phone || ""}
                  onChange={handleChange}
                  placeholder="05X-XXXXXXX"
                  className={`${phoneError ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 focus:border-purple-500 focus:ring-purple-500'}`}
                />
                {phoneError && <p className="text-xs text-red-500">{phoneError}</p>}
              </div>
            </div>
            
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium text-gray-700">דוא"ל</Label>
              <Input
                id="email"
                type="email"
                name="email"
                value={clientData.email || ""}
                onChange={handleChange}
                placeholder="example@email.com"
                className="border-gray-300 focus:border-purple-500 focus:ring-purple-500"
              />
            </div>
          </div>

          {/* Address */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-purple-700 uppercase tracking-wide flex items-center gap-2 border-b pb-2">
              <MapPin className="w-4 h-4" />
              כתובת
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="city" className="text-sm font-medium text-gray-700">עיר</Label>
                <Input
                  id="city"
                  name="city"
                  value={clientData.city || ""}
                  onChange={handleChange}
                  placeholder="תל אביב, ירושלים..."
                  className="border-gray-300 focus:border-purple-500 focus:ring-purple-500"
                />
              </div>
              
              <div className="space-y-1.5">
                <Label htmlFor="full_address" className="text-sm font-medium text-gray-700">כתובת מלאה</Label>
                <Input
                  id="full_address"
                  name="full_address"
                  value={clientData.full_address || ""}
                  onChange={handleChange}
                  placeholder="רחוב, מספר בית, קומה..."
                  className="border-gray-300 focus:border-purple-500 focus:ring-purple-500"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-purple-700 uppercase tracking-wide flex items-center gap-2 border-b pb-2">
              <FileText className="w-4 h-4" />
              הערות
            </h3>
            <div className="space-y-1.5">
              <Label htmlFor="notes" className="text-sm font-medium text-gray-700">הערה מיוחדת</Label>
              <Textarea
                id="notes"
                name="notes"
                value={clientData.notes || ""}
                onChange={handleChange}
                rows={3}
                placeholder="הערות חשובות על הלקוח..."
                className="border-gray-300 focus:border-purple-500 focus:ring-purple-500"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t p-4 rounded-b-2xl">
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose}>
              ביטול
            </Button>
            <Button onClick={handleSave} className="bg-purple-600 hover:bg-purple-700 text-white gap-2">
              <Save className="w-4 h-4" />
              שמור שינויים
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}