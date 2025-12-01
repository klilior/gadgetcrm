import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ShiftRequest, Employee } from '@/entities/all';
import { useUser } from '../components/UserAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getNextSunday, getSubmissionDeadline, isDeadlinePassed } from '../components/utils';
import { AlertCircle, Clock, CheckCircle, Loader2 } from 'lucide-react';

const dayNames = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
const shifts = ["בוקר", "ערב"];

export default function ShiftPreferencesPage() {
    const { currentUser } = useUser();
    const [preferences, setPreferences] = useState({});
    const [isInitialLoad, setIsInitialLoad] = useState(true);
    const [deadline, setDeadline] = useState(getSubmissionDeadline());
    const [countdown, setCountdown] = useState("");
    const [saveStatus, setSaveStatus] = useState('idle');
    const [currentEmployee, setCurrentEmployee] = useState(null);
    const deadlineHasPassed = isDeadlinePassed();
    const weekStartDate = useMemo(() => getNextSunday(), []);
    const debounceTimeout = useRef(null);

    useEffect(() => {
        const interval = setInterval(() => {
            const now = new Date();
            const diff = deadline.getTime() - now.getTime();
            if (diff > 0) {
                const d = Math.floor(diff / (1000 * 60 * 60 * 24));
                const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
                const m = Math.floor((diff / 1000 / 60) % 60);
                const s = Math.floor((diff / 1000) % 60);
                setCountdown(`${d}י ${h}ש ${m}ד ${s}ש`);
            } else {
                setCountdown("חלון ההגשה נסגר");
                clearInterval(interval);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [deadline]);

    useEffect(() => {
        if (!currentUser) return;
        
        const fetchEmployee = async () => {
            try {
                const employees = await Employee.filter({ username: currentUser.username });
                
                if (employees.length === 0) {
                    alert('לא נמצא עובד מתאים למשתמש זה');
                    return;
                }
                
                const employee = employees[0];
                setCurrentEmployee(employee);
            } catch (error) {
                console.error('Error fetching employee:', error);
            }
        };
        
        fetchEmployee();
    }, [currentUser]);

    useEffect(() => {
        if (!currentEmployee) return;
        
        const fetchPreferences = async () => {
            setIsInitialLoad(true);
            
            const weekStartDateISO = weekStartDate.toISOString().split('T')[0];
            
            const existingRequests = await ShiftRequest.filter({
                employee_id: currentEmployee.id,
                week_start_date: weekStartDateISO
            });
            
            const initialPrefs = {};
            dayNames.forEach(day => {
                shifts.forEach(shift => {
                    const key = `${day}-${shift}`;
                    const existing = existingRequests.find(r => r.day === day && r.shift_type === shift);
                    initialPrefs[key] = {
                        is_available: existing ? existing.is_available : false,
                        late_arrival_time: existing ? existing.late_arrival_time : '',
                        constraints: existing ? existing.constraints : ''
                    };
                });
            });
            setPreferences(initialPrefs);
            setIsInitialLoad(false);
        };
        fetchPreferences();
    }, [currentEmployee, weekStartDate]);

    useEffect(() => {
        if (isInitialLoad || !currentEmployee) return;

        setSaveStatus('saving');
        clearTimeout(debounceTimeout.current);

        debounceTimeout.current = setTimeout(async () => {
            try {
                const weekStartDateISO = weekStartDate.toISOString().split('T')[0];
                
                const existing = await ShiftRequest.filter({ 
                    employee_id: currentEmployee.id, 
                    week_start_date: weekStartDateISO 
                });
                
                for(const req of existing) {
                    await ShiftRequest.delete(req.id);
                }

                const requestsToCreate = [];
                for (const day of dayNames) {
                    for (const shift of shifts) {
                        const key = `${day}-${shift}`;
                        if (preferences[key]?.is_available) {
                            requestsToCreate.push({
                                employee_id: currentEmployee.id,
                                week_start_date: weekStartDateISO,
                                day: day,
                                shift_type: shift,
                                is_available: true,
                                late_arrival_time: preferences[key].late_arrival_time || null,
                                constraints: preferences[key].constraints || null
                            });
                        }
                    }
                }
                
                if (requestsToCreate.length > 0) {
                    await ShiftRequest.bulkCreate(requestsToCreate);
                }
                
                setSaveStatus('saved');
                setTimeout(() => setSaveStatus('idle'), 2000);
                
            } catch (error) {
                console.error('Save error:', error);
                setSaveStatus('error');
            }
        }, 1500);

        return () => clearTimeout(debounceTimeout.current);
    }, [preferences, currentEmployee, weekStartDate, isInitialLoad]);

    const handleToggle = (day, shift) => {
        if (deadlineHasPassed) return;
        const key = `${day}-${shift}`;
        setPreferences(prev => ({
            ...prev,
            [key]: { ...prev[key], is_available: !prev[key].is_available }
        }));
    };

    const handleInputChange = (day, shift, field, value) => {
        if (deadlineHasPassed) return;
        const key = `${day}-${shift}`;
        setPreferences(prev => ({
            ...prev,
            [key]: { ...prev[key], [field]: value }
        }));
    };

    if (isInitialLoad || !currentEmployee) {
        return <div className="p-6 text-center">טוען העדפות...</div>;
    }

    return (
        <div dir="rtl" className="p-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">העדפות לשבוע הבא</h1>
                    <p className="text-sm text-gray-600 mt-1">עובד: {currentEmployee.employee_name}</p>
                </div>
                <div className="flex gap-4">
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                        {saveStatus === 'saving' && <><Loader2 className="w-4 h-4 animate-spin" /><span>שומר...</span></>}
                        {saveStatus === 'saved' && <><CheckCircle className="w-4 h-4 text-green-500" /><span className="text-green-600 font-medium">נשמר בהצלחה!</span></>}
                        {saveStatus === 'error' && <><AlertCircle className="w-4 h-4 text-red-500" /><span>שגיאה</span></>}
                    </div>
                    <Card className="glass-card p-4">
                        <div className="flex items-center gap-3">
                            <Clock className="w-5 h-5 text-gray-700"/>
                            <div>
                                <div className="text-sm font-medium">זמן לסיום הגשה:</div>
                                <div className="font-bold text-lg">{countdown}</div>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>
            
            {deadlineHasPassed && (
                <div className="flex items-center gap-2 p-4 rounded-2xl bg-yellow-100/50 text-yellow-800 border border-yellow-200">
                    <AlertCircle className="w-5 h-5" />
                    <p className="font-semibold">חלון ההגשה לשבוע זה נסגר. לא ניתן לערוך יותר.</p>
                </div>
            )}

            <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {dayNames.map(day => (
                    <Card key={day} className="glass-card border-0">
                        <CardHeader><CardTitle className="text-center">{`יום ${day}`}</CardTitle></CardHeader>
                        <CardContent className="space-y-6">
                            {shifts.map(shift => {
                                const key = `${day}-${shift}`;
                                return (
                                    <div key={key} className="space-y-3 glass-card p-4 rounded-xl">
                                        <div className="flex items-center justify-between">
                                            <Label htmlFor={`switch-${key}`} className="text-lg font-medium">{shift}</Label>
                                            <Switch 
                                                id={`switch-${key}`}
                                                checked={preferences[key]?.is_available || false}
                                                onCheckedChange={() => handleToggle(day, shift)}
                                                disabled={deadlineHasPassed}
                                            />
                                        </div>
                                        {preferences[key]?.is_available && (
                                            <div className="space-y-3">
                                                <Input 
                                                    type="time" 
                                                    placeholder="שעת הגעה מאוחרת"
                                                    value={preferences[key].late_arrival_time || ''}
                                                    onChange={(e) => handleInputChange(day, shift, 'late_arrival_time', e.target.value)}
                                                    className="glass-button"
                                                    disabled={deadlineHasPassed}
                                                />
                                                <Textarea 
                                                    placeholder="אילוצים / הערות"
                                                    value={preferences[key].constraints || ''}
                                                    onChange={(e) => handleInputChange(day, shift, 'constraints', e.target.value)}
                                                    className="glass-button"
                                                    rows={2}
                                                    disabled={deadlineHasPassed}
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}