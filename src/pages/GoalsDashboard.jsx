import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Target, Plus, RefreshCw, Edit, Trash2, TrendingUp, Users, Smartphone, Radio, ShoppingBag } from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";

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

const GROUP_ICONS = {
    'DEVICES': Smartphone,
    'LINES': Radio,
    'ACCESSORIES_GROUP': ShoppingBag
};

export default function GoalsDashboard() {
    const { currentUser } = useUser();
    const [goals, setGoals] = useState([]);
    const [progress, setProgress] = useState({});
    const [agents, setAgents] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isCalculating, setIsCalculating] = useState(false);
    
    const [showModal, setShowModal] = useState(false);
    const [editingGoal, setEditingGoal] = useState(null);
    const [form, setForm] = useState({
        name: "",
        scope_type: "AGENT",
        agent_name: "",
        commission_group_code: "DEVICES",
        metric_type: "UNITS",
        period_type: "MONTHLY",
        period_start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
        period_end: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
        target_value: 0,
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
            const [goalsData, progressData, agentsData] = await Promise.all([
                base44.entities.GoalDefinition.list('-created_date', 100),
                base44.entities.GoalProgress.list(null, 500),
                base44.entities.LinetUsersMap.list(null, 100)
            ]);
            setGoals(goalsData);
            setAgents(agentsData.map(a => a.user_name));
            
            // Map progress by goal_id
            const progressMap = {};
            progressData.forEach(p => { progressMap[p.goal_id] = p; });
            setProgress(progressMap);
        } catch (error) {
            console.error("Error loading data:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCalculateAll = async () => {
        setIsCalculating(true);
        try {
            const res = await base44.functions.invoke('calculateGoalProgress', { calculate_all: true });
            if (res.data.success) {
                alert(`✅ חישוב הושלם ל-${res.data.results.length} יעדים`);
                loadData();
            } else {
                alert('❌ שגיאה: ' + res.data.error);
            }
        } catch (error) {
            alert('❌ שגיאה: ' + error.message);
        } finally {
            setIsCalculating(false);
        }
    };

    const handleCalculateOne = async (goalId) => {
        try {
            await base44.functions.invoke('calculateGoalProgress', { goal_id: goalId });
            loadData();
        } catch (error) {
            alert('שגיאה: ' + error.message);
        }
    };

    const handleSave = async () => {
        try {
            if (editingGoal) {
                await base44.entities.GoalDefinition.update(editingGoal.id, form);
            } else {
                await base44.entities.GoalDefinition.create(form);
            }
            setShowModal(false);
            resetForm();
            loadData();
        } catch (error) {
            alert("שגיאה: " + error.message);
        }
    };

    const handleDelete = async (goal) => {
        if (!confirm('למחוק יעד זה?')) return;
        try {
            await base44.entities.GoalDefinition.delete(goal.id);
            loadData();
        } catch (error) {
            alert("שגיאה: " + error.message);
        }
    };

    const openModal = (goal = null) => {
        if (goal) {
            setEditingGoal(goal);
            setForm({
                name: goal.name || "",
                scope_type: goal.scope_type || "AGENT",
                agent_name: goal.agent_name || "",
                commission_group_code: goal.commission_group_code || "DEVICES",
                metric_type: goal.metric_type || "UNITS",
                period_type: goal.period_type || "MONTHLY",
                period_start: goal.period_start || "",
                period_end: goal.period_end || "",
                target_value: goal.target_value || 0,
                is_active: goal.is_active !== false
            });
        } else {
            resetForm();
        }
        setShowModal(true);
    };

    const resetForm = () => {
        setForm({
            name: "",
            scope_type: "AGENT",
            agent_name: "",
            commission_group_code: "DEVICES",
            metric_type: "UNITS",
            period_type: "MONTHLY",
            period_start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
            period_end: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
            target_value: 0,
            is_active: true
        });
        setEditingGoal(null);
    };

    const filteredGoals = goals.filter(g => {
        if (filterActiveOnly && !g.is_active) return false;
        if (filterAgent !== "all" && g.agent_name !== filterAgent) return false;
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
                        <Target className="w-8 h-8 text-amber-600" />
                        יעדים וביצועים
                    </h1>
                    <p className="text-gray-600 mt-1">הגדרת ומעקב אחר יעדי מכירות</p>
                    <p className="text-xs text-gray-500 mt-1">
                        💡 יעדים מגדירים מטרות ביצועים (כמות מכשירים, קווים, סכום אביזרים). הבונוס על יעד מוגדר במסך "בונוס יעדים".
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button onClick={handleCalculateAll} disabled={isCalculating} variant="outline">
                        <RefreshCw className={`w-4 h-4 ml-2 ${isCalculating ? 'animate-spin' : ''}`} />
                        חשב הכל
                    </Button>
                    <Button onClick={() => openModal()} className="bg-amber-600 hover:bg-amber-700 text-white">
                        <Plus className="w-4 h-4 ml-2" />
                        יעד חדש
                    </Button>
                </div>
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
                                {agents.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch checked={filterActiveOnly} onCheckedChange={setFilterActiveOnly} />
                        <label className="text-sm">פעילים בלבד</label>
                    </div>
                </CardContent>
            </Card>

            {/* Goals Table */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-amber-600" />
                        רשימת יעדים ({filteredGoals.length})
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="text-center py-12"><RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400" /></div>
                    ) : filteredGoals.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <Target className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>אין יעדים להצגה</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>שם יעד</TableHead>
                                        <TableHead>נציג/צוות</TableHead>
                                        <TableHead>קבוצה</TableHead>
                                        <TableHead>מדד</TableHead>
                                        <TableHead>תקופה</TableHead>
                                        <TableHead className="text-center">יעד</TableHead>
                                        <TableHead className="text-center">ביצוע</TableHead>
                                        <TableHead>התקדמות</TableHead>
                                        <TableHead>פעולות</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredGoals.map((goal) => {
                                        const prog = progress[goal.id];
                                        const progressPercent = prog?.progress_percent || 0;
                                        const Icon = GROUP_ICONS[goal.commission_group_code] || Target;
                                        
                                        return (
                                            <TableRow key={goal.id}>
                                                <TableCell className="font-medium">{goal.name}</TableCell>
                                                <TableCell>
                                                    <Badge variant="outline">
                                                        {goal.scope_type === 'TEAM' ? 'צוות' : goal.agent_name || '-'}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-1">
                                                        <Icon className="w-4 h-4" />
                                                        {GROUP_LABELS[goal.commission_group_code]}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-sm">{METRIC_LABELS[goal.metric_type]}</TableCell>
                                                <TableCell className="text-sm">
                                                    {goal.period_start} - {goal.period_end}
                                                </TableCell>
                                                <TableCell className="text-center font-bold">
                                                    {goal.metric_type === 'NET_AMOUNT' ? `₪${goal.target_value.toLocaleString()}` : goal.target_value}
                                                </TableCell>
                                                <TableCell className="text-center font-bold text-blue-600">
                                                    {prog ? (goal.metric_type === 'NET_AMOUNT' ? `₪${prog.current_value.toLocaleString(undefined, {maximumFractionDigits: 0})}` : prog.current_value) : '-'}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="w-32">
                                                        <div className="flex justify-between text-xs mb-1">
                                                            <span>{progressPercent.toFixed(0)}%</span>
                                                        </div>
                                                        <Progress 
                                                            value={Math.min(progressPercent, 100)} 
                                                            className={`h-2 ${progressPercent >= 100 ? '[&>div]:bg-green-500' : ''}`}
                                                        />
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex gap-1">
                                                        <Button size="sm" variant="ghost" onClick={() => handleCalculateOne(goal.id)} title="חשב">
                                                            <RefreshCw className="w-4 h-4" />
                                                        </Button>
                                                        <Button size="sm" variant="ghost" onClick={() => openModal(goal)}>
                                                            <Edit className="w-4 h-4" />
                                                        </Button>
                                                        <Button size="sm" variant="ghost" className="text-red-600" onClick={() => handleDelete(goal)}>
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

            {/* Create/Edit Modal */}
            <Dialog open={showModal} onOpenChange={setShowModal}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editingGoal ? "עריכת יעד" : "יעד חדש"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <label className="text-sm font-medium mb-1 block">שם היעד *</label>
                            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="לדוגמה: יעד מכשירים חודשי" />
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium mb-1 block">סוג *</label>
                                <Select value={form.scope_type} onValueChange={(v) => setForm({ ...form, scope_type: v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="AGENT">נציג</SelectItem>
                                        <SelectItem value="TEAM">צוות</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {form.scope_type === 'AGENT' && (
                                <div>
                                    <label className="text-sm font-medium mb-1 block">נציג</label>
                                    <Select value={form.agent_name} onValueChange={(v) => setForm({ ...form, agent_name: v })}>
                                        <SelectTrigger><SelectValue placeholder="בחר נציג" /></SelectTrigger>
                                        <SelectContent>
                                            {agents.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium mb-1 block">קבוצת עמלות *</label>
                                <Select value={form.commission_group_code} onValueChange={(v) => setForm({ ...form, commission_group_code: v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="DEVICES">מכשירים</SelectItem>
                                        <SelectItem value="LINES">קווים</SelectItem>
                                        <SelectItem value="ACCESSORIES_GROUP">אביזרים</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <label className="text-sm font-medium mb-1 block">סוג מדד *</label>
                                <Select value={form.metric_type} onValueChange={(v) => setForm({ ...form, metric_type: v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="UNITS">כמות יחידות</SelectItem>
                                        <SelectItem value="NET_AMOUNT">סכום נטו (₪)</SelectItem>
                                        <SelectItem value="LINES_4G_UNITS">קווים 4G</SelectItem>
                                        <SelectItem value="LINES_5G_UNITS">קווים 5G</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium mb-1 block">מתאריך *</label>
                                <Input type="date" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} />
                            </div>
                            <div>
                                <label className="text-sm font-medium mb-1 block">עד תאריך *</label>
                                <Input type="date" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} />
                            </div>
                        </div>

                        <div>
                            <label className="text-sm font-medium mb-1 block">ערך יעד *</label>
                            <Input type="number" value={form.target_value} onChange={(e) => setForm({ ...form, target_value: Number(e.target.value) })} />
                        </div>

                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium">יעד פעיל</label>
                            <Switch checked={form.is_active} onCheckedChange={(checked) => setForm({ ...form, is_active: checked })} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowModal(false)}>ביטול</Button>
                        <Button onClick={handleSave} className="bg-amber-600 hover:bg-amber-700 text-white">
                            {editingGoal ? "שמור" : "צור יעד"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}