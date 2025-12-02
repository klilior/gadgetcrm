import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
    Calculator, RefreshCw, Download, Users, ChevronDown, ChevronUp, 
    DollarSign, TrendingUp, Filter, FileSpreadsheet, Target, Calendar, Gift
} from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";

export default function CommissionCalculation() {
    const { currentUser } = useUser();
    const [isLoading, setIsLoading] = useState(false);
    const [isCalculating, setIsCalculating] = useState(false);
    const [entries, setEntries] = useState([]);
    const [bonuses, setBonuses] = useState([]);
    const [summaryByAgent, setSummaryByAgent] = useState([]);
    const [expandedAgents, setExpandedAgents] = useState({});
    
    // Filters
    const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
    const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
    const [availableAgents, setAvailableAgents] = useState([]);
    const [selectedAgents, setSelectedAgents] = useState([]);
    
    // Stats
    const [totalCommission, setTotalCommission] = useState(0);
    const [totalTargetBonus, setTotalTargetBonus] = useState(0);
    const [totalShiftBonus, setTotalShiftBonus] = useState(0);
    const [totalEntries, setTotalEntries] = useState(0);

    // Bonus detail modal
    const [showBonusModal, setShowBonusModal] = useState(false);
    const [selectedAgentBonuses, setSelectedAgentBonuses] = useState([]);
    const [selectedAgentName, setSelectedAgentName] = useState("");

    const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';

    useEffect(() => {
        loadAvailableAgents();
    }, []);

    useEffect(() => {
        loadData();
    }, [dateFrom, dateTo, selectedAgents]);

    const loadAvailableAgents = async () => {
        try {
            const usersMap = await base44.entities.LinetUsersMap.list(null, 100);
            setAvailableAgents(usersMap.map(u => u.user_name));
        } catch (error) {
            console.error("Error loading agents:", error);
        }
    };

    const loadData = async () => {
        setIsLoading(true);
        try {
            // Load commission entries
            const entriesData = await base44.entities.CommissionEntry.filter({
                issue_date: { $gte: dateFrom, $lte: dateTo }
            }, '-issue_date', 5000);
            
            // Load bonuses
            const bonusesData = await base44.entities.BonusEntry.filter({
                period_start: { $lte: dateTo },
                period_end: { $gte: dateFrom }
            }, null, 500);

            // Filter by selected agents if any
            let filteredEntries = entriesData;
            let filteredBonuses = bonusesData;
            if (selectedAgents.length > 0) {
                filteredEntries = entriesData.filter(e => selectedAgents.includes(e.agent_name));
                filteredBonuses = bonusesData.filter(b => selectedAgents.includes(b.agent_name));
            }

            setEntries(filteredEntries);
            setBonuses(filteredBonuses);
            
            // Calculate summaries
            const agentSummary = {};
            let totalComm = 0;
            let totalTarget = 0;
            let totalShift = 0;

            // Process commission entries
            filteredEntries.forEach(entry => {
                const agent = entry.agent_name || 'Unknown';
                if (!agentSummary[agent]) {
                    agentSummary[agent] = {
                        agent_name: agent,
                        base_commission: 0,
                        target_bonus: 0,
                        shift_bonus: 0,
                        total: 0,
                        count: 0,
                        byRule: {},
                        bonuses: []
                    };
                }
                agentSummary[agent].base_commission += entry.commission_amount || 0;
                agentSummary[agent].count++;
                totalComm += entry.commission_amount || 0;

                // Group by rule
                const ruleName = entry.rule_name || 'Unknown';
                if (!agentSummary[agent].byRule[ruleName]) {
                    agentSummary[agent].byRule[ruleName] = {
                        rule_name: ruleName,
                        rule_type: entry.rule_type,
                        total: 0,
                        count: 0,
                        base_net: 0,
                        base_qty: 0
                    };
                }
                agentSummary[agent].byRule[ruleName].total += entry.commission_amount || 0;
                agentSummary[agent].byRule[ruleName].count++;
                agentSummary[agent].byRule[ruleName].base_net += entry.base_net_amount || 0;
                agentSummary[agent].byRule[ruleName].base_qty += entry.base_quantity || 0;
            });

            // Process bonuses
            filteredBonuses.forEach(bonus => {
                const agent = bonus.agent_name || 'Unknown';
                if (!agentSummary[agent]) {
                    agentSummary[agent] = {
                        agent_name: agent,
                        base_commission: 0,
                        target_bonus: 0,
                        shift_bonus: 0,
                        total: 0,
                        count: 0,
                        byRule: {},
                        bonuses: []
                    };
                }
                
                agentSummary[agent].bonuses.push(bonus);
                
                if (bonus.bonus_type === 'TARGET') {
                    agentSummary[agent].target_bonus += bonus.bonus_amount || 0;
                    totalTarget += bonus.bonus_amount || 0;
                } else if (bonus.bonus_type === 'SHIFT') {
                    agentSummary[agent].shift_bonus += bonus.bonus_amount || 0;
                    totalShift += bonus.bonus_amount || 0;
                }
            });

            // Calculate totals
            Object.values(agentSummary).forEach(agent => {
                agent.total = agent.base_commission + agent.target_bonus + agent.shift_bonus;
            });

            const summaryArray = Object.values(agentSummary).sort((a, b) => b.total - a.total);
            setSummaryByAgent(summaryArray);
            setTotalCommission(totalComm);
            setTotalTargetBonus(totalTarget);
            setTotalShiftBonus(totalShift);
            setTotalEntries(filteredEntries.length);

        } catch (error) {
            console.error("Error loading data:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCalculateAll = async () => {
        if (!confirm('לחשב עמלות ובונוסים מחדש לתקופה זו?')) return;
        
        setIsCalculating(true);
        try {
            // Calculate base commissions
            const commRes = await base44.functions.invoke('calculateCommissions', {
                date_from: dateFrom,
                date_to: dateTo,
                agent_ids: selectedAgents.length > 0 ? selectedAgents : null,
                recalculate: true
            });

            // Calculate goal progress first
            await base44.functions.invoke('calculateGoalProgress', { calculate_all: true });

            // Calculate bonuses
            const bonusRes = await base44.functions.invoke('calculateBonuses', {
                date_from: dateFrom,
                date_to: dateTo,
                calculate_targets: true,
                calculate_shifts: true
            });

            let msg = '✅ החישוב הושלם!\n\n';
            if (commRes.data.success) {
                msg += `עמלות בסיס: ${commRes.data.stats.entries} רשומות, ₪${commRes.data.stats.totalCommission?.toFixed(0) || 0}\n`;
            }
            if (bonusRes.data.success) {
                msg += `בונוס יעדים: ${bonusRes.data.summary.target_bonuses_created} רשומות, ₪${bonusRes.data.summary.total_target_amount?.toFixed(0) || 0}\n`;
                msg += `בונוס משמרות: ${bonusRes.data.summary.shift_bonuses_created} רשומות, ₪${bonusRes.data.summary.total_shift_amount?.toFixed(0) || 0}`;
            }

            alert(msg);
            loadData();
        } catch (error) {
            alert('❌ שגיאה: ' + error.message);
        } finally {
            setIsCalculating(false);
        }
    };

    const handleCalculateCommissions = async () => {
        setIsCalculating(true);
        try {
            const res = await base44.functions.invoke('calculateCommissions', {
                date_from: dateFrom,
                date_to: dateTo,
                agent_ids: selectedAgents.length > 0 ? selectedAgents : null,
                recalculate: true
            });
            if (res.data.success) {
                alert(`✅ עמלות בסיס חושבו: ${res.data.stats.entries} רשומות`);
                loadData();
            }
        } catch (error) {
            alert('❌ שגיאה: ' + error.message);
        } finally {
            setIsCalculating(false);
        }
    };

    const handleCalculateBonuses = async () => {
        setIsCalculating(true);
        try {
            await base44.functions.invoke('calculateGoalProgress', { calculate_all: true });
            const res = await base44.functions.invoke('calculateBonuses', {
                date_from: dateFrom,
                date_to: dateTo,
                calculate_targets: true,
                calculate_shifts: true
            });
            if (res.data.success) {
                alert(`✅ בונוסים חושבו:\nיעדים: ${res.data.summary.target_bonuses_created}\nמשמרות: ${res.data.summary.shift_bonuses_created}`);
                loadData();
            }
        } catch (error) {
            alert('❌ שגיאה: ' + error.message);
        } finally {
            setIsCalculating(false);
        }
    };

    const handleExportCSV = () => {
        if (summaryByAgent.length === 0) {
            alert('אין נתונים לייצוא');
            return;
        }

        let csv = 'נציג,עמלות בסיס,בונוס יעדים,בונוס משמרות,סה"כ\n';
        summaryByAgent.forEach(agent => {
            csv += `"${agent.agent_name}",${agent.base_commission.toFixed(2)},${agent.target_bonus.toFixed(2)},${agent.shift_bonus.toFixed(2)},${agent.total.toFixed(2)}\n`;
        });

        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `commissions_${dateFrom}_${dateTo}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const toggleAgentExpand = (agentName) => {
        setExpandedAgents(prev => ({ ...prev, [agentName]: !prev[agentName] }));
    };

    const openBonusDetails = (agent) => {
        setSelectedAgentName(agent.agent_name);
        setSelectedAgentBonuses(agent.bonuses);
        setShowBonusModal(true);
    };

    const handleDatePreset = (preset) => {
        const today = new Date();
        let from, to;
        switch (preset) {
            case 'thisMonth':
                from = startOfMonth(today);
                to = endOfMonth(today);
                break;
            case 'lastMonth':
                from = startOfMonth(subMonths(today, 1));
                to = endOfMonth(subMonths(today, 1));
                break;
            default: return;
        }
        setDateFrom(format(from, 'yyyy-MM-dd'));
        setDateTo(format(to, 'yyyy-MM-dd'));
    };

    if (!isManager) {
        return (
            <div className="p-6 text-center">
                <h1 className="text-2xl font-bold text-red-600">אין הרשאה</h1>
            </div>
        );
    }

    const grandTotal = totalCommission + totalTargetBonus + totalShiftBonus;

    return (
        <div className="p-4 md:p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
                        <Calculator className="w-8 h-8 text-green-600" />
                        חישוב עמלות ובונוסים
                    </h1>
                    <p className="text-gray-600 mt-1">עמלות בסיס + בונוס יעדים + בונוס משמרות</p>
                    <p className="text-xs text-gray-500 mt-1">
                        💡 עמלות בסיס מחושבות לפי מודלי העמלות. בונוס יעדים ומשמרות מוגדרים במסכים הייעודיים.
                    </p>
                </div>
                
                <div className="flex flex-wrap gap-2">
                    <Button onClick={handleExportCSV} variant="outline" disabled={summaryByAgent.length === 0}>
                        <Download className="w-4 h-4 ml-2" />
                        ייצוא
                    </Button>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline">
                                <Calculator className="w-4 h-4 ml-2" />
                                חשב...
                                <ChevronDown className="w-4 h-4 mr-2" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-48 p-2">
                            <Button onClick={handleCalculateCommissions} variant="ghost" className="w-full justify-start" disabled={isCalculating}>
                                <DollarSign className="w-4 h-4 ml-2" />
                                עמלות בסיס
                            </Button>
                            <Button onClick={handleCalculateBonuses} variant="ghost" className="w-full justify-start" disabled={isCalculating}>
                                <Gift className="w-4 h-4 ml-2" />
                                בונוסים
                            </Button>
                        </PopoverContent>
                    </Popover>
                    <Button onClick={handleCalculateAll} disabled={isCalculating} className="bg-green-600 hover:bg-green-700 text-white">
                        <RefreshCw className={`w-4 h-4 ml-2 ${isCalculating ? 'animate-spin' : ''}`} />
                        {isCalculating ? 'מחשב...' : 'חשב הכל'}
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <Card className="glass-card border-0">
                <CardContent className="p-4">
                    <div className="flex flex-wrap gap-4 items-end">
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleDatePreset('thisMonth')}>החודש</Button>
                            <Button variant="outline" size="sm" onClick={() => handleDatePreset('lastMonth')}>חודש שעבר</Button>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-700">מתאריך</label>
                            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-700">עד תאריך</label>
                            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-700">נציגים</label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-48 justify-between">
                                        <span className="truncate">{selectedAgents.length === 0 ? "כל הנציגים" : `${selectedAgents.length} נבחרו`}</span>
                                        <Filter className="w-4 h-4 mr-2" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-64 p-2 max-h-64 overflow-y-auto">
                                    <div className="flex justify-between items-center mb-2 pb-2 border-b">
                                        <span className="text-sm font-medium">בחר נציגים</span>
                                        {selectedAgents.length > 0 && <Button variant="ghost" size="sm" onClick={() => setSelectedAgents([])}>נקה</Button>}
                                    </div>
                                    {availableAgents.map(agent => (
                                        <div key={agent} className="flex items-center gap-2 p-1 hover:bg-gray-100 rounded cursor-pointer"
                                            onClick={() => setSelectedAgents(prev => prev.includes(agent) ? prev.filter(a => a !== agent) : [...prev, agent])}>
                                            <Checkbox checked={selectedAgents.includes(agent)} />
                                            <span className="text-sm">{agent}</span>
                                        </div>
                                    ))}
                                </PopoverContent>
                            </Popover>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Card className="border-0 shadow-lg bg-gradient-to-br from-green-600 to-green-500 text-white">
                    <CardContent className="p-4">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-green-100 text-xs font-medium mb-1">עמלות בסיס</p>
                                <h3 className="text-xl font-bold">₪{totalCommission.toLocaleString(undefined, { maximumFractionDigits: 0 })}</h3>
                            </div>
                            <DollarSign className="w-6 h-6 text-green-200" />
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-amber-600 to-amber-500 text-white">
                    <CardContent className="p-4">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-amber-100 text-xs font-medium mb-1">בונוס יעדים</p>
                                <h3 className="text-xl font-bold">₪{totalTargetBonus.toLocaleString(undefined, { maximumFractionDigits: 0 })}</h3>
                            </div>
                            <Target className="w-6 h-6 text-amber-200" />
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-600 to-blue-500 text-white">
                    <CardContent className="p-4">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-blue-100 text-xs font-medium mb-1">בונוס משמרות</p>
                                <h3 className="text-xl font-bold">₪{totalShiftBonus.toLocaleString(undefined, { maximumFractionDigits: 0 })}</h3>
                            </div>
                            <Calendar className="w-6 h-6 text-blue-200" />
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-purple-600 to-purple-500 text-white">
                    <CardContent className="p-4">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-purple-100 text-xs font-medium mb-1">סה"כ לתשלום</p>
                                <h3 className="text-xl font-bold">₪{grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</h3>
                            </div>
                            <TrendingUp className="w-6 h-6 text-purple-200" />
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-gray-600 to-gray-500 text-white">
                    <CardContent className="p-4">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-gray-100 text-xs font-medium mb-1">נציגים</p>
                                <h3 className="text-xl font-bold">{summaryByAgent.length}</h3>
                            </div>
                            <Users className="w-6 h-6 text-gray-200" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Agent Summary Table */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-green-600" />
                        סיכום לפי נציג
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="text-center py-12">
                            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                        </div>
                    ) : summaryByAgent.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <Calculator className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>אין נתונים לתקופה זו</p>
                            <p className="text-sm mt-2">לחץ "חשב הכל" לחישוב עמלות ובונוסים</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {summaryByAgent.map((agent) => (
                                <div key={agent.agent_name} className="border rounded-lg overflow-hidden">
                                    <div className="flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 cursor-pointer"
                                        onClick={() => toggleAgentExpand(agent.agent_name)}>
                                        <div className="flex items-center gap-4">
                                            {expandedAgents[agent.agent_name] ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                                            <div>
                                                <h3 className="font-bold text-lg">{agent.agent_name}</h3>
                                                <p className="text-sm text-gray-500">{agent.count} רשומות עמלה</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="text-right">
                                                <div className="flex gap-2 text-sm">
                                                    <span className="text-green-600">בסיס: ₪{agent.base_commission.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                                    {agent.target_bonus > 0 && <span className="text-amber-600">יעדים: ₪{agent.target_bonus.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
                                                    {agent.shift_bonus > 0 && <span className="text-blue-600">משמרות: ₪{agent.shift_bonus.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
                                                </div>
                                            </div>
                                            <p className="text-2xl font-bold text-purple-600">
                                                ₪{agent.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </p>
                                        </div>
                                    </div>

                                    {expandedAgents[agent.agent_name] && (
                                        <div className="p-4 bg-white border-t space-y-4">
                                            {/* Commission Rules */}
                                            <div>
                                                <h4 className="font-medium text-gray-700 mb-3">עמלות בסיס לפי חוק:</h4>
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead>חוק</TableHead>
                                                            <TableHead>סוג</TableHead>
                                                            <TableHead className="text-center">רשומות</TableHead>
                                                            <TableHead className="text-left">בסיס נטו</TableHead>
                                                            <TableHead className="text-left">בסיס כמות</TableHead>
                                                            <TableHead className="text-left">עמלה</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {Object.values(agent.byRule).map((rule, idx) => (
                                                            <TableRow key={idx}>
                                                                <TableCell className="font-medium">{rule.rule_name}</TableCell>
                                                                <TableCell><Badge variant="outline" className="text-xs">{rule.rule_type}</Badge></TableCell>
                                                                <TableCell className="text-center">{rule.count}</TableCell>
                                                                <TableCell className="text-left">{rule.base_net > 0 ? `₪${rule.base_net.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-'}</TableCell>
                                                                <TableCell className="text-left">{rule.base_qty > 0 ? rule.base_qty : '-'}</TableCell>
                                                                <TableCell className="text-left font-bold text-green-600">₪{rule.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </div>

                                            {/* Bonuses */}
                                            {agent.bonuses.length > 0 && (
                                                <div>
                                                    <div className="flex justify-between items-center mb-3">
                                                        <h4 className="font-medium text-gray-700">בונוסים:</h4>
                                                        <Button size="sm" variant="outline" onClick={() => openBonusDetails(agent)}>
                                                            פרטים מלאים
                                                        </Button>
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                        {agent.bonuses.map((bonus, idx) => (
                                                            <Badge key={idx} className={bonus.bonus_type === 'TARGET' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}>
                                                                {bonus.bonus_type === 'TARGET' ? '🎯' : '📅'} {bonus.goal_name || 'משמרות'}: ₪{bonus.bonus_amount}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Bonus Details Modal */}
            <Dialog open={showBonusModal} onOpenChange={setShowBonusModal}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>פירוט בונוסים - {selectedAgentName}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                        {selectedAgentBonuses.map((bonus, idx) => (
                            <div key={idx} className={`p-3 rounded-lg border ${bonus.bonus_type === 'TARGET' ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200'}`}>
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="font-bold">{bonus.bonus_type === 'TARGET' ? '🎯 בונוס יעד' : '📅 בונוס משמרות'}</p>
                                        {bonus.goal_name && <p className="text-sm text-gray-600">{bonus.goal_name}</p>}
                                        <p className="text-xs text-gray-500">{bonus.period_start} עד {bonus.period_end}</p>
                                    </div>
                                    <p className="text-xl font-bold">₪{bonus.bonus_amount}</p>
                                </div>
                                {bonus.meta_json && (
                                    <div className="mt-2 text-xs text-gray-600">
                                        {bonus.meta_json.shifts_count && <span>משמרות: {bonus.meta_json.shifts_count} × ₪{bonus.meta_json.bonus_per_shift}</span>}
                                        {bonus.meta_json.progress_percent && <span>התקדמות: {bonus.meta_json.progress_percent.toFixed(0)}%</span>}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}