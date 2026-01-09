import React, { useState, useEffect } from 'react';
import { customersService } from '../utils/customersService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { X, User, Phone, Mail, MapPin, FileText } from 'lucide-react';

export default function EditCustomerModal({ isOpen, onClose, customer, onSave }) {
  const [clientData, setClientData] = useState(null); // Changed from formData to clientData and initialized with null

  useEffect(() => {
    if (customer) {
      // When customer prop is provided, set clientData directly from it
      // This ensures all properties of the customer object are carried over
      setClientData({ ...customer });
    }
  }, [customer]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    // Ensure clientData is not null before updating
    if (clientData) {
      setClientData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleSave = async () => {
    // Check if clientData exists and has an ID before attempting to save
    if (!clientData || !clientData.id) return;
    try {
      // Use customersService.update and pass clientData directly
      await customersService.update(clientData.id, clientData);
      onSave(); // Call onSave after successful update
    } catch (error) {
      console.error("Failed to save client:", error);
      alert("שגיאה בשמירת פרטי הלקוח."); // Display an alert for the user
    }
  };

  if (!isOpen) return null;

  // Render nothing if clientData is null initially (before customer prop is loaded)
  if (!clientData) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" dir="rtl">
      <div className="glass-card w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-l from-blue-500/20 to-purple-500/20 p-6 border-b border-white/20">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-gray-900">עריכת פרטי לקוח</h2>
            <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-white/20">
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>
        
        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Basic Info Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <User className="w-5 h-5" />
              פרטים בסיסיים
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="full_name" className="text-sm font-medium flex items-center gap-2">
                  <User className="w-4 h-4" />
                  שם מלא
                </Label>
                <Input
                  id="full_name"
                  name="full_name"
                  value={clientData.full_name} // Using clientData
                  onChange={handleChange}
                  className="glass-button"
                  placeholder="הכנס שם מלא..."
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-sm font-medium flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  טלפון
                </Label>
                <Input
                  id="phone"
                  name="phone"
                  value={clientData.phone} // Using clientData
                  onChange={handleChange}
                  className="glass-button"
                  placeholder="05X-XXXXXXX"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium flex items-center gap-2">
                <Mail className="w-4 h-4" />
                דוא"ל
              </Label>
              <Input
                id="email"
                type="email"
                name="email"
                value={clientData.email} // Using clientData
                onChange={handleChange}
                className="glass-button"
                placeholder="example@email.com"
              />
            </div>
          </div>

          {/* Address Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              כתובת
            </h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="city" className="text-sm font-medium">עיר</Label>
                <Input
                  id="city"
                  name="city"
                  value={clientData.city} // Using clientData
                  onChange={handleChange}
                  className="glass-button"
                  placeholder="תל אביב, ירושלים..."
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="full_address" className="text-sm font-medium">כתובת מלאה</Label>
                <Input
                  id="full_address"
                  name="full_address"
                  value={clientData.full_address} // Using clientData
                  onChange={handleChange}
                  className="glass-button"
                  placeholder="רחוב, מספר בית, קומה..."
                />
              </div>
            </div>
          </div>

          {/* Notes Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <FileText className="w-5 h-5" />
              הערות
            </h3>
            <div className="space-y-2">
              <Label htmlFor="notes" className="text-sm font-medium">הערה מיוחדת</Label>
              <Textarea
                id="notes"
                name="notes"
                value={clientData.notes} // Using clientData
                onChange={handleChange}
                className="glass-button"
                rows={4}
                placeholder="הערות חשובות על הלקוח, העדפות, הנחיות מיוחדות..."
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white/80 backdrop-blur-sm p-6 border-t border-white/20">
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose} className="hover:bg-white/20">
              ביטול
            </Button>
            <Button onClick={handleSave} className="bg-gradient-to-l from-blue-500 to-purple-500 text-white hover:opacity-90">
              שמור שינויים
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}