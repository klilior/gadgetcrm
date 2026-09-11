import React, { useState, useEffect } from "react";
import { Employee } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlusCircle, Edit, Trash2, Save, X, Briefcase, Mail, ToggleRight, ToggleLeft } from "lucide-react";
import EmployeeCard from "../components/employees/EmployeeCard";

export default function ManageEmployees() {
  const [employees, setEmployees] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentEmployee, setCurrentEmployee] = useState(null);
  const [editingEmployeeId, setEditingEmployeeId] = useState(null);
  const [selectedEmployeeForCard, setSelectedEmployeeForCard] = useState(null);

  const initialFormState = {
    username: "",
    employee_name: "",
    email: "",
    phone: "",
    id_number: "",
    birth_date: "",
    role: "נציג",
    password_hash: "",
    is_active: true,
    linet_employee_code: ""
  };

  const [formState, setFormState] = useState(initialFormState);

  useEffect(() => {
    loadEmployees();
  }, []);

  const loadEmployees = async () => {
    setIsLoading(true);
    const data = await Employee.list();
    setEmployees(data);
    setIsLoading(false);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    if (name === 'username') {
      setFormState(prev => ({ ...prev, [name]: value.trim().toUpperCase() }));
    } else {
      setFormState(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleSelectChange = (name, value) => {
    setFormState(prev => ({ ...prev, [name]: value }));
  };

  const handleEdit = (employee) => {
    setIsEditing(true);
    setCurrentEmployee(employee);
    setFormState({ ...employee, password_hash: "" }); // Don't show current password
    setShowForm(true);
  };

  const handleAddNew = () => {
    setIsEditing(false);
    setCurrentEmployee(null);
    setFormState(initialFormState);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setIsEditing(false);
    setFormState(initialFormState);
    setEditingEmployeeId(null);
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    const dataToSave = { ...formState };
    if (dataToSave.username) {
      dataToSave.username = dataToSave.username.trim().toUpperCase();
    }
    if (!dataToSave.password_hash) {
      delete dataToSave.password_hash;
    }

    if (isEditing) {
      await Employee.update(currentEmployee.id, dataToSave);
    } else {
      await Employee.create(dataToSave);
    }
    
    handleCancel();
    loadEmployees();
  };

  const handleInlineEdit = (employeeId) => {
    setEditingEmployeeId(employeeId);
  };

  const handleInlineSave = async (employee) => {
    const employeeToSave = {...employee};
    if (employeeToSave.username) {
        employeeToSave.username = employeeToSave.username.trim().toUpperCase();
    }
    await Employee.update(employee.id, employeeToSave);
    setEditingEmployeeId(null);
    loadEmployees();
  };

  const toggleActiveStatus = async (employee) => {
      await Employee.update(employee.id, { is_active: !employee.is_active });
      loadEmployees();
  };

  const handleDeleteEmployee = async (employee) => {
    if (window.confirm(`האם אתה בטוח שברצונך למחוק את העובד "${employee.employee_name}"? פעולה זו בלתי הפיכה!`)) {
      try {
        await Employee.delete(employee.id);
        loadEmployees();
      } catch (error) {
        console.error("Error deleting employee:", error);
        alert("שגיאה במחיקת העובד. נסה שוב.");
      }
    }
  };

  const handleEmployeeClick = (employee) => {
    setSelectedEmployeeForCard(employee);
  };

  const handleCloseEmployeeCard = () => {
    setSelectedEmployeeForCard(null);
  };

  const handleEmployeeUpdate = () => {
    setSelectedEmployeeForCard(null);
    loadEmployees();
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">ניהול עובדים ומשתמשים</h1>
        <div className="flex gap-3">
          <Button onClick={handleAddNew} style={{backgroundColor: '#7D0F82', color: 'white'}}>
            <PlusCircle className="w-4 h-4 ml-2" />
            הוסף עובד חדש
          </Button>
        </div>
      </div>

      {showForm && (
        <Card className="bg-white shadow-sm">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>{isEditing ? "עריכת עובד" : "הוספת עובד חדש"}</CardTitle>
              <Button variant="ghost" size="icon" onClick={handleCancel}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>שם מלא</Label>
                  <Input 
                    name="employee_name" 
                    value={formState.employee_name} 
                    onChange={handleInputChange} 
                    required 
                  />
                </div>
                <div>
                  <Label>שם משתמש (באנגלית)</Label>
                  <Input 
                    name="username" 
                    value={formState.username} 
                    onChange={handleInputChange} 
                    required 
                  />
                </div>
                <div>
                  <Label>דוא"ל</Label>
                  <Input 
                    type="email" 
                    name="email" 
                    value={formState.email} 
                    onChange={handleInputChange} 
                    required 
                  />
                </div>
                <div>
                  <Label>טלפון</Label>
                  <Input 
                    name="phone" 
                    value={formState.phone} 
                    onChange={handleInputChange} 
                  />
                </div>
                <div>
                  <Label>תעודת זהות</Label>
                  <Input 
                    name="id_number" 
                    value={formState.id_number || ""} 
                    onChange={handleInputChange} 
                  />
                </div>
                <div>
                  <Label>תאריך לידה</Label>
                  <Input 
                    type="date"
                    name="birth_date" 
                    value={formState.birth_date || ""} 
                    onChange={handleInputChange} 
                  />
                </div>
                <div>
                  <Label>קוד עובד (Linet)</Label>
                  <Input 
                    name="linet_employee_code" 
                    value={formState.linet_employee_code || ""} 
                    onChange={handleInputChange} 
                    placeholder="לדוגמה: 8743"
                  />
                </div>
                <div>
                  <Label>תפקיד</Label>
                  <Select value={formState.role} onValueChange={(v) => handleSelectChange('role', v)}>
                    <SelectTrigger className="bg-white">
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
                <div>
                  <Label>סיסמה {isEditing && "(השאר ריק כדי לא לשנות)"}</Label>
                  <Input 
                    type="password" 
                    name="password_hash" 
                    value={formState.password_hash} 
                    onChange={handleInputChange} 
                    required={!isEditing} 
                  />
                </div>
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={handleCancel} className="w-full sm:w-auto">ביטול</Button>
                <Button type="submit" className="w-full sm:w-auto" style={{backgroundColor: '#7D0F82', color: 'white'}}>
                  {isEditing ? "שמור שינויים" : "צור עובד"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="bg-white shadow-sm">
        <CardHeader><CardTitle>רשימת עובדים</CardTitle></CardHeader>
        <CardContent>
            {/* Mobile View */}
            <div className="space-y-4 md:hidden">
              {employees.map(emp => {
                const isInlineEditing = editingEmployeeId === emp.id;
                return (
                  <div key={emp.id} className="bg-white border border-gray-200 p-4 rounded-2xl space-y-3">
                      <div className="flex justify-between items-start">
                          <div className="font-bold text-lg">
                            <button 
                              onClick={() => handleEmployeeClick(emp)}
                              className="text-blue-600 hover:text-blue-800 font-medium underline"
                            >
                              {emp.employee_name}
                            </button>
                          </div>
                          <div className="flex gap-2">
                            {isInlineEditing ? (
                              <>
                                <Button size="icon" onClick={() => handleInlineSave(emp)} className="w-8 h-8 text-white" style={{backgroundColor: '#7D0F82'}}>
                                  <Save className="w-4 h-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="w-8 h-8" onClick={() => setEditingEmployeeId(null)}>
                                  <X className="w-4 h-4" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button size="icon" variant="ghost" className="w-8 h-8" onClick={() => handleInlineEdit(emp.id)}>
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="w-8 h-8 text-red-600 hover:bg-red-50" onClick={() => handleDeleteEmployee(emp)}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </>
                            )}
                          </div>
                      </div>
                      <div className="text-sm space-y-2">
                          <div className="flex items-center gap-2">
                            <Briefcase className="w-4 h-4"/>
                            {isInlineEditing ? (
                              <Select 
                                value={emp.role} 
                                onValueChange={(v) => setEmployees(prevEmployees => prevEmployees.map(mappedEmp => mappedEmp.id === emp.id ? {...mappedEmp, role: v} : mappedEmp))}
                              >
                                <SelectTrigger className="bg-white w-32">
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
                            ) : emp.role}
                          </div>
                          <div className="flex items-center gap-2"><Mail className="w-4 h-4"/> {emp.email}</div>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                          <div className="flex items-center gap-2">
                              {emp.is_active ? 
                                  <span className="text-green-600 font-medium">פעיל</span> : 
                                  <span className="text-gray-500">לא פעיל</span>
                              }
                          </div>
                          <Button size="sm" variant="ghost" onClick={() => toggleActiveStatus(emp)}>
                              {emp.is_active ? <ToggleRight className="w-6 h-6 text-green-500"/> : <ToggleLeft className="w-6 h-6 text-gray-500"/>}
                          </Button>
                      </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop View */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>שם</TableHead><TableHead>תפקיד</TableHead><TableHead>דוא"ל</TableHead><TableHead>קוד לינט</TableHead><TableHead>סטטוס</TableHead><TableHead>פעולות</TableHead></TableRow></TableHeader>
                <TableBody>
                  {employees.map(emp => {
                    const isInlineEditing = editingEmployeeId === emp.id;
                    return (
                      <TableRow key={emp.id}>
                        <TableCell>
                          <button 
                            onClick={() => handleEmployeeClick(emp)}
                            className="text-blue-600 hover:text-blue-800 font-medium underline"
                          >
                            {emp.employee_name}
                          </button>
                        </TableCell>
                        <TableCell>
                          {isInlineEditing ? (
                            <Select 
                              value={emp.role} 
                              onValueChange={(v) => setEmployees(prevEmployees => prevEmployees.map(mappedEmp => mappedEmp.id === emp.id ? {...mappedEmp, role: v} : mappedEmp))}
                            >
                              <SelectTrigger className="bg-white w-40">
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
                          ) : emp.role}
                        </TableCell>
                        <TableCell>{emp.email}</TableCell>
                        <TableCell>{emp.linet_employee_code || '-'}</TableCell>
                        <TableCell>{emp.is_active ? "פעיל" : "לא פעיל"}</TableCell>
                        <TableCell className="flex gap-2">
                          {isInlineEditing ? (
                            <>
                              <Button size="icon" onClick={() => handleInlineSave(emp)} className="text-white" style={{backgroundColor: '#7D0F82'}}>
                                <Save className="w-4 h-4" />
                              </Button>
                              <Button size="icon" variant="ghost" onClick={() => setEditingEmployeeId(null)}>
                                <X className="w-4 h-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button size="icon" variant="ghost" onClick={() => handleInlineEdit(emp.id)}>
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button size="icon" variant="ghost" onClick={() => toggleActiveStatus(emp)}>
                                  {emp.is_active ? <ToggleRight className="w-5 h-5 text-green-500"/> : <ToggleLeft className="w-5 h-5 text-gray-500"/>}
                              </Button>
                              <Button size="icon" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => handleDeleteEmployee(emp)}>
                                  <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
        </CardContent>
      </Card>

      <EmployeeCard
        employee={selectedEmployeeForCard}
        isOpen={!!selectedEmployeeForCard}
        onClose={handleCloseEmployeeCard}
        onUpdate={handleEmployeeUpdate}
      />
    </div>
  );
}