import React, { useState, useEffect, useCallback } from 'react';
import { AttendanceDay, Employee } from '@/entities/all';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Clock, Calendar, Download, Users, TrendingUp } from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { he } from 'date-fns/locale';
import { useUser } from '../components/UserAuth';

export default function AttendanceManagerReport() {
    const { currentUser } = useUser();
    const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
    const [selectedEmployeeId, setSelectedEmployeeId] = useState('all');
    const [employees, setEmployees] = useState([]);
    const [employeesData, setEmployeesData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const isManager = currentUser?.role === 'מנהל';

    useEffect(() => {
        loadEmployees();
    }, []);

    useEffect(() => {
        if (employees.length > 0) {
            loadAllData();
        }
    }, [selectedMonth, employees]);

    const loadEmployees = async () => {
        try {
            const allEmployees = await Employee.filter({ 
                is_active: true,
                role: { $in: ['נציג', 'מנהל משמרת'] }
            }, 'employee_name');
            setEmployees(allEmployees);
        } catch (error) {
            console.error('Error loading employees:', error);
        }
    };

    const loadAllData = async () => {
        setIsLoading(true);
        try {
            const monthStart = startOfMonth(new Date(selectedMonth + '-01'));
            const monthEnd = endOfMonth(monthStart);
            
            const employeeStats = await Promise.all(
                employees.map(async (employee) => {
                    const days = await AttendanceDay.filter({
                        user_id: employee.id,
                        date: {
                            $gte: format(monthStart, 'yyyy-MM-dd'),
                            $lte: format(monthEnd, 'yyyy-MM-dd')
                        }
                    }, 'date');

                    const summary = days.reduce((acc, day) => ({
                        totalWorkHours: acc.totalWorkHours + (day.work_minutes / 60),
                        totalOvertime125: acc.totalOvertime125 + (day.overtime125_minutes / 60),
                        totalOvertime150: acc.totalOvertime150 + (day.overtime150_minutes / 60),
                        totalDays: acc.totalDays + (day.work_minutes > 0 ? 1 : 0),
                        issues: acc.issues + (day.status !== 'ok' ? 1 : 0)
                    }), {
                        totalWorkHours: 0,
                        totalOvertime125: 0,
                        totalOvertime150: 0,
                        totalDays: 0,
                        issues: 0
                    });

                    return {
                        employee,
                        summary,
                        days
                    };
                })
            );

            setEmployeesData(employeeStats);
        } catch (error) {
            console.error('Error loading attendance data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // Generate month options (last 12 months)
    const monthOptions = [];
    for (let i = 0; i < 12; i++) {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        const monthValue = format(date, 'yyyy-MM');
        const monthLabel = format(date, 'MMMM yyyy', { locale: he });
        monthOptions.push({ value: monthValue, label: monthLabel });
    }

    const filteredData = selectedEmployeeId === 'all' 
        ? employeesData 
        : employeesData.filter(data => data.employee.id === selectedEmployeeId);

    const totalStats = employeesData.reduce((acc, data) => ({
        totalWorkHours: acc.totalWorkHours + data.summary.totalWorkHours,
        totalOvertime125: acc.totalOvertime125 + data.summary.totalOvertime125,
        totalOvertime150: acc.totalOvertime150 + data.summary.totalOvertime150,
        totalDays: acc.totalDays + data.summary.totalDays,
        totalIssues: acc.totalIssues + data.summary.issues
    }), {
        totalWorkHours: 0,
        totalOvertime125: 0,
        totalOvertime150: 0,
        totalDays: 0,
        totalIssues: 0
    });

    if (!isManager) {
        return (
            <div className="p-6">
                <div className="glass-card p-8 text-center">
                    <h2 className="text-xl font-bold text-gray-900 mb-2">גישה מוגבלת</h2>
                    <p className="text-gray-600">דוח זה זמין למנהלים בלבד</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                    <Users className="w-8 h-8 text-blue-600" />
                    דוח נוכחות כללי
                </h1>
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center w-full md:w-auto">
                    <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                        <SelectTrigger className="w-full sm:w-48 glass-button">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {monthOptions.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    
                    <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                        <SelectTrigger className="w-full sm:w-48 glass-button">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">כל העובדים</SelectItem>
                            {employees.map(emp => (
                                <SelectItem key={emp.id} value={emp.id}>
                                    {emp.employee_name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Button variant="outline" className="glass-button w-full sm:w-auto">
                        <Download className="w-4 h-4 ml-2" />
                        ייצא Excel
                    </Button>
                </div>
            </div>

            {/* Summary Cards */}
            {selectedEmployeeId === 'all' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                    <Card className="glass-card border-0">
                        <CardContent className="p-6">
                            <div className="flex items-center gap-3">
                                <Users className="w-8 h-8 text-purple-600" />
                                <div>
                                    <p className="text-sm text-gray-600">עובדים פעילים</p>
                                    <p className="text-2xl font-bold">{employees.length}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="glass-card border-0">
                        <CardContent className="p-6">
                            <div className="flex items-center gap-3">
                                <Clock className="w-8 h-8 text-blue-600" />
                                <div>
                                    <p className="text-sm text-gray-600">סה"כ שעות עבודה</p>
                                    <p className="text-2xl font-bold">{totalStats.totalWorkHours.toFixed(1)}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="glass-card border-0">
                        <CardContent className="p-6">
                            <div className="flex items-center gap-3">
                                <Clock className="w-8 h-8 text-green-600" />
                                <div>
                                    <p className="text-sm text-gray-600">נוספות 125%</p>
                                    <p className="text-2xl font-bold">{totalStats.totalOvertime125.toFixed(1)}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="glass-card border-0">
                        <CardContent className="p-6">
                            <div className="flex items-center gap-3">
                                <Clock className="w-8 h-8 text-orange-600" />
                                <div>
                                    <p className="text-sm text-gray-600">נוספות 150%</p>
                                    <p className="text-2xl font-bold">{totalStats.totalOvertime150.toFixed(1)}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="glass-card border-0">
                        <CardContent className="p-6">
                            <div className="flex items-center gap-3">
                                <TrendingUp className="w-8 h-8 text-indigo-600" />
                                <div>
                                    <p className="text-sm text-gray-600">ממוצע לעובד</p>
                                    <p className="text-2xl font-bold">
                                        {employees.length > 0 ? (totalStats.totalWorkHours / employees.length).toFixed(1) : 0}
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Employees Table */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle>
                        {selectedEmployeeId === 'all' 
                            ? `סיכום לכל העובדים - ${format(new Date(selectedMonth + '-01'), 'MMMM yyyy', { locale: he })}`
                            : `דוח מפורט - ${employees.find(e => e.id === selectedEmployeeId)?.employee_name || ''}`
                        }
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="text-center py-8">טוען נתונים...</div>
                    ) : filteredData.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            <Calendar className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                            <p>אין נתוני נוכחות לחודש זה</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>עובד</TableHead>
                                        <TableHead className="text-center">ימי עבודה</TableHead>
                                        <TableHead className="text-center">שעות עבודה</TableHead>
                                        <TableHead className="text-center">נוספות 125%</TableHead>
                                        <TableHead className="text-center">נוספות 150%</TableHead>
                                        <TableHead className="text-center">בעיות</TableHead>
                                        <TableHead className="text-center">ממוצע יומי</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredData.map(({ employee, summary }) => {
                                        const avgDaily = summary.totalDays > 0 
                                            ? (summary.totalWorkHours / summary.totalDays).toFixed(1)
                                            : 0;
                                        
                                        return (
                                            <TableRow key={employee.id}>
                                                <TableCell className="font-medium">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold">
                                                            {employee.employee_name.charAt(0)}
                                                        </div>
                                                        <div>
                                                            <div className="font-semibold">{employee.employee_name}</div>
                                                            <div className="text-xs text-gray-500">{employee.role}</div>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-center font-semibold">
                                                    {summary.totalDays}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <span className="font-semibold text-blue-600">
                                                        {summary.totalWorkHours.toFixed(1)}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <span className="font-semibold text-green-600">
                                                        {summary.totalOvertime125.toFixed(1)}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <span className="font-semibold text-orange-600">
                                                        {summary.totalOvertime150.toFixed(1)}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    {summary.issues > 0 ? (
                                                        <span className="px-2 py-1 rounded-full bg-red-100 text-red-800 text-xs font-semibold">
                                                            {summary.issues}
                                                        </span>
                                                    ) : (
                                                        <span className="px-2 py-1 rounded-full bg-green-100 text-green-800 text-xs font-semibold">
                                                            ללא
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <span className="text-sm text-gray-600">
                                                        {avgDaily} שעות
                                                    </span>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}