import React, { useState, useEffect } from "react";
import { Shift, Employee } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from 'lucide-react';
import { format, addDays, startOfWeek } from 'date-fns';
import { he } from 'date-fns/locale';

export default function ShiftsPage() {
  const [shifts, setShifts] = useState([]);
  const [employees, setEmployees] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [week, setWeek] = useState(startOfWeek(new Date(), { weekStartsOn: 0 }));

  useEffect(() => {
    loadData();
  }, [week]);

  const loadData = async () => {
    setIsLoading(true);
    const [fetchedShifts, fetchedEmployees] = await Promise.all([
      Shift.list(),
      Employee.list()
    ]);
    
    const employeesMap = fetchedEmployees.reduce((acc, emp) => {
      acc[emp.id] = emp;
      return acc;
    }, {});

    setShifts(fetchedShifts);
    setEmployees(employeesMap);
    setIsLoading(false);
  };
  
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(week, i));

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">סידור משמרות</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
        {weekDays.map(day => (
          <Card key={day.toString()} className="glass-card border-0">
            <CardHeader className="text-center p-4 bg-white/10 rounded-t-2xl">
              <CardTitle className="text-lg">{format(day, 'EEEE', { locale: he })}</CardTitle>
              <p className="text-sm text-gray-600">{format(day, 'dd/MM')}</p>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              {['בוקר', 'ערב'].map(shiftType => {
                const currentShift = shifts.find(s => 
                  s.shift_type === shiftType && 
                  new Date(s.shift_date).toDateString() === day.toDateString()
                );
                return (
                  <div key={shiftType} className="glass-card p-3 rounded-xl">
                    <h4 className="font-semibold mb-2">{shiftType} (09:00-15:00)</h4>
                    {currentShift ? (
                      <ul className="list-disc list-inside text-sm space-y-1">
                        {currentShift.shift_employees?.map(empId => (
                          <li key={empId}>{employees[empId]?.employee_name || 'לא ידוע'}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-gray-500">אין משמרת</p>
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