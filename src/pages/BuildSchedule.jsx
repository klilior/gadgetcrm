import React, { useState, useEffect } from 'react';
import { Employee, ShiftRequest, WeeklySchedule, ShiftAssignment } from '@/entities/all';
import { useUser } from '../components/UserAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getNextSunday } from '../components/utils';
import { AlertTriangle, Clock, MessageSquare, Users, Plus, X, Check, AlertCircle } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const dayNames = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
const shifts = ["בוקר", "ערב"];

const EmployeeAvailabilityCard = ({ employee, requests, assignments }) => {
    const employeeRequests = requests.filter(r => r.employee_id === employee.id);
    const assignedSlots = Object.entries(assignments).filter(([key, ids]) => 
        ids.includes(employee.id)).map(([key]) => key);

    const hasAnyRequests = employeeRequests.length > 0;

    return (
        <div className={`glass-card p-4 rounded-2xl mb-3 ${!hasAnyRequests ? 'opacity-60 border-2 border-dashed border-red-300 bg-red-50' : 'border border-green-200 bg-green-50'}`}>
            <div className="flex justify-between items-start mb-3">
                <div>
                    <h4 className="font-bold text-gray-800">{employee.employee_name}</h4>
                    <p className="text-xs text-gray-500">ID: {employee.id.substring(0, 8)}</p>
                </div>
                <div className="flex gap-2">
                    <Badge variant="outline" className="text-xs">
                        {assignedSlots.length} שובץ
                    </Badge>
                    {!hasAnyRequests && (
                        <Badge variant="destructive" className="text-xs">
                            לא הגיש
                        </Badge>
                    )}
                </div>
            </div>
            
            <div className="grid grid-cols-3 sm:grid-cols-7 gap-2 mb-4">
                {dayNames.map(day => (
                    <div key={day} className="text-center bg-white/50 rounded-lg p-1">
                        <div className="text-xs font-bold mb-1.5 text-gray-700">{day}</div>
                        <div className="flex sm:block justify-center gap-1">
                            {shifts.map(shift => {
                                const request = employeeRequests.find(r => r.day === day && r.shift_type === shift);
                                const isAssigned = assignedSlots.includes(`${day}-${shift}`);
                                
                                return (
                                    <div 
                                        key={`${day}-${shift}`}
                                        className={`w-8 h-8 sm:w-full sm:h-7 rounded-md text-xs flex items-center justify-center mb-1 transition-all ${
                                            isAssigned ? 'bg-green-500 text-white font-bold shadow-sm ring-1 ring-green-600' :
                                            request?.is_available ? 'bg-blue-100 text-blue-700 font-medium border border-blue-200' :
                                            'bg-gray-100 text-gray-400 border border-gray-200'
                                        }`}
                                        title={`${day} ${shift}${request?.constraints ? ': ' + request.constraints : ''}${request?.late_arrival_time ? ` (מ-${request.late_arrival_time})` : ''}`}
                                    >
                                        {shift === 'בוקר' ? '☀️' : '🌙'}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            {!hasAnyRequests && (
                <div className="text-center text-red-500 text-sm font-medium bg-red-100 p-2 rounded">
                    ⚠️ העובד לא הגיש העדפות לשבוע זה
                </div>
            )}

            {employeeRequests.some(r => r.constraints || r.late_arrival_time) && (
                <div className="text-xs space-y-1 mt-2 bg-yellow-50 p-2 rounded">
                    <div className="font-medium text-gray-700 mb-1">הערות ואילוצים:</div>
                    {employeeRequests.filter(r => r.constraints || r.late_arrival_time).map(req => (
                        <div key={`${req.day}-${req.shift_type}`} className="flex items-center gap-1 text-gray-600">
                            {req.late_arrival_time && <Clock className="w-3 h-3" />}
                            {req.constraints && <MessageSquare className="w-3 h-3" />}
                            <span>{req.day} {req.shift_type}: 
                                {req.late_arrival_time && ` מ-${req.late_arrival_time}`}
                                {req.constraints && ` ${req.constraints}`}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {hasAnyRequests && (
                <div className="mt-2 text-xs text-gray-500">
                    סה"כ זמין ל-{employeeRequests.filter(r => r.is_available).length} משמרות השבוע
                </div>
            )}
        </div>
    );
};

const ShiftSlot = ({ day, shift, assignments, employeesMap, requests, onAddEmployee, onRemoveEmployee, availableEmployees }) => {
    const [showAddMenu, setShowAddMenu] = useState(false);
    const key = `${day}-${shift}`;
    const assignedIds = assignments[key] || [];
    const availableCount = requests.filter(r => 
        r.day === day && r.shift_type === shift && r.is_available
    ).length;

    const availableForThisSlot = availableEmployees.filter(emp => {
        const isAlreadyAssigned = assignedIds.includes(emp.id);
        return !isAlreadyAssigned;
    });

    // Close menu when clicking outside
    useEffect(() => {
        if (showAddMenu) {
            const handleClickOutside = (e) => {
                if (!e.target.closest('.add-menu-container')) {
                    setShowAddMenu(false);
                }
            };
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showAddMenu]);

    return (
        <Card 
            className="glass-card border-0 relative transition-all" 
            style={{ 
                overflow: 'visible', 
                position: 'relative',
                zIndex: showAddMenu ? 50 : 0 
            }}
        >
            <CardHeader className="pb-3">
                <div className="flex justify-between items-center">
                    <CardTitle className="text-sm">{shift}</CardTitle>
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                            {assignedIds.length}/3
                        </Badge>
                        <Badge variant={availableCount > 0 ? "default" : "secondary"} className={`text-xs ${availableCount > 0 ? 'bg-green-500' : ''}`}>
                            {availableCount} זמינים
                        </Badge>
                    </div>
                </div>
                <p className="text-xs text-gray-600">
                    {shift === 'בוקר' ? '09:00-15:00' : '15:00-21:00'}
                </p>
            </CardHeader>
            <CardContent className="pt-0 space-y-2" style={{ overflow: 'visible', position: 'relative' }}>
                {assignedIds.map((id) => {
                    const employee = employeesMap[id];
                    const request = requests.find(r => 
                        r.employee_id === id && r.day === day && r.shift_type === shift
                    );
                    
                    return (
                        <div
                            key={id}
                            className={`flex items-start justify-between p-3 rounded-lg transition-all
                                ${request?.is_available ? 'bg-green-100/80 border-2 border-green-300' : 'bg-orange-100/80 border-2 border-orange-300'}`}
                        >
                            <div className="flex items-start gap-2 flex-1">
                                {request?.is_available ? (
                                    <Check className="w-4 h-4 text-green-600 flex-shrink-0 mt-1" />
                                ) : (
                                    <AlertTriangle className="w-4 h-4 text-orange-600 flex-shrink-0 mt-1" />
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-sm truncate">{employee?.employee_name}</div>
                                    
                                    {request?.late_arrival_time && (
                                        <div className="flex items-center gap-1 text-xs bg-orange-200 text-orange-900 font-bold px-2 py-1 rounded mt-1">
                                            <Clock className="w-3 h-3 flex-shrink-0" />
                                            <span>מגיע רק מ-{request.late_arrival_time}</span>
                                        </div>
                                    )}
                                    {request?.constraints && (
                                        <div className="flex items-start gap-1 text-xs bg-yellow-100 text-gray-800 px-2 py-1 rounded mt-1">
                                            <MessageSquare className="w-3 h-3 flex-shrink-0 mt-0.5" />
                                            <span className="break-words font-medium">{request.constraints}</span>
                                        </div>
                                    )}
                                    {!request?.is_available && (
                                        <div className="text-xs text-orange-700 font-bold mt-1">⚠️ לא ביקש משמרת זו</div>
                                    )}
                                </div>
                            </div>
                            <button 
                                onClick={() => onRemoveEmployee(key, id)} 
                                className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded-full p-1 transition-colors flex-shrink-0 mr-2"
                                title="הסר עובד"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    );
                })}

                {assignedIds.length < 3 && (
                    <div className="relative add-menu-container" style={{ zIndex: showAddMenu ? 200 : 1 }}>
                        <Button
                            onClick={() => setShowAddMenu(!showAddMenu)}
                            variant="outline"
                            className="w-full border-dashed border-2 hover:border-blue-400 hover:bg-blue-50"
                        >
                            <Plus className="w-4 h-4 ml-2" />
                            הוסף עובד למשמרת
                        </Button>

                        {showAddMenu && (
                            <>
                                <div 
                                    className="fixed inset-0 bg-black/20 backdrop-blur-sm" 
                                    style={{ zIndex: 150 }}
                                    onClick={() => setShowAddMenu(false)}
                                />
                                <div 
                                    className={`
                                        bg-white border-2 border-blue-400 rounded-xl shadow-2xl overflow-y-auto
                                        fixed left-4 right-4 top-1/2 -translate-y-1/2 max-h-[60vh]
                                        sm:absolute sm:left-0 sm:right-0 sm:top-full sm:translate-y-0 sm:max-h-96 sm:mt-2 sm:w-auto
                                    `}
                                    style={{ zIndex: 200 }}
                                >
                                    <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-500 text-white p-3 font-bold text-sm flex items-center justify-between">
                                        <span>בחר עובד למשמרת</span>
                                        <button onClick={() => setShowAddMenu(false)} className="hover:bg-white/20 rounded p-1">
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                    {availableForThisSlot.length === 0 ? (
                                        <div className="p-4 text-center text-gray-500 text-sm">
                                            אין עובדים זמינים להוספה
                                        </div>
                                    ) : (
                                        availableForThisSlot.map(emp => {
                                            const request = requests.find(r => 
                                                r.employee_id === emp.id && r.day === day && r.shift_type === shift
                                            );
                                            const hasRequest = request?.is_available;
                                            
                                            return (
                                                <div
                                                    key={emp.id}
                                                    onClick={() => {
                                                        onAddEmployee(key, emp.id);
                                                        setShowAddMenu(false);
                                                    }}
                                                    className={`p-4 hover:bg-blue-50 cursor-pointer border-b last:border-b-0 transition-colors ${
                                                        hasRequest ? 'bg-green-50' : 'bg-orange-50'
                                                    }`}
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="flex items-start gap-2 flex-1">
                                                            {hasRequest ? (
                                                                <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                                                            ) : (
                                                                <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                                                            )}
                                                            <div className="flex-1 min-w-0">
                                                                <div className="font-bold text-sm mb-1">{emp.employee_name}</div>
                                                                
                                                                {request?.late_arrival_time && (
                                                                    <div className="flex items-center gap-1 text-xs bg-orange-200 text-orange-900 font-bold px-2 py-1 rounded mb-1">
                                                                        <Clock className="w-3 h-3" />
                                                                        <span>⚠️ מגיע רק מ-{request.late_arrival_time}</span>
                                                                    </div>
                                                                )}
                                                                {request?.constraints && (
                                                                    <div className="text-xs bg-yellow-100 text-gray-800 px-2 py-1 rounded break-words font-medium">
                                                                        💬 {request.constraints}
                                                                    </div>
                                                                )}
                                                                {!hasRequest && (
                                                                    <div className="text-xs text-orange-700 font-bold mt-1">⚠️ לא ביקש משמרת זו</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default function BuildSchedulePage() {
    const { currentUser } = useUser();
    const [employees, setEmployees] = useState([]);
    const [employeesMap, setEmployeesMap] = useState({});
    const [requests, setRequests] = useState([]);
    const [assignments, setAssignments] = useState({});
    const [weekSchedule, setWeekSchedule] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [viewMode, setViewMode] = useState('schedule');
    const [debugInfo, setDebugInfo] = useState(null);
    const weekStartDate = getNextSunday();
    const weekStartDateISO = weekStartDate.toISOString().split('T')[0];

    useEffect(() => {
        if (!currentUser || (currentUser.employee_name !== "דניאל קריידן" && currentUser.role !== "מנהל" && currentUser.role !== "מנהל משמרת")) return;

        const loadData = async () => {
            setIsLoading(true);
            try {
                const [allEmployeesRaw, allRequests, schedules] = await Promise.all([
                    Employee.list(),
                    ShiftRequest.filter({ week_start_date: weekStartDateISO }),
                    WeeklySchedule.filter({ week_start_date: weekStartDateISO }, '-created_date', 1)
                ]);

                // Filter out technicians
                const allEmployees = allEmployeesRaw.filter(e => e.role !== 'טכנאי');

                console.log('🔍 DEBUG - Total employees (after filtering technicians):', allEmployees.length);
                console.log('🔍 DEBUG - Total requests:', allRequests.length);
                console.log('🔍 DEBUG - Week start date:', weekStartDateISO);

                const employeeIds = new Set(allEmployees.map(e => e.id));
                
                const matchingRequests = allRequests.filter(r => employeeIds.has(r.employee_id));
                const orphanRequests = allRequests.filter(r => !employeeIds.has(r.employee_id));
                
                console.log('✅ Matching requests (employee exists):', matchingRequests.length);
                console.log('❌ Orphan requests (employee not found):', orphanRequests);
                
                if (orphanRequests.length > 0) {
                    console.warn('⚠️ Found orphan requests:', orphanRequests);
                }

                const itaiEmployee = allEmployees.find(e => 
                    e.employee_name && e.employee_name.includes('איתי')
                );
                
                if (itaiEmployee) {
                    const itaiRequests = allRequests.filter(r => r.employee_id === itaiEmployee.id);
                    console.log('👤 Found איתי שינחה:', itaiEmployee);
                    console.log('📝 איתי\'s requests:', itaiRequests.length, itaiRequests);
                } else {
                    console.warn('❌ איתי שינחה not found in employees list!');
                }

                setDebugInfo({
                    totalEmployees: allEmployees.length,
                    totalRequests: allRequests.length,
                    matchingRequests: matchingRequests.length,
                    orphanRequests: orphanRequests.length,
                    itaiFound: !!itaiEmployee,
                    itaiRequestsCount: itaiEmployee ? allRequests.filter(r => r.employee_id === itaiEmployee.id).length : 0
                });

                const empMap = allEmployees.reduce((acc, emp) => ({ ...acc, [emp.id]: emp }), {});
                setEmployees(allEmployees);
                setEmployeesMap(empMap);
                setRequests(allRequests);

                let currentSchedule = schedules[0];
                if (!currentSchedule) {
                    currentSchedule = await WeeklySchedule.create({
                        week_start_date: weekStartDateISO,
                        created_by_id: currentUser.id
                    });
                }
                setWeekSchedule(currentSchedule);

                const existingAssignments = await ShiftAssignment.filter({ weekly_schedule_id: currentSchedule.id });
                
                const initialAssignments = {};
                existingAssignments.forEach(a => {
                    initialAssignments[`${a.day}-${a.shift_type}`] = a.assigned_employee_ids;
                });
                setAssignments(initialAssignments);

            } catch (error) {
                console.error('Error loading data:', error);
            }
            setIsLoading(false);
        };
        loadData();
    }, [currentUser, weekStartDateISO]);
    
    const addEmployeeToSlot = (key, employeeId) => {
        const currentAssignments = assignments[key] || [];
        if (currentAssignments.length < 3 && !currentAssignments.includes(employeeId)) {
            setAssignments(prev => ({
                ...prev,
                [key]: [...currentAssignments, employeeId]
            }));
        }
    };
    
    const removeEmployeeFromSlot = (key, employeeId) => {
        setAssignments(prev => ({
            ...prev,
            [key]: (prev[key] || []).filter(id => id !== employeeId)
        }));
    };

    const handleSave = async (isPublishing = false) => {
        if (!weekSchedule) return;
        setIsLoading(true);

        try {
            const oldAssignments = await ShiftAssignment.filter({ weekly_schedule_id: weekSchedule.id });
            for (const ass of oldAssignments) {
                await ShiftAssignment.delete(ass.id);
            }

            const newAssignments = [];
            for (const key in assignments) {
                if (assignments[key] && assignments[key].length > 0) {
                    const [day, shift_type] = key.split('-');
                    newAssignments.push({
                        weekly_schedule_id: weekSchedule.id,
                        day,
                        shift_type,
                        start_time: shift_type === 'בוקר' ? '09:00' : '15:00',
                        end_time: shift_type === 'בוקר' ? '15:00' : '21:00',
                        assigned_employee_ids: assignments[key]
                    });
                }
            }
            if (newAssignments.length > 0) {
                await ShiftAssignment.bulkCreate(newAssignments);
            }

            if (isPublishing) {
                await WeeklySchedule.update(weekSchedule.id, {
                    status: 'פורסם',
                    published_at: new Date().toISOString()
                });
                alert('✅ הסידור פורסם בהצלחה!');
            } else {
                await WeeklySchedule.update(weekSchedule.id, { status: 'טיוטה' });
                alert('✅ הטיוטה נשמרה!');
            }
        } catch (error) {
            console.error('Error saving:', error);
            alert('❌ שגיאה בשמירה');
        } finally {
            setIsLoading(false);
        }
    };

    if (!currentUser || (currentUser.employee_name !== "דניאל קריידן" && currentUser.role !== "מנהל" && currentUser.role !== "מנהל משמרת")) {
        return <div className="p-6">אין לך הרשאה לגשת לעמוד זה.</div>;
    }

    const totalSubmissions = requests.filter(r => r.is_available).length;
    const totalAssignments = Object.values(assignments).flat().length;
    const employeesWithSubmissions = [...new Set(requests.map(r => r.employee_id))].length;

    return (
        <div dir="rtl" className="p-4 sm:p-6 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">בניית סידור עבודה</h1>
                    <div className="flex flex-wrap gap-2 sm:gap-4 mt-2 text-xs sm:text-sm">
                        <Badge variant="outline" className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {employeesWithSubmissions}/{employees.length} עובדים הגישו
                        </Badge>
                        <Badge variant="outline" className="bg-green-50">
                            {totalSubmissions} משמרות זמינות
                        </Badge>
                        <Badge variant="outline">
                            {totalAssignments} עובדים שובצו
                        </Badge>
                        <Badge variant="outline">
                            שבוע: {weekStartDate.toLocaleDateString('he-IL')}
                        </Badge>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2 sm:gap-4 w-full sm:w-auto">
                    <Button onClick={() => handleSave(false)} disabled={isLoading} className="glass-button flex-1 sm:flex-none">
                        שמור טיוטה
                    </Button>
                    <Button onClick={() => handleSave(true)} disabled={isLoading} className="glass-button bg-blue-500/20 flex-1 sm:flex-none">
                        פרסם סידור
                    </Button>
                </div>
            </div>

            {debugInfo && (debugInfo.orphanRequests > 0 || !debugInfo.itaiFound || debugInfo.itaiRequestsCount === 0) && (
                <div className="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <h3 className="font-bold text-yellow-900 mb-2">⚠️ בעיות שזוהו:</h3>
                            <ul className="text-sm text-yellow-800 space-y-1">
                                {debugInfo.orphanRequests > 0 && (
                                    <li>• נמצאו {debugInfo.orphanRequests} בקשות שלא משוייכות לעובד קיים</li>
                                )}
                                {!debugInfo.itaiFound && (
                                    <li>• העובד "איתי שינחה" לא נמצא ברשימת העובדים</li>
                                )}
                                {debugInfo.itaiFound && debugInfo.itaiRequestsCount === 0 && (
                                    <li>• העובד "איתי שינחה" קיים אבל אין לו בקשות לשבוע זה</li>
                                )}
                            </ul>
                            <div className="mt-3 text-xs text-yellow-700">
                                סה"כ: {debugInfo.totalEmployees} עובדים | {debugInfo.totalRequests} בקשות | {debugInfo.matchingRequests} תקינות
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {isLoading && (
                <div className="text-center py-8">
                    <div className="text-xl">טוען נתונים...</div>
                </div>
            )}

            {!isLoading && (
                <Tabs value={viewMode} onValueChange={setViewMode} className="w-full">
                    <TabsList className="grid w-full grid-cols-2 bg-slate-100/80 p-1 rounded-xl h-auto">
                        <TabsTrigger value="schedule" className="text-xs sm:text-sm py-2">📅 סידור</TabsTrigger>
                        <TabsTrigger value="preferences" className="text-xs sm:text-sm py-2">👥 העדפות עובדים</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="schedule" className="mt-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-6" style={{ position: 'relative' }}>
                            {dayNames.map(day => (
                                <div key={day} className="space-y-4" style={{ position: 'relative' }}>
                                    <h3 className="text-center font-bold text-lg glass-card p-3 rounded-xl bg-gradient-to-r from-purple-100 to-blue-100">
                                        {`יום ${day}`}
                                    </h3>
                                    <ShiftSlot 
                                        day={day} 
                                        shift="בוקר" 
                                        assignments={assignments} 
                                        employeesMap={employeesMap} 
                                        requests={requests}
                                        onAddEmployee={addEmployeeToSlot}
                                        onRemoveEmployee={removeEmployeeFromSlot}
                                        availableEmployees={employees}
                                    />
                                    <ShiftSlot 
                                        day={day} 
                                        shift="ערב" 
                                        assignments={assignments} 
                                        employeesMap={employeesMap} 
                                        requests={requests}
                                        onAddEmployee={addEmployeeToSlot}
                                        onRemoveEmployee={removeEmployeeFromSlot}
                                        availableEmployees={employees}
                                    />
                                </div>
                            ))}
                        </div>
                    </TabsContent>
                    
                    <TabsContent value="preferences" className="mt-6">
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {employees.map(employee => (
                                <EmployeeAvailabilityCard 
                                    key={employee.id} 
                                    employee={employee} 
                                    requests={requests}
                                    assignments={assignments}
                                />
                            ))}
                        </div>
                    </TabsContent>
                </Tabs>
            )}
        </div>
    );
}