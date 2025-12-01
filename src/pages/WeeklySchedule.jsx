
import React, { useState, useEffect } from 'react';
import { WeeklySchedule, ShiftAssignment, Employee } from '@/entities/all';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getNextSunday, getPreviousSunday } from '../components/utils';
import { format, addDays } from 'date-fns';
import { he } from 'date-fns/locale';

const dayNames = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
const shiftTypes = ["בוקר", "ערב"];

export default function WeeklySchedulePage() {
    const [weekStart, setWeekStart] = useState(getNextSunday(new Date()));
    const [assignments, setAssignments] = useState([]);
    const [employeesMap, setEmployeesMap] = useState({});
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadSchedule = async () => {
            setIsLoading(true);
            const weekStartDateISO = weekStart.toISOString().split('T')[0];

            const [schedules, allEmployees] = await Promise.all([
                WeeklySchedule.filter({ week_start_date: weekStartDateISO, status: "פורסם" }, '-created_date', 1),
                Employee.list()
            ]);

            const empMap = allEmployees.reduce((acc, emp) => ({...acc, [emp.id]: emp}), {});
            setEmployeesMap(empMap);

            if (schedules.length > 0) {
                const publishedScheduleId = schedules[0].id;
                const fetchedAssignments = await ShiftAssignment.filter({ weekly_schedule_id: publishedScheduleId });
                setAssignments(fetchedAssignments);
            } else {
                setAssignments([]);
            }
            setIsLoading(false);
        };
        loadSchedule();
    }, [weekStart]);

    const handlePrint = () => {
        window.print();
    };

    return (
        <div dir="rtl" className="p-4 sm:p-6 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                 <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">סידור עבודה שבועי</h1>
                 <div className="flex flex-wrap gap-2 sm:gap-4 items-center">
                    <Button onClick={() => setWeekStart(getPreviousSunday(weekStart))} className="glass-button">קודם</Button>
                    <span className="font-semibold text-sm sm:text-base">{format(weekStart, "dd/MM/yy")}</span>
                    <Button onClick={() => setWeekStart(addDays(weekStart, 7))} className="glass-button">הבא</Button>
                    <Button onClick={handlePrint} className="glass-button">הדפסה</Button>
                 </div>
            </div>

            <div className="overflow-x-auto">
                <div className="grid grid-flow-col auto-cols-fr gap-4 min-w-[900px] sm:min-w-[1200px] md:grid-flow-row md:grid-cols-7 md:min-w-full">
                     {dayNames.map(day => (
                        <Card key={day} className="glass-card border-0">
                            <CardHeader className="text-center p-3 sm:p-4 bg-white/10">
                                <CardTitle className="text-lg sm:text-xl">{`יום ${day}`}</CardTitle>
                                <span className="text-xs text-gray-600">{format(addDays(weekStart, dayNames.indexOf(day)), 'dd/MM')}</span>
                            </CardHeader>
                            <CardContent className="p-2 sm:p-4 space-y-2 sm:space-y-4">
                                 {shiftTypes.map(shiftType => {
                                    const currentAssignment = assignments.find(a => a.day === day && a.shift_type === shiftType);
                                    return (
                                        <div key={shiftType} className="glass-card p-3 rounded-xl min-h-[100px]">
                                            <h4 className="font-semibold mb-2">{shiftType}</h4>
                                            {isLoading ? (
                                                <div className="space-y-2 animate-pulse">
                                                    <div className="h-4 w-full rounded bg-white/20"></div>
                                                    <div className="h-4 w-2/3 rounded bg-white/20"></div>
                                                </div>
                                            ) : currentAssignment && currentAssignment.assigned_employee_ids.length > 0 ? (
                                                <ul className="space-y-1">
                                                    {currentAssignment.assigned_employee_ids.map(id => (
                                                        <li key={id} className="p-1 rounded bg-white/20 text-sm">{employeesMap[id]?.employee_name || '...'}</li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <p className="text-xs text-gray-500 pt-4 text-center">אין משובצים</p>
                                            )}
                                        </div>
                                    );
                                 })}
                            </CardContent>
                        </Card>
                     ))}
                </div>
            </div>
        </div>
    );
}
