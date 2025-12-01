import React, { useState, useEffect } from 'react';
import { Employee, ShiftRequest, WeeklySchedule, ShiftAssignment } from '@/entities/all';
import { useUser } from '../components/UserAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getNextSunday } from '../components/utils';
import { CheckCircle, XCircle, AlertTriangle, RefreshCw } from 'lucide-react';

const dayNames = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
const shifts = ["בוקר", "ערב"];

export default function DebugSchedulePage() {
    const { currentUser } = useUser();
    const [employees, setEmployees] = useState([]);
    const [requests, setRequests] = useState([]);
    const [schedules, setSchedules] = useState([]);
    const [assignments, setAssignments] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const weekStartDate = getNextSunday();
    const weekStartDateISO = weekStartDate.toISOString().split('T')[0];

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [allEmployees, allRequests, allSchedules, allAssignments] = await Promise.all([
                Employee.list(),
                ShiftRequest.filter({ week_start_date: weekStartDateISO }),
                WeeklySchedule.filter({ week_start_date: weekStartDateISO }),
                ShiftAssignment.list()
            ]);
            
            setEmployees(allEmployees);
            setRequests(allRequests);
            setSchedules(allSchedules);
            setAssignments(allAssignments);
        } catch (error) {
            console.error('Error loading data:', error);
        }
        setIsLoading(false);
    };

    useEffect(() => {
        loadData();
    }, []);

    if (isLoading) {
        return <div className="p-6 text-center">טוען נתונים...</div>;
    }

    const employeesWithRequests = employees.map(emp => {
        const empRequests = requests.filter(r => r.employee_id === emp.id);
        const availableCount = empRequests.filter(r => r.is_available).length;
        return { ...emp, requests: empRequests, availableCount };
    });

    const totalRequests = requests.length;
    const totalAvailable = requests.filter(r => r.is_available).length;

    return (
        <div dir="rtl" className="p-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">🔍 בדיקת מערכת סידור עבודה</h1>
                    <p className="text-sm text-gray-600 mt-1">שבוע: {weekStartDate.toLocaleDateString('he-IL')}</p>
                </div>
                <Button onClick={loadData} className="gap-2">
                    <RefreshCw className="w-4 h-4" />
                    רענן נתונים
                </Button>
            </div>

            {/* סיכום כללי */}
            <div className="grid md:grid-cols-4 gap-4">
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm text-gray-600">סה"כ עובדים</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">{employees.length}</div>
                    </CardContent>
                </Card>
                
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm text-gray-600">סה"כ בקשות</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">{totalRequests}</div>
                    </CardContent>
                </Card>
                
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm text-gray-600">משמרות זמינות</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-green-600">{totalAvailable}</div>
                    </CardContent>
                </Card>
                
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm text-gray-600">סידורים פעילים</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">{schedules.length}</div>
                    </CardContent>
                </Card>
            </div>

            {/* פירוט עובדים */}
            <Card>
                <CardHeader>
                    <CardTitle>פירוט עובדים והעדפות</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        {employeesWithRequests.map(emp => {
                            const hasRequests = emp.requests.length > 0;
                            const hasAvailable = emp.availableCount > 0;
                            
                            return (
                                <div key={emp.id} className={`p-4 rounded-lg border-2 ${
                                    hasAvailable ? 'bg-green-50 border-green-200' : 
                                    hasRequests ? 'bg-yellow-50 border-yellow-200' : 
                                    'bg-red-50 border-red-200'
                                }`}>
                                    <div className="flex items-start justify-between mb-2">
                                        <div>
                                            <div className="font-bold text-lg">{emp.employee_name}</div>
                                            <div className="text-sm text-gray-600">
                                                ID: <code className="bg-white px-2 py-0.5 rounded">{emp.id}</code>
                                            </div>
                                            <div className="text-sm text-gray-600">
                                                Username: <code className="bg-white px-2 py-0.5 rounded">{emp.username}</code>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            {hasAvailable ? (
                                                <Badge className="bg-green-500 text-white gap-1">
                                                    <CheckCircle className="w-3 h-3" />
                                                    {emp.availableCount} משמרות זמינות
                                                </Badge>
                                            ) : hasRequests ? (
                                                <Badge className="bg-yellow-500 text-white gap-1">
                                                    <AlertTriangle className="w-3 h-3" />
                                                    סימן אבל לא זמין
                                                </Badge>
                                            ) : (
                                                <Badge variant="destructive" className="gap-1">
                                                    <XCircle className="w-3 h-3" />
                                                    לא הגיש
                                                </Badge>
                                            )}
                                        </div>
                                    </div>

                                    {emp.requests.length > 0 && (
                                        <div className="mt-3">
                                            <div className="text-sm font-semibold mb-2">פירוט בקשות ({emp.requests.length}):</div>
                                            <div className="grid grid-cols-7 gap-2">
                                                {dayNames.map(day => (
                                                    <div key={day}>
                                                        <div className="text-xs font-medium text-center mb-1">{day}</div>
                                                        {shifts.map(shift => {
                                                            const request = emp.requests.find(r => r.day === day && r.shift_type === shift);
                                                            return (
                                                                <div 
                                                                    key={shift} 
                                                                    className={`text-xs text-center p-1 rounded mb-1 ${
                                                                        request?.is_available ? 'bg-green-200 text-green-900' : 
                                                                        request ? 'bg-gray-200 text-gray-600' : 
                                                                        'bg-white border border-gray-200 text-gray-400'
                                                                    }`}
                                                                    title={request ? 
                                                                        `${day} ${shift} - ${request.is_available ? 'זמין' : 'לא זמין'}${request.late_arrival_time ? ` (מ-${request.late_arrival_time})` : ''}${request.constraints ? ` - ${request.constraints}` : ''}` 
                                                                        : 'לא סומן'
                                                                    }
                                                                >
                                                                    {shift === 'בוקר' ? 'ב' : 'ע'}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {emp.requests.length === 0 && (
                                        <div className="mt-2 text-sm text-red-600 font-medium">
                                            ⚠️ העובד לא הגיש העדפות לשבוע זה!
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            {/* פירוט בקשות גולמי */}
            <Card>
                <CardHeader>
                    <CardTitle>📊 נתונים גולמיים - ShiftRequest</CardTitle>
                </CardHeader>
                <CardContent>
                    {requests.length === 0 ? (
                        <div className="text-center text-red-500 font-bold py-8">
                            ⚠️ אין בקשות במערכת לשבוע זה!
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b">
                                        <th className="text-right p-2">ID</th>
                                        <th className="text-right p-2">Employee ID</th>
                                        <th className="text-right p-2">שם עובד</th>
                                        <th className="text-right p-2">יום</th>
                                        <th className="text-right p-2">משמרת</th>
                                        <th className="text-right p-2">זמין?</th>
                                        <th className="text-right p-2">הגעה מאוחרת</th>
                                        <th className="text-right p-2">הערות</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {requests.map(req => {
                                        const emp = employees.find(e => e.id === req.employee_id);
                                        return (
                                            <tr key={req.id} className="border-b hover:bg-gray-50">
                                                <td className="p-2"><code className="text-xs">{req.id.substring(0, 8)}</code></td>
                                                <td className="p-2"><code className="text-xs">{req.employee_id.substring(0, 8)}</code></td>
                                                <td className="p-2 font-medium">{emp?.employee_name || '❌ לא נמצא'}</td>
                                                <td className="p-2">{req.day}</td>
                                                <td className="p-2">{req.shift_type}</td>
                                                <td className="p-2">
                                                    {req.is_available ? (
                                                        <Badge className="bg-green-500">✓ כן</Badge>
                                                    ) : (
                                                        <Badge variant="secondary">✗ לא</Badge>
                                                    )}
                                                </td>
                                                <td className="p-2">{req.late_arrival_time || '-'}</td>
                                                <td className="p-2 text-xs">{req.constraints || '-'}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* בדיקת התאמות */}
            <Card>
                <CardHeader>
                    <CardTitle>🔍 בדיקת תקינות</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2">
                        {requests.some(r => !employees.find(e => e.id === r.employee_id)) ? (
                            <div className="flex items-center gap-2 text-red-600">
                                <XCircle className="w-5 h-5" />
                                <span className="font-bold">❌ שגיאה: יש בקשות עם employee_id שלא קיים!</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 text-green-600">
                                <CheckCircle className="w-5 h-5" />
                                <span className="font-bold">✓ כל הבקשות מקושרות נכון לעובדים</span>
                            </div>
                        )}

                        {employees.filter(e => requests.some(r => r.employee_id === e.id)).length === 0 ? (
                            <div className="flex items-center gap-2 text-red-600">
                                <XCircle className="w-5 h-5" />
                                <span className="font-bold">❌ אף עובד לא הגיש העדפות!</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 text-green-600">
                                <CheckCircle className="w-5 h-5" />
                                <span className="font-bold">
                                    ✓ {employees.filter(e => requests.some(r => r.employee_id === e.id)).length} עובדים הגישו העדפות
                                </span>
                            </div>
                        )}

                        {requests.filter(r => r.is_available).length === 0 ? (
                            <div className="flex items-center gap-2 text-yellow-600">
                                <AlertTriangle className="w-5 h-5" />
                                <span className="font-bold">⚠️ אין משמרות זמינות לשיבוץ</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 text-green-600">
                                <CheckCircle className="w-5 h-5" />
                                <span className="font-bold">
                                    ✓ {requests.filter(r => r.is_available).length} משמרות זמינות לשיבוץ
                                </span>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}