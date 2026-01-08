import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Target, Plus, RefreshCw, Edit, Trash2, TrendingUp, Smartphone, Radio, ShoppingBag, Save, Calendar } from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { he } from "date-fns/locale";

export default function GoalsDashboard() {
    const { currentUser } = useUser();
    const [goals, setGoals] = useState([]);
    const [progress, setProgress] = useState({});
    const [agents, setAgents] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    
    const [showModal, setShowModal] = useState(false);
    const [editingAgent, setEditingAgent] = useState(null);
    const [periodStart, setPeriodStart] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
    const [periodEnd, setPeriodEnd] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
    
    // Form for all targets of one agent
    const [agentTargets, setAgentTargets] = useState({
        agent_name: '',
        devices: 0,
        accessories: 0,
        lines: 0
    });

    const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';

    useEffect(() => {
        loadData();
    }, [periodStart, periodEnd]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [goalsData, progressData, agentsData] = await Promise.all([
                base44.entities.GoalDefinition.filter({ is_active: true }),
                base44.entities.GoalProgress.list(null, 500),
                base44.entities.LinetUsersMap.list(null, 100)
            ]);
            
            setGoals(goalsData || []);
            setAgents(agentsData?.map(a => a.user_name) || []);
            
            // Map progress by goal_id
            const progressMap = {};
            (progressData || []).forEach(p => { progressMap[p.goal_id] = p; });
            setProgress(progressMap);
        } catch (error) {
            console.error("Error loading data:", error);
        } finally {
            setIsLoading(false);
        }
    };

    // Group goals by agent for the current period
    const getAgentGoals = () => {
        const agentMap = {};
        
        goals.forEach(goal => {
            // Filter by period
            if (goal.period_start !== periodStart || goal.period_end !== periodEnd) return;
            
            const agentName = goal.agent_name || 'צוות';
            if (!agentMap[agentName]) {
                agentMap[agentName] = {
                    agent_name: agentName,
                    devices: { target: 0, actual: 0, goalId: null },
                    accessories: { target: 0, actual: 0, goalId: null },
                    lines: { target: 0, actual: 0, goalId: null }
                };
            }
            
            const prog = progress[goal.id];
            
            if (goal.commission_group_code === 'DEVICES') {
                agentMap[agentName].devices = {
                    target: goal.target_value,
                    actual: prog?.current_value || 0,
                    goalId: goal.id
                };
            } else if (goal.commission_group_code === 'ACCESSORIES_GROUP') {
                agentMap[agentName].accessories = {
                    target: goal.target_value,
                    actual: prog?.current_value || 0,
                    goalId: goal.id
                };
            } else if (goal.commission_group_code === 'LINES') {
                agentMap[agentName].lines = {
                    target: goal.target_value,
                    actual: prog?.current_value || 0,
                    goalId: goal.id
                };
            }
        });
        
        return Object.values(agentMap);
    };

    const openEditModal = (agentData = null) => {
        if (agentData) {
            setEditingAgent(agentData.agent_name);
            setAgentTargets({
                agent_name: agentData.agent_name,
                devices: agentData.devices?.target || 0,
                accessories: agentData.accessories?.target || 0,
                lines: agentData.lines?.target || 0
            });
        } else {
            setEditingAgent(null);
            setAgentTargets({
                agent_name: '',
                devices: 0,
                accessories: 0,
                lines: 0
            });
        }
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!agentTargets.agent_name) {
            alert('נא לבחור נציג');
            return;
        }

        setIsSaving(true);
        try {
            // Find existing goals for this agent and period
            const existingGoals = goals.filter(g => 
                g.agent_name === agentTargets.agent_name &&
                g.period_start === periodStart &&
                g.period_end === periodEnd
            );

            const goalConfigs = [
                { code: 'DEVICES', value: agentTargets.devices, metric: 'UNITS', name: 'מכשירים' },
                { code: 'ACCESSORIES_GROUP', value: agentTargets.accessories, metric: 'NET_AMOUNT', name: 'אביזרים' },
                { code: 'LINES', value: agentTargets.lines, metric: 'UNITS', name: 'קווים' }
            ];

            for (const config of goalConfigs) {
                const existing = existingGoals.find(g => g.commission_group_code === config.code);
                
                if (config.value > 0) {
                    const goalData = {
                        name: config.name,
                        scope_type: 'AGENT',
                        agent_name: agentTargets.agent_name,
                        commission_group_code: config.code,
                        metric_type: config.metric,
                        period_type: 'MONTHLY',
                        period_start: periodStart,
                        period_end: periodEnd,
                        target_value: config.value,
                        is_active: true
                    };

                    if (existing) {
                        await base44.entities.GoalDefinition.update(existing.id, goalData);
                    } else {
                        await base44.entities.GoalDefinition.create(goalData);
                    }
                } else if (existing) {
                    // Delete if value is 0
                    await base44.entities.GoalDefinition.delete(existing.id);
                }
            }

            setShowModal(false);
            loadData();
        } catch (error) {
            alert("שגיאה: " + error.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteAgent = async (agentName) => {
        if (!confirm(`למחוק את כל היעדים של ${agentName} לתקופה הנוכחית?`)) return;
        
        try {
            const agentGoals = goals.filter(g => 
                g.agent_name === agentName &&
                g.period_start === periodStart &&
                g.period_end === periodEnd
            );
            
            for (const goal of agentGoals) {
                await base44.entities.GoalDefinition.delete(goal.id);
            }
            loadData();
        } catch (error) {
            alert("שגיאה: " + error.message);
        }
    };

    const calcPercent = (actual, target) => target > 0 ? Math.round((actual / target) * 100) : 0;
    
    const getProgressColor = (percent) => {
        if (percent >= 100) return 'bg-green-500';
        if (percent >= 60) return 'bg-amber-500';
        return 'bg-red-500';
    };

    const agentGoals = getAgentGoals();

    // Calculate totals
    const totals = agentGoals.reduce((acc, agent) => ({
        devices: { target: acc.devices.target + agent.devices.target, actual: acc.devices.actual + agent.devices.actual },
        accessories: { target: acc.accessories.target + agent.accessories.target, actual: acc.accessories.actual + agent.accessories.actual },
        lines: { target: acc.lines.target + agent.lines.target, actual: acc.lines.actual + agent.lines.actual }
    }), {
        devices: { target: 0, actual: 0 },
        accessories: { target: 0, actual: 0 },
        lines: { target: 0, actual: 0 }
    });

    if (!isManager) {
        return <div className="p-6 text-center"><h1 className="text-2xl font-bold text-red-600">אין הרשאה</h1></div>;
    }

    const formatPeriod = () => {
        try {
            const start = new Date(periodStart);
            return format(start, 'MMMM yyyy', { locale: he });
        } catch {
            return '';
        }
    };

    return (
        <div className="p-4 md:p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
                        <Target className="w-8 h-8 text-amber-600" />
                        יעדים חודשיים
                    </h1>
                    <p className="text-gray-600 mt-1">הגדרת יעדים לנציגים - מכשירים, אביזרים וקווים</p>
                </div>
                <Button onClick={() => openEditModal()} className="bg-amber-600 hover:bg-amber-700 text-white">
                    <Plus className="w-4 h-4 ml-2" />
                    הוסף נציג
                </Button>
            </div>

            {/* Period Selector */}
            <Card className="glass-card border-0">
                <CardContent className="p-4 flex flex-wrap gap-4 items-center">
                    <div className="flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-gray-500" />
                        <label className="text-sm font-medium">תקופה:</label>
                    </div>
                    <Input 
                        type="date" 
                        value={periodStart} 
                        onChange={(e) => setPeriodStart(e.target.value)}
                        className="w-40"
                    />
                    <span>עד</span>
                    <Input 
                        type="date" 
                        value={periodEnd} 
                        onChange={(e) => setPeriodEnd(e.target.value)}
                        className="w-40"
                    />
                    <Button variant="outline" onClick={loadData} disabled={isLoading}>
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                    <Badge variant="outline" className="text-lg px-4 py-1">
                        {formatPeriod()}
                    </Badge>
                </CardContent>
            </Card>

            {/* Goals Table */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-amber-600" />
                        יעדים וביצועים ({agentGoals.length} נציגים)
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="text-center py-12">
                            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                        </div>
                    ) : agentGoals.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <Target className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>אין יעדים לתקופה זו</p>
                            <Button onClick={() => openEditModal()} className="mt-4">
                                <Plus className="w-4 h-4 ml-2" />
                                הוסף יעדים
                            </Button>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-gray-50">
                                        <TableHead className="font-bold">נציג</TableHead>
                                        <TableHead className="text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <Smartphone className="w-4 h-4" />
                                                מכשירים
                                            </div>
                                        </TableHead>
                                        <TableHead className="text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <ShoppingBag className="w-4 h-4" />
                                                אביזרים (₪)
                                            </div>
                                        </TableHead>
                                        <TableHead className="text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <Radio className="w-4 h-4" />
                                                קווים
                                            </div>
                                        </TableHead>
                                        <TableHead className="text-center">פעולות</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {agentGoals.map((agent) => (
                                        <TableRow key={agent.agent_name} className="hover:bg-gray-50">
                                            <TableCell className="font-bold text-lg">{agent.agent_name}</TableCell>
                                            
                                            {/* Devices */}
                                            <TableCell>
                                                <TargetCell 
                                                    actual={agent.devices.actual} 
                                                    target={agent.devices.target}
                                                    isAmount={false}
                                                />
                                            </TableCell>
                                            
                                            {/* Accessories */}
                                            <TableCell>
                                                <TargetCell 
                                                    actual={agent.accessories.actual} 
                                                    target={agent.accessories.target}
                                                    isAmount={true}
                                                />
                                            </TableCell>
                                            
                                            {/* Lines */}
                                            <TableCell>
                                                <TargetCell 
                                                    actual={agent.lines.actual} 
                                                    target={agent.lines.target}
                                                    isAmount={false}
                                                />
                                            </TableCell>
                                            
                                            <TableCell className="text-center">
                                                <div className="flex justify-center gap-1">
                                                    <Button size="sm" variant="ghost" onClick={() => openEditModal(agent)}>
                                                        <Edit className="w-4 h-4" />
                                                    </Button>
                                                    <Button size="sm" variant="ghost" className="text-red-600" onClick={() => handleDeleteAgent(agent.agent_name)}>
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    
                                    {/* Totals Row */}
                                    <TableRow className="bg-purple-50 font-bold border-t-2">
                                        <TableCell className="font-bold text-lg">סה״כ</TableCell>
                                        <TableCell>
                                            <TargetCell actual={totals.devices.actual} target={totals.devices.target} isAmount={false} />
                                        </TableCell>
                                        <TableCell>
                                            <TargetCell actual={totals.accessories.actual} target={totals.accessories.target} isAmount={true} />
                                        </TableCell>
                                        <TableCell>
                                            <TargetCell actual={totals.lines.actual} target={totals.lines.target} isAmount={false} />
                                        </TableCell>
                                        <TableCell></TableCell>
                                    </TableRow>
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Edit Modal */}
            <Dialog open={showModal} onOpenChange={setShowModal}>
                <DialogContent className="max-w-md" dir="rtl">
                    <DialogHeader>
                        <DialogTitle className="text-xl">
                            {editingAgent ? `עריכת יעדים - ${editingAgent}` : 'הוספת יעדים לנציג'}
                        </DialogTitle>
                    </DialogHeader>
                    
                    <div className="space-y-5 py-4">
                        {!editingAgent && (
                            <div>
                                <label className="text-sm font-medium mb-2 block">בחר נציג</label>
                                <Select value={agentTargets.agent_name} onValueChange={(v) => setAgentTargets({ ...agentTargets, agent_name: v })}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="בחר נציג..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {agents.map(a => (
                                            <SelectItem key={a} value={a}>{a}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        <div className="space-y-4">
                            <div className="bg-blue-50 rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <Smartphone className="w-5 h-5 text-blue-600" />
                                    <label className="font-medium">יעד מכשירים</label>
                                </div>
                                <Input 
                                    type="number" 
                                    value={agentTargets.devices || ''} 
                                    onChange={(e) => setAgentTargets({ ...agentTargets, devices: Number(e.target.value) })}
                                    placeholder="כמות יחידות"
                                    className="text-lg"
                                />
                            </div>

                            <div className="bg-green-50 rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <ShoppingBag className="w-5 h-5 text-green-600" />
                                    <label className="font-medium">יעד אביזרים (₪)</label>
                                </div>
                                <Input 
                                    type="number" 
                                    value={agentTargets.accessories || ''} 
                                    onChange={(e) => setAgentTargets({ ...agentTargets, accessories: Number(e.target.value) })}
                                    placeholder="סכום בש״ח"
                                    className="text-lg"
                                />
                            </div>

                            <div className="bg-purple-50 rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <Radio className="w-5 h-5 text-purple-600" />
                                    <label className="font-medium">יעד קווים</label>
                                </div>
                                <Input 
                                    type="number" 
                                    value={agentTargets.lines || ''} 
                                    onChange={(e) => setAgentTargets({ ...agentTargets, lines: Number(e.target.value) })}
                                    placeholder="כמות קווים"
                                    className="text-lg"
                                />
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowModal(false)}>ביטול</Button>
                        <Button 
                            onClick={handleSave} 
                            disabled={isSaving || !agentTargets.agent_name}
                            className="bg-amber-600 hover:bg-amber-700 text-white"
                        >
                            {isSaving ? (
                                <RefreshCw className="w-4 h-4 ml-2 animate-spin" />
                            ) : (
                                <Save className="w-4 h-4 ml-2" />
                            )}
                            שמור יעדים
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

// Target Cell Component
function TargetCell({ actual, target, isAmount }) {
    if (target === 0 && actual === 0) {
        return <div className="text-center text-gray-400">-</div>;
    }

    const percent = target > 0 ? Math.round((actual / target) * 100) : 0;
    const colorClass = percent >= 100 ? 'text-green-600' : percent >= 60 ? 'text-amber-600' : 'text-red-600';
    const bgClass = percent >= 100 ? 'bg-green-500' : percent >= 60 ? 'bg-amber-500' : 'bg-red-500';

    const formatValue = (val) => isAmount ? `₪${val.toLocaleString()}` : val;

    return (
        <div className="space-y-1">
            <div className="flex justify-between items-center text-sm">
                <span className="font-medium">{formatValue(actual)}</span>
                <span className="text-gray-500">/ {formatValue(target)}</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div 
                    className={`h-full ${bgClass} transition-all duration-500`}
                    style={{ width: `${Math.min(percent, 100)}%` }}
                />
            </div>
            <div className={`text-center text-sm font-bold ${colorClass}`}>
                {percent}%
            </div>
        </div>
    );
}