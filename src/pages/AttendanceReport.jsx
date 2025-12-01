import React, { useState, useEffect, useCallback } from 'react';
import { AttendanceDay, AttendanceEdit, Employee } from '@/entities/all';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Calendar, Clock, AlertCircle, Edit, FileText, Download } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { he } from 'date-fns/locale';
import { useUser } from '../components/UserAuth';
import RequestEditModal from '../components/attendance/RequestEditModal';

export default function AttendanceReport() {
    const { currentUser } = useUser();
    const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
    const [attendanceDays, setAttendanceDays] = useState([]);
    const [monthSummary, setMonthSummary] = useState({
        totalWorkHours: 0,
        totalOvertime125: 0,
        totalOvertime150: 0,
        totalDays: 0
    });
    const [isLoading, setIsLoading] = useState(true);
    const [editingDay, setEditingDay] = useState(null);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'מנהל משמרת';

    const loadMonthData = useCallback(async () => {
        if (!currentUser) return;
        
        setIsLoading(true);
        try {
            const monthStart = startOfMonth(new Date(selectedMonth + '-01'));
            const monthEnd = endOfMonth(monthStart);
            
            const days = await AttendanceDay.filter({
                user_id: currentUser.id,
                date: {
                    $gte: format(monthStart, 'yyyy-MM-dd'),
                    $lte: format(monthEnd, 'yyyy-MM-dd')
                }
            }, 'date');

            setAttendanceDays(days);

            // Calculate summary
            const summary = days.reduce((acc, day) => ({
                totalWorkHours: acc.totalWorkHours + (day.work_minutes / 60),
                totalOvertime125: acc.totalOvertime125 + (day.overtime125_minutes / 60),
                totalOvertime150: acc.totalOvertime150 + (day.overtime150_minutes / 60),
                totalDays: acc.totalDays + (day.work_minutes > 0 ? 1 : 0)
            }), {
                totalWorkHours: 0,
                totalOvertime125: 0,
                totalOvertime150: 0,
                totalDays: 0
            });

            setMonthSummary(summary);
        } catch (error) {
            console.error('Error loading attendance data:', error);
        } finally {
            setIsLoading(false);
        }
    }, [currentUser, selectedMonth]);

    useEffect(() => {
        loadMonthData();
    }, [loadMonthData]);

    const getStatusBadge = (status) => {
        const statusConfig = {
            'ok': { label: 'תקין', color: 'bg-green-100 text-green-800' },
            'missing_out': { label: 'חסר יציאה', color: 'bg-yellow-100 text-yellow-800' },
            'pending_fix': { label: 'ממתין לתיקון', color: 'bg-orange-100 text-orange-800' },
            'vacation': { label: 'חופשה', color: 'bg-blue-100 text-blue-800' },
            'sick': { label: 'מחלה', color: 'bg-purple-100 text-purple-800' }
        };
        const config = statusConfig[status] || statusConfig['ok'];
        return <Badge className={config.color}>{config.label}</Badge>;
    };

    const formatMinutesToHours = (minutes) => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}:${mins.toString().padStart(2, '0')}`;
    };

    const handleRequestEdit = (day) => {
        setEditingDay(day);
        setIsEditModalOpen(true);
    };

    const handleEditSubmitted = () => {
        setIsEditModalOpen(false);
        setEditingDay(null);
        loadMonthData();
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

    return (
        <div className="p-6 space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-gray-900">הדוח שלי</h1>
                <div className="flex gap-4 items-center">
                    <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                        <SelectTrigger className="w-48 glass-button">
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
                    <Button variant="outline" className="glass-button">
                        <Download className="w-4 h-4 ml-2" />
                        ייצא PDF
                    </Button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="glass-card border-0">
                    <CardContent className="p-6">
                        <div className="flex items-center gap-3">
                            <Clock className="w-8 h-8 text-blue-600" />
                            <div>
                                <p className="text-sm text-gray-600">שעות עבודה</p>
                                <p className="text-2xl font-bold">{monthSummary.totalWorkHours.toFixed(1)}</p>
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
                                <p className="text-2xl font-bold">{monthSummary.totalOvertime125.toFixed(1)}</p>
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
                                <p className="text-2xl font-bold">{monthSummary.totalOvertime150.toFixed(1)}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="glass-card border-0">
                    <CardContent className="p-6">
                        <div className="flex items-center gap-3">
                            <Calendar className="w-8 h-8 text-purple-600" />
                            <div>
                                <p className="text-sm text-gray-600">ימי עבודה</p>
                                <p className="text-2xl font-bold">{monthSummary.totalDays}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Daily Attendance Table */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle>פירוט יומי</CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="text-center py-8">טוען נתונים...</div>
                    ) : attendanceDays.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            <FileText className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                            <p>אין נתוני נוכחות לחודש זה</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>תאריך</TableHead>
                                        <TableHead>כניסה</TableHead>
                                        <TableHead>יציאה</TableHead>
                                        <TableHead>שעות עבודה</TableHead>
                                        <TableHead>נוספות 125%</TableHead>
                                        <TableHead>נוספות 150%</TableHead>
                                        <TableHead>סטטוס</TableHead>
                                        <TableHead>פעולות</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {attendanceDays.map(day => (
                                        <TableRow key={day.id}>
                                            <TableCell className="font-medium">
                                                {format(new Date(day.date), 'dd/MM/yyyy - EEEE', { locale: he })}
                                            </TableCell>
                                            <TableCell>{day.first_in || '-'}</TableCell>
                                            <TableCell>{day.last_out || '-'}</TableCell>
                                            <TableCell>{formatMinutesToHours(day.work_minutes)}</TableCell>
                                            <TableCell>{formatMinutesToHours(day.overtime125_minutes)}</TableCell>
                                            <TableCell>{formatMinutesToHours(day.overtime150_minutes)}</TableCell>
                                            <TableCell>{getStatusBadge(day.status)}</TableCell>
                                            <TableCell>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleRequestEdit(day)}
                                                    className="text-blue-600"
                                                >
                                                    <Edit className="w-4 h-4 ml-1" />
                                                    בקש עדכון
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <RequestEditModal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                day={editingDay}
                onSubmitted={handleEditSubmitted}
            />
        </div>
    );
}