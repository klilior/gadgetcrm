import React, { useState, useEffect } from 'react';
import { Employee } from '@/entities/all';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { X, Save, User, Mail, Phone, UserCheck } from 'lucide-react';

export default function EmployeeCard({ employee, isOpen, onClose, onUpdate }) {
    const [formData, setFormData] = useState({
        employee_name: '',
        username: '',
        email: '',
        phone: '',
        id_number: '',
        birth_date: '',
        linet_employee_code: '',
        role: 'נציג',
        password_hash: '',
        is_active: true
    });
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (employee) {
            setFormData({
                employee_name: employee.employee_name || '',
                username: employee.username || '',
                email: employee.email || '',
                phone: employee.phone || '',
                id_number: employee.id_number || '',
                birth_date: employee.birth_date || '',
                linet_employee_code: employee.linet_employee_code || '',
                role: employee.role || 'נציג',
                password_hash: '',
                is_active: employee.is_active ?? true
            });
        }
    }, [employee]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        if (name === 'username') {
          setFormData(prev => ({ ...prev, [name]: value.trim().toUpperCase() }));
        } else {
          setFormData(prev => ({ ...prev, [name]: value }));
        }
    };

    const handleSelectChange = (name, value) => {
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const dataToUpdate = { ...formData };
            if (dataToUpdate.username) {
                dataToUpdate.username = dataToUpdate.username.trim().toUpperCase();
            }
            if (!dataToUpdate.password_hash) {
                delete dataToUpdate.password_hash;
            }
            
            await Employee.update(employee.id, dataToUpdate);
            onUpdate();
        } catch (error) {
            console.error('Error updating employee:', error);
            alert('שגיאה בעדכון פרטי העובד');
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen || !employee) return null;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" dir="rtl">
            <div className="glass-card w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl">
                {/* Header */}
                <div className="sticky top-0 bg-gradient-to-l from-blue-500/20 to-purple-500/20 p-6 border-b border-white/20">
                    <div className="flex justify-between items-center">
                        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                            <User className="w-6 h-6" />
                            עריכת פרטי עובד - {employee.employee_name}
                        </h2>
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
                            <UserCheck className="w-5 h-5" />
                            פרטים אישיים
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="employee_name" className="text-sm font-medium flex items-center gap-2">
                                    <User className="w-4 h-4" />
                                    שם מלא
                                </Label>
                                <Input
                                    id="employee_name"
                                    name="employee_name"
                                    value={formData.employee_name}
                                    onChange={handleChange}
                                    className="glass-button"
                                    placeholder="הכנס שם מלא..."
                                />
                            </div>
                            
                            <div className="space-y-2">
                                <Label htmlFor="username" className="text-sm font-medium">שם משתמש</Label>
                                <Input
                                    id="username"
                                    name="username"
                                    value={formData.username}
                                    onChange={handleChange}
                                    className="glass-button"
                                    placeholder="שם משתמש באנגלית"
                                />
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="email" className="text-sm font-medium flex items-center gap-2">
                                    <Mail className="w-4 h-4" />
                                    דוא"ל
                                </Label>
                                <Input
                                    id="email"
                                    type="email"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    className="glass-button"
                                    placeholder="example@email.com"
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
                                    value={formData.phone}
                                    onChange={handleChange}
                                    className="glass-button"
                                    placeholder="05X-XXXXXXX"
                                />
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="id_number" className="text-sm font-medium">תעודת זהות</Label>
                                <Input
                                    id="id_number"
                                    name="id_number"
                                    value={formData.id_number}
                                    onChange={handleChange}
                                    className="glass-button"
                                    placeholder="מספר תעודת זהות"
                                />
                            </div>
                            
                            <div className="space-y-2">
                                <Label htmlFor="birth_date" className="text-sm font-medium">תאריך לידה</Label>
                                <Input
                                    id="birth_date"
                                    type="date"
                                    name="birth_date"
                                    value={formData.birth_date}
                                    onChange={handleChange}
                                    className="glass-button"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Work Details Section */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-gray-800">פרטי עבודה</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="linet_employee_code" className="text-sm font-medium">קוד עובד (Linet)</Label>
                                <Input
                                    id="linet_employee_code"
                                    name="linet_employee_code"
                                    value={formData.linet_employee_code}
                                    onChange={handleChange}
                                    className="glass-button"
                                    placeholder="לדוגמה: 8743"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="role" className="text-sm font-medium">תפקיד</Label>
                                <Select value={formData.role} onValueChange={(v) => handleSelectChange('role', v)}>
                                    <SelectTrigger className="glass-button">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="נציג">נציג</SelectItem>
                                        <SelectItem value="מנהל">מנהל</SelectItem>
                                        <SelectItem value="מנהל משמרת">מנהל משמרת</SelectItem>
                                        <SelectItem value="טכנאי">טכנאי</SelectItem>
                                        <SelectItem value="מלקט">מלקט</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="password_hash" className="text-sm font-medium">סיסמה חדשה</Label>
                                <Input
                                    id="password_hash"
                                    type="password"
                                    name="password_hash"
                                    value={formData.password_hash}
                                    onChange={handleChange}
                                    className="glass-button"
                                    placeholder="השאר ריק כדי לא לשנות"
                                />
                            </div>
                        </div>

                        <div className="flex items-center space-x-2 space-x-reverse">
                            <Switch
                                id="is_active"
                                checked={formData.is_active}
                                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
                            />
                            <Label htmlFor="is_active" className="text-sm font-medium">עובד פעיל</Label>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="sticky bottom-0 bg-white/80 backdrop-blur-sm p-6 border-t border-white/20">
                    <div className="flex justify-end gap-3">
                        <Button variant="ghost" onClick={onClose} className="hover:bg-white/20">
                            ביטול
                        </Button>
                        <Button 
                            onClick={handleSave} 
                            disabled={isSaving}
                            className="bg-gradient-to-l from-blue-500 to-purple-500 text-white hover:opacity-90"
                        >
                            <Save className="w-4 h-4 ml-2" />
                            {isSaving ? 'שומר...' : 'שמור שינויים'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}