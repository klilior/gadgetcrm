import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Plus, Edit, Trash2, RefreshCw, DollarSign, Users } from "lucide-react";

export default function ShiftBonusManagement() {
    const { currentUser } = useUser();
    const [definitions, setDefinitions] = useState([]);
    const [agents, setAgents] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    
    const [showModal, setShowModal] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [form, setForm] = useState({
        agent_id: "",
        agent_name: "",
        bonus_per_shift: 0,
        valid_from: "",
        valid_to: "",
        is_active: true
    });

    // Filters
    const [filterAgent, setFilterAgent] = useState("all");
    const [filterActiveOnly, setFilterActiveOnly] = useState(true);

    const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [defsData, usersMap, employeesData] = await Promise.all([
                base44.entities.ShiftBonusDefinition.list('-created_date', 100),
                base44.entities.LinetUsersMap.list(null, 100),
                base44.entities.Employee.filter({ is_active: true })
            ]);
            setDefinitions(defsData);
            
            // Combine agents from both sources
            const agentsList = [
                ...usersMap.map(u => ({ id: u.user_id, name: u.user_name })),
                ...employeesData.map(e => ({ id: e.id, name: e.employee_name }))
            ];
            // Remove duplicates by name
            const uniqueAgents = [];
            const seenNames = new Set();
            agentsList.forEach(a => {
                if (!seenNames.has(a.name)) {
                    seenNames.add(a.name);
                    uniqueAgents.push(a);
                }
            });
            setAgents(uniqueAgents);
        } catch (error) {
            console.error("Error loading data:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            const data = { ...form };
            if (editingItem) {
                await base44.entities.ShiftBonusDefinition.update(editingItem.id, data);
            } else {
                await base44.entities.ShiftBonusDefinition.create(data);
            }
            setShowModal(false);
            resetForm();
            loadData();
        } catch (error) {
            alert("שגיאה: " + error.message);
        }
    };

    const handleDelete = async (item) => {
        if (!confirm('למחוק הגדרת בונוס משמרות זו?')) return;
        try {
            await base44.entities.ShiftBonusDefinition.delete(item.id);
            loadData();
        } catch (error) {
            alert("שגיאה: " + error.message);
        }
    };

    const openModal = (item = null) => {
        if (item) {
            setEditingItem(item);
            setForm({
                agent_id: item.agent_id || "",
                agent_name: item.agent_name || "",
                bonus_per_shift: item.bonus_per_shift || 0,
                valid_from: item.valid_from || "",
                valid_to: item.valid_to || "",
                is_active: item.is_active !== false
            });
        } else {
            resetForm();
        }
        setShowModal(true);
    };

    const resetForm = () => {
        setForm({
            agent_id: "",
            agent_name: "",
            bonus_per_shift: 0,
            valid_from: "",
            valid_to: "",
            is_active: true
        });
        setEditingItem(null);
    };

    const handleAgentSelect = (agentName) => {
        const agent = agents.find(a => a.name === agentName);
        setForm({
            ...form,
            agent_id: agent?.id || agentName,
            agent_name: agentName
        });
    };

    const filteredDefinitions = definitions.filter(d => {
        if (filterActiveOnly && !d.is_active) return false;
        if (filterAgent !== "all" && d.agent_name !== filterAgent) return false;
        return true;
    });

    if (!isManager) {
        return <div className="p-6 text-center"><h1 className="text-2xl font-bold text-red-600">אין הרשאה</h1></div>;
    }

    return (
        <div className="p-4 md:p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
                        <Calendar className="w-8 h-8 text-blue-600" />
                        ניהול בונוס משמרות
                    </h1>
                    <p className="text-gray-600 mt-1">הגדרת סכום בונוס לכל משמרת עבור כל נציג</p>
                </div>
                <Button onClick={() => openModal()} className="bg-blue-600 hover:bg-blue-700 text-white">
                    <Plus className="w-4 h-4 ml-2" />
                    הגדרה חדשה
                </Button>
            </div>

            {/* Filters */}
            <Card className="glass-card border-0">
                <CardContent className="p-4 flex flex-wrap gap-4 items-center">
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium">נציג:</label>
                        <Select value={filterAgent} onValueChange={setFilterAgent}>
                            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">כל הנציגים</SelectItem>
                                {agents.map(a => <SelectItem key={a.name} value={a.name}>{a.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch checked={filterActiveOnly} onCheckedChange={setFilterActiveOnly} />
                        <label className="text-sm">פעילים בלבד</label>
                    </div>
                </CardContent>
            </Card>

            {/* Table */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <DollarSign className="w-5 h-5 text-blue-600" />
                        הגדרות בונוס משמרות ({filteredDefinitions.length})
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="text-center py-12"><RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400" /></div>
                    ) : filteredDefinitions.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>אין הגדרות בונוס משמרות</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>נציג</TableHead>
                                        <TableHead className="text-center">בונוס למשמרת</TableHead>
                                        <TableHead>תוקף מ-</TableHead>
                                        <TableHead>תוקף עד</TableHead>
                                        <TableHead className="text-center">סטטוס</TableHead>
                                        <TableHead>פעולות</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredDefinitions.map((item) => (
                                        <TableRow key={item.id}>
                                            <TableCell className="font-medium">{item.agent_name || item.agent_id}</TableCell>
                                            <TableCell className="text-center">
                                                <Badge className="bg-blue-100 text-blue-800 text-lg px-3">
                                                    ₪{item.bonus_per_shift}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>{item.valid_from || '-'}</TableCell>
                                            <TableCell>{item.valid_to || 'פתוח'}</TableCell>
                                            <TableCell className="text-center">
                                                <Badge className={item.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}>
                                                    {item.is_active ? 'פעיל' : 'לא פעיל'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex gap-1">
                                                    <Button size="sm" variant="ghost" onClick={() => openModal(item)}>
                                                        <Edit className="w-4 h-4" />
                                                    </Button>
                                                    <Button size="sm" variant="ghost" className="text-red-600" onClick={() => handleDelete(item)}>
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Modal */}
            <Dialog open={showModal} onOpenChange={setShowModal}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingItem ? "עריכת הגדרת בונוס" : "הגדרת בונוס משמרות חדשה"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <label className="text-sm font-medium mb-1 block">נציג *</label>
                            <Select value={form.agent_name} onValueChange={handleAgentSelect}>
                                <SelectTrigger><SelectValue placeholder="בחר נציג" /></SelectTrigger>
                                <SelectContent>
                                    {agents.map(a => <SelectItem key={a.name} value={a.name}>{a.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>

                        <div>
                            <label className="text-sm font-medium mb-1 block">בונוס למשמרת (₪) *</label>
                            <Input 
                                type="number" 
                                value={form.bonus_per_shift} 
                                onChange={(e) => setForm({ ...form, bonus_per_shift: Number(e.target.value) })}
                                placeholder="לדוגמה: 50"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium mb-1 block">תוקף מ-</label>
                                <Input type="date" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} />
                            </div>
                            <div>
                                <label className="text-sm font-medium mb-1 block">תוקף עד (אופציונלי)</label>
                                <Input type="date" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} />
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium">פעיל</label>
                            <Switch checked={form.is_active} onCheckedChange={(checked) => setForm({ ...form, is_active: checked })} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowModal(false)}>ביטול</Button>
                        <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white" disabled={!form.agent_name || !form.bonus_per_shift}>
                            {editingItem ? "שמור" : "צור"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}