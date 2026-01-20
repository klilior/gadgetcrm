import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import UnauthorizedRedirect from "../components/UnauthorizedRedirect";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit, Trash2, Users, Link2 } from "lucide-react";

export default function AgentCommissionAssignment() {
    const { currentUser, isLoading: userLoading } = useUser();
    const [assignments, setAssignments] = useState([]);
    const [models, setModels] = useState([]);
    const [agents, setAgents] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    
    const [showModal, setShowModal] = useState(false);
    const [editingAssignment, setEditingAssignment] = useState(null);
    const [form, setForm] = useState({
        agent_id: "",
        agent_name: "",
        commission_model_id: "",
        valid_from: "",
        valid_to: "",
        is_active: true
    });

    const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';

    useEffect(() => {
        if (!userLoading && currentUser) {
            loadData();
        }
    }, [userLoading, currentUser]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [assignmentsData, modelsData, agentsData] = await Promise.all([
                base44.entities.AgentCommissionModel.list('-created_date', 100),
                base44.entities.CommissionModel.filter({ is_active: true }),
                base44.entities.LinetUsersMap.list(null, 100)
            ]);
            setAssignments(assignmentsData);
            setModels(modelsData);
            setAgents(agentsData);
        } catch (error) {
            console.error("Error loading data:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            // Get agent name from selected agent
            const selectedAgent = agents.find(a => a.user_name === form.agent_id || a.user_id === form.agent_id);
            const agentName = selectedAgent?.user_name || form.agent_id;

            const data = {
                ...form,
                agent_name: agentName
            };

            if (editingAssignment) {
                await base44.entities.AgentCommissionModel.update(editingAssignment.id, data);
            } else {
                await base44.entities.AgentCommissionModel.create(data);
            }
            
            setShowModal(false);
            setEditingAssignment(null);
            resetForm();
            loadData();
        } catch (error) {
            alert("שגיאה בשמירה: " + error.message);
        }
    };

    const handleDelete = async (assignment) => {
        if (!confirm('למחוק שיוך זה?')) return;
        try {
            await base44.entities.AgentCommissionModel.delete(assignment.id);
            loadData();
        } catch (error) {
            alert("שגיאה במחיקה: " + error.message);
        }
    };

    const openModal = (assignment = null) => {
        if (assignment) {
            setEditingAssignment(assignment);
            setForm({
                agent_id: assignment.agent_id || "",
                agent_name: assignment.agent_name || "",
                commission_model_id: assignment.commission_model_id || "",
                valid_from: assignment.valid_from || "",
                valid_to: assignment.valid_to || "",
                is_active: assignment.is_active !== false
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
            commission_model_id: "",
            valid_from: "",
            valid_to: "",
            is_active: true
        });
        setEditingAssignment(null);
    };

    const getModelName = (modelId) => {
        const model = models.find(m => m.id === modelId);
        return model?.name || modelId;
    };

    if (!isManager) {
        return (
            <div className="p-6 text-center">
                <h1 className="text-2xl font-bold text-red-600">אין הרשאה</h1>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
                        <Link2 className="w-8 h-8 text-orange-600" />
                        שיוך מודלי עמלות לנציגים
                    </h1>
                    <p className="text-gray-600 mt-1">הגדרת מודל עמלות ספציפי לכל נציג</p>
                </div>
                <Button onClick={() => openModal()} className="bg-orange-600 hover:bg-orange-700 text-white">
                    <Plus className="w-4 h-4 ml-2" />
                    שיוך חדש
                </Button>
            </div>

            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-orange-600" />
                        שיוכים פעילים ({assignments.length})
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {assignments.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <Link2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>אין שיוכים ספציפיים</p>
                            <p className="text-sm mt-2">נציגים ללא שיוך ישתמשו במודל ברירת המחדל</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>נציג</TableHead>
                                    <TableHead>מודל עמלות</TableHead>
                                    <TableHead>תוקף מ-</TableHead>
                                    <TableHead>תוקף עד</TableHead>
                                    <TableHead className="text-center">סטטוס</TableHead>
                                    <TableHead>פעולות</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {assignments.map((assignment) => (
                                    <TableRow key={assignment.id}>
                                        <TableCell className="font-medium">{assignment.agent_name || assignment.agent_id}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline">{getModelName(assignment.commission_model_id)}</Badge>
                                        </TableCell>
                                        <TableCell>{assignment.valid_from || '-'}</TableCell>
                                        <TableCell>{assignment.valid_to || 'פתוח'}</TableCell>
                                        <TableCell className="text-center">
                                            <Badge className={assignment.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}>
                                                {assignment.is_active ? "פעיל" : "מושבת"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex gap-1">
                                                <Button size="sm" variant="ghost" onClick={() => openModal(assignment)}>
                                                    <Edit className="w-4 h-4" />
                                                </Button>
                                                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => handleDelete(assignment)}>
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Dialog open={showModal} onOpenChange={setShowModal}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editingAssignment ? "עריכת שיוך" : "שיוך חדש"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <label className="text-sm font-medium mb-1 block">נציג *</label>
                            <Select value={form.agent_id} onValueChange={(v) => setForm({ ...form, agent_id: v })}>
                                <SelectTrigger>
                                    <SelectValue placeholder="בחר נציג" />
                                </SelectTrigger>
                                <SelectContent>
                                    {agents.map(agent => (
                                        <SelectItem key={agent.id} value={agent.user_name}>
                                            {agent.user_name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        
                        <div>
                            <label className="text-sm font-medium mb-1 block">מודל עמלות *</label>
                            <Select value={form.commission_model_id} onValueChange={(v) => setForm({ ...form, commission_model_id: v })}>
                                <SelectTrigger>
                                    <SelectValue placeholder="בחר מודל" />
                                </SelectTrigger>
                                <SelectContent>
                                    {models.map(model => (
                                        <SelectItem key={model.id} value={model.id}>
                                            {model.name} {model.is_default && "(ברירת מחדל)"}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium mb-1 block">תוקף מ-</label>
                                <Input 
                                    type="date"
                                    value={form.valid_from}
                                    onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium mb-1 block">תוקף עד</label>
                                <Input 
                                    type="date"
                                    value={form.valid_to}
                                    onChange={(e) => setForm({ ...form, valid_to: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium">שיוך פעיל</label>
                            <Switch 
                                checked={form.is_active}
                                onCheckedChange={(checked) => setForm({ ...form, is_active: checked })}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowModal(false)}>ביטול</Button>
                        <Button onClick={handleSave} className="bg-orange-600 hover:bg-orange-700 text-white">
                            {editingAssignment ? "שמור" : "צור שיוך"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}