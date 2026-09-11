import React, { useState, useEffect } from 'react';
import { Employee } from '@/entities/all';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { X, Save, User, Mail, Phone, UserCheck } from 'lucide-react';

const ROLES = ["נציג", "מנהל", "מנהל משמרת", "טכנאי", "מלקט"];

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
        <div
            className="fixed inset-0 z-50 bg-black/50 flex items-stretch sm:items-center justify-center sm:p-4"
            dir="rtl"
            onClick={onClose}
        >
            <div
                className="bg-white w-full sm:max-w-2xl h-full sm:h-auto sm:max-h-[90vh] sm:rounded-2xl shadow-xl flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-200 bg-white">
                    <h2 className="text-base sm:text-xl font-semibold text-gray-900 flex items-center gap-2 min-w-0">
                        <User className="w-5 h-5 text-gray-400 shrink-0" />
                        <span className="truncate">עריכת עובד — {employee.employee_name}</span>
                    </h2>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="w-5 h-5" />
                    </Button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-6">
                    <section className="space-y-4">
                        <h3 className="text-sm font-semibold text-gray-500 flex items-center gap-2">
                            <UserCheck className="w-4 h-4" />
                            פרטים אישיים
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="employee_name" className="flex items-center gap-1.5 text-gray-700">
                                    <User className="w-4 h-4 text-gray-400" /> שם מלא
                                </Label>
                                <Input id="employee_name" name="employee_name" value={formData.employee_name} onChange={handleChange} placeholder="הכנס שם מלא..." />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="username" className="text-gray-700">שם משתמש (באנגלית)</Label>
                                <Input id="username" name="username" value={formData.username} onChange={handleChange} placeholder="USERNAME" />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="email" className="flex items-center gap-1.5 text-gray-700">
                                    <Mail className="w-4 h-4 text-gray-400" /> דוא"ל
                                </Label>
                                <Input id="email" type="email" name="email" value={formData.email} onChange={handleChange} placeholder="example@email.com" />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="phone" className="flex items-center gap-1.5 text-gray-700">
                                    <Phone className="w-4 h-4 text-gray-400" /> טלפון
                                </Label>
                                <Input id="phone" name="phone" value={formData.phone} onChange={handleChange} placeholder="05X-XXXXXXX" />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="id_number" className="text-gray-700">תעודת זהות</Label>
                                <Input id="id_number" name="id_number" value={formData.id_number} onChange={handleChange} placeholder="מספר תעודת זהות" />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="birth_date" className="text-gray-700">תאריך לידה</Label>
                                <Input id="birth_date" type="date" name="birth_date" value={formData.birth_date} onChange={handleChange} />
                            </div>
                        </div>
                    </section>

                    <section className="space-y-4">
                        <h3 className="text-sm font-semibold text-gray-500">פרטי עבודה</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="linet_employee_code" className="text-gray-700">קוד עובד (Linet)</Label>
                                <Input id="linet_employee_code" name="linet_employee_code" value={formData.linet_employee_code} onChange={handleChange} placeholder="לדוגמה: 8743" />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="role" className="text-gray-700">תפקיד</Label>
                                <Select value={formData.role} onValueChange={(v) => handleSelectChange('role', v)}>
                                    <SelectTrigger id="role" className="bg-white">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5 sm:col-span-2">
                                <Label htmlFor="password_hash" className="text-gray-700">סיסמה חדשה</Label>
                                <Input id="password_hash" type="password" name="password_hash" value={formData.password_hash} onChange={handleChange} placeholder="השאר ריק כדי לא לשנות" />
                            </div>
                        </div>

                        <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
                            <Label htmlFor="is_active" className="text-gray-700">עובד פעיל</Label>
                            <Switch
                                id="is_active"
                                checked={formData.is_active}
                                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
                            />
                        </div>
                    </section>
                </div>

                {/* Footer */}
                <div className="px-4 sm:px-6 py-4 border-t border-gray-200 bg-white flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                    <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">ביטול</Button>
                    <Button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="w-full sm:w-auto text-white"
                        style={{ backgroundColor: '#7D0F82' }}
                    >
                        <Save className="w-4 h-4 ml-2" />
                        {isSaving ? 'שומר...' : 'שמור שינויים'}
                    </Button>
                </div>
            </div>
        </div>
    );
}