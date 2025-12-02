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
import { Target, Plus, Edit, Trash2, RefreshCw, Gift, Percent } from "lucide-react";

const METRIC_LABELS = {
    'UNITS': 'כמות יחידות',
    'NET_AMOUNT': 'סכום נטו (₪)',
    'LINES_4G_UNITS': 'קווים 4G',
    'LINES_5G_UNITS': 'קווים 5G'
};

const GROUP_LABELS = {
    'DEVICES': 'מכשירים',
    'LINES': 'קווים',
    'ACCESSORIES_GROUP': 'אביזרים'
};

export default function TargetBonusManagement() {
    const { currentUser } = useUser();
    const [definitions, setDefinitions] = useState([]);
    const [goals, setGoals] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    
    const [showModal, setShowModal] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [form, setForm] = useState({
        goal_id: "",
        goal_name: "",
        min_progress_percent: 100,
        bonus_amount: 0,
        is_active: true
    });

    // Selected goal details
    const [selectedGoal, setSelectedGoal] = useState(null);

    // Filters
    const [filterActiveOnly, setFilterActiveOnly] = useState(true);

    const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [defsData, goalsData] = await Promise.all([
                base44.entities.TargetBonusDefinition.list('-created_date', 100),
                base44.entities.GoalDefinition.list('-created_date', 200)
            ]);
            setDefinitions(defsData);
            setGoals(goalsData);
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
                await base44.entities.TargetBonusDefinition.update(editingItem.id, data);
            } else {
                await base44.entities.TargetBonusDefinition.create(data);
            }
            setShowModal(false);
            resetForm();
            loadData();
        } catch (error) {
            alert("שגיאה: " + error.message);
        }
    };

    const handleDelete = async (item) => {
        if (!confirm('למחוק הגדרת בונוס יעד זו?')) return;
        try {
            await base44.entities.TargetBonusDefinition.delete(item.id);
            loadData();
        } catch (error) {
            alert("שגיאה: " + error.message);
        }
    };

    const openModal = (item = null) => {
        if (item) {
            setEditingItem(item);
            const goal = goals.find(g => g.id === item.goal_id);
            setSelectedGoal(goal || null);
            setForm({
                goal_id: item.goal_id || "",
                goal_name: item.goal_name || "",
                min_progress_percent: item.min_progress_percent || 100,
                bonus_amount: item.bonus_amount || 0,
                is_active: item.is_active !== false
            });
        } else {
            resetForm();
        }
        setShowModal(true);
    };

    const resetForm = () => {
        setForm({
            goal_id: "",
            goal_name: "",
            min_progress_percent: 100,
            bonus_amount: 0,
            is_active: true
        });
        setSelectedGoal(null);
        setEditingItem(null);
    };

    const handleGoalSelect = (goalId) => {
        const goal = goals.find(g => g.id === goalId);
        setSelectedGoal(goal || null);
        setForm({
            ...form,
            goal_id: goalId,
            goal_name: goal?.name || ""
        });
    };

    // Get goal details for display
    const getGoalById = (goalId) => goals.find(g => g.id === goalId);

    const filteredDefinitions = definitions.filter(d => {
        if (filterActiveOnly && !d.is_active) return false;
        return true;
    });

    // Goals that don't have a bonus definition yet
    const availableGoals = goals.filter(g => {
        if (!g.is_active) return false;
        // If editing, include the current goal
        if (editingItem && editingItem.goal_id === g.id) return true;
        // Exclude goals that already have a definition
        return !definitions.find(d => d.goal_id === g.id);
    });

    if (!isManager) {
        return <div className="p-6 text-center"><h1 className="text-2xl font-bold text-red-600">אין הרשאה</h1></div>;
    }

    return (
        <div className="p-4 md:p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
                        <Gift className="w-8 h-8 text-amber-600" />
                        ניהול בונוס יעדים
                    </h1>
                    <p className="text-gray-600 mt-1">הגדרת בונוס על עמידה ביעדים מוגדרים</p>
                </div>
                <Button onClick={() => openModal()} className="bg-amber-600 hover:bg-amber-700 text-white" disabled={availableGoals.length === 0}>
                    <Plus className="w-4 h-4 ml-2" />
                    הגדרה חדשה
                </Button>
            </div>

            {/* Info Card */}
            <Card className="bg-amber-50 border-amber-200">
                <CardContent className="p-4">
                    <p className="text-sm text-amber-800">
                        <strong>💡 הסבר:</strong> כאן מגדירים בונוס כספי לכל יעד. כשנציג מגיע לאחוז ההתקדמות המינימלי - הוא מקבל את הבונוס.
                        <br />
                        היעדים עצמם מוגדרים במסך "יעדים וביצועים".
                    </p>
                </CardContent>
            </Card>

            {/* Filters */}
            <Card className="glass-card border-0">
                <CardContent className="p-4 flex flex-wrap gap-4 items-center">
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
                        <Target className="w-5 h-5 text-amber-600" />
                        הגדרות בונוס יעדים ({filteredDefinitions.length})
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="text-center py-12"><RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400" /></div>
                    ) : filteredDefinitions.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <Gift className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>אין הגדרות בונוס יעדים</p>
                            <p className="text-sm mt-2">צור יעד במסך "יעדים וביצועים" ואז הגדר לו בונוס כאן</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>שם יעד</TableHead>
                                        <TableHead>נציג/צוות</TableHead>
                                        <TableHead>תקופה</TableHead>
                                        <TableHead>קבוצה</TableHead>
                                        <TableHead>מדד</TableHead>
                                        <TableHead className="text-center">מינימום %</TableHead>
                                        <TableHead className="text-center">בונוס</TableHead>
                                        <TableHead className="text-center">סטטוס</TableHead>
                                        <TableHead>פעולות</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredDefinitions.map((item) => {
                                        const goal = getGoalById(item.goal_id);
                                        return (
                                            <TableRow key={item.id}>
                                                <TableCell className="font-medium">{item.goal_name || goal?.name || '-'}</TableCell>
                                                <TableCell>
                                                    <Badge variant="outline">
                                                        {goal?.scope_type === 'TEAM' ? 'צוות' : goal?.agent_name || '-'}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    {goal ? `${goal.period_start} - ${goal.period_end}` : '-'}
                                                </TableCell>
                                                <TableCell className="text-sm">{goal ? GROUP_LABELS[goal.commission_group_code] || goal.commission_group_code : '-'}</TableCell>
                                                <TableCell className="text-sm">{goal ? METRIC_LABELS[goal.metric_type] || goal.metric_type : '-'}</TableCell>
                                                <TableCell className="text-center">
                                                    <Badge className="bg-purple-100 text-purple-800">
                                                        {item.min_progress_percent}%
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Badge className="bg-amber-100 text-amber-800 text-lg px-3">
                                                        ₪{item.bonus_amount}
                                                    </Badge>
                                                </TableCell>
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
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Modal */}
            <Dialog open={showModal} onOpenChange={setShowModal}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editingItem ? "עריכת הגדרת בונוס" : "הגדרת בונוס יעד חדשה"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <label className="text-sm font-medium mb-1 block">יעד *</label>
                            <Select value={form.goal_id} onValueChange={handleGoalSelect}>
                                <SelectTrigger><SelectValue placeholder="בחר יעד" /></SelectTrigger>
                                <SelectContent>
                                    {availableGoals.map(g => (
                                        <SelectItem key={g.id} value={g.id}>
                                            {g.name} ({g.agent_name || 'צוות'})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Goal Summary */}
                        {selectedGoal && (
                            <div className="bg-gray-50 p-3 rounded-lg border text-sm">
                                <p className="font-medium mb-2">📊 פרטי היעד:</p>
                                <div className="grid grid-cols-2 gap-2 text-gray-600">
                                    <div><span className="font-medium">נציג:</span> {selectedGoal.agent_name || 'צוות'}</div>
                                    <div><span className="font-medium">קבוצה:</span> {GROUP_LABELS[selectedGoal.commission_group_code]}</div>
                                    <div><span className="font-medium">מדד:</span> {METRIC_LABELS[selectedGoal.metric_type]}</div>
                                    <div><span className="font-medium">יעד:</span> {selectedGoal.metric_type === 'NET_AMOUNT' ? `₪${selectedGoal.target_value}` : selectedGoal.target_value}</div>
                                    <div className="col-span-2"><span className="font-medium">תקופה:</span> {selectedGoal.period_start} עד {selectedGoal.period_end}</div>
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="text-sm font-medium mb-1 block">מינימום אחוז התקדמות לבונוס *</label>
                            <div className="flex items-center gap-2">
                                <Input 
                                    type="number" 
                                    value={form.min_progress_percent} 
                                    onChange={(e) => setForm({ ...form, min_progress_percent: Number(e.target.value) })}
                                    className="w-24"
                                    min={0}
                                    max={200}
                                />
                                <Percent className="w-4 h-4 text-gray-400" />
                                <span className="text-sm text-gray-500">(100 = בונוס רק בעמידה מלאה ביעד)</span>
                            </div>
                        </div>

                        <div>
                            <label className="text-sm font-medium mb-1 block">סכום בונוס (₪) *</label>
                            <Input 
                                type="number" 
                                value={form.bonus_amount} 
                                onChange={(e) => setForm({ ...form, bonus_amount: Number(e.target.value) })}
                                placeholder="לדוגמה: 200"
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium">פעיל</label>
                            <Switch checked={form.is_active} onCheckedChange={(checked) => setForm({ ...form, is_active: checked })} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowModal(false)}>ביטול</Button>
                        <Button onClick={handleSave} className="bg-amber-600 hover:bg-amber-700 text-white" disabled={!form.goal_id || !form.bonus_amount}>
                            {editingItem ? "שמור" : "צור"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}