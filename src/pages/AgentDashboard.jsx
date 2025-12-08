import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
    TrendingUp, Smartphone, Radio, ShoppingBag, Award, 
    Trophy, Calendar, RefreshCw, Target, Zap
} from "lucide-react";
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid, Legend } from 'recharts';
import SalesDrilldown from "../components/drilldown/SalesDrilldown";

export default function AgentDashboard() {
    const { currentUser } = useUser();
    const [isLoading, setIsLoading] = useState(false);
    const [sales, setSales] = useState([]);
    const [commissions, setCommissions] = useState([]);
    const [bonuses, setBonuses] = useState([]);
    const [goals, setGoals] = useState([]);
    const [progress, setProgress] = useState({});
    const [mappings, setMappings] = useState([]);
    
    // Filters
    const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
    const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
    const [selectedAgent, setSelectedAgent] = useState(null);
    
    // Drilldown
    const [showDrillDown, setShowDrillDown] = useState(false);
    const [drilldownGroupCode, setDrilldownGroupCode] = useState(null);
    const [drilldownTitle, setDrilldownTitle] = useState('');
    
    const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';
    const currentAgentName = currentUser?.employee_name;

    useEffect(() => {
        loadInitialData();
    }, []);

    useEffect(() => {
        if (mappings.length > 0) {
            loadData();
        }
    }, [dateFrom, dateTo, mappings]);

    const loadInitialData = async () => {
        setIsLoading(true);
        try {
            const [mappingsData, goalsData] = await Promise.all([
                base44.entities.CommissionGroupMapping.filter({ is_active: true }),
                base44.entities.GoalDefinition.filter({ is_active: true })
            ]);
            setMappings(mappingsData);
            setGoals(goalsData);
        } catch (error) {
            console.error("Error loading initial data:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [salesData, commissionsData, bonusesData, progressData] = await Promise.all([
                base44.entities.SalesTransaction.filter({
                    issue_date: { $gte: dateFrom, $lte: dateTo }
                }, '-issue_date', 10000),
                base44.entities.CommissionEntry.filter({
                    issue_date: { $gte: dateFrom, $lte: dateTo }
                }),
                base44.entities.BonusEntry.filter({
                    period_start: { $lte: dateTo },
                    period_end: { $gte: dateFrom }
                }),
                base44.entities.GoalProgress.list(null, 500)
            ]);
            
            setSales(salesData);
            setCommissions(commissionsData);
            setBonuses(bonusesData);
            
            const progressMap = {};
            progressData.forEach(p => { progressMap[p.goal_id] = p; });
            setProgress(progressMap);
        } catch (error) {
            console.error("Error loading data:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const getCommissionGroup = (sale) => {
        for (const mapping of mappings.sort((a, b) => (b.priority || 0) - (a.priority || 0))) {
            if (checkFilters(sale, mapping.filters_json)) {
                return mapping.commission_group_code;
            }
        }
        return null;
    };

    const checkFilters = (sale, filters) => {
        if (!filters) return false;
        if (filters.category_in && filters.category_in.length > 0) {
            if (!filters.category_in.includes(sale.category)) return false;
        }
        if (filters.category && sale.category !== filters.category) return false;
        if (filters.product_name_contains) {
            if (!sale.product_name || !sale.product_name.includes(filters.product_name_contains)) return false;
        }
        return true;
    };

    // Calculate agent performance
    const agentPerformance = useMemo(() => {
        const uniqueSales = [];
        const seenKeys = new Set();
        
        for (const sale of sales) {
            const uniqueKey = `${sale.doc_number || ''}_${sale.sku || ''}_${sale.product_name || ''}`;
            if (!seenKeys.has(uniqueKey)) {
                seenKeys.add(uniqueKey);
                uniqueSales.push(sale);
            }
        }
        
        const perfMap = {};

        uniqueSales.forEach(sale => {
            const agent = sale.sales_rep || 'Unknown';
            if (!perfMap[agent]) {
                perfMap[agent] = {
                    agent_name: agent,
                    devices_units: 0,
                    lines_units: 0,
                    lines_4g_units: 0,
                    lines_5g_units: 0,
                    accessories_net: 0,
                    accessories_units: 0
                };
            }

            const groupCode = getCommissionGroup(sale);
            const qty = Math.abs(sale.quantity || 0);
            const net = sale.price_ex_vat || 0;

            if (groupCode === 'DEVICES') {
                perfMap[agent].devices_units += qty;
            } else if (groupCode === 'LINES') {
                perfMap[agent].lines_units += qty;
                const productName = (sale.product_name || '').toLowerCase();
                if (productName.includes('5g')) {
                    perfMap[agent].lines_5g_units += qty;
                } else {
                    perfMap[agent].lines_4g_units += qty;
                }
            } else if (groupCode === 'ACCESSORIES_GROUP') {
                perfMap[agent].accessories_net += net;
                perfMap[agent].accessories_units += qty;
            }
        });

        return Object.values(perfMap);
    }, [sales, mappings]);

    // Current agent data
    const currentAgentData = useMemo(() => {
        const agent = agentPerformance.find(a => a.agent_name === currentAgentName);
        if (!agent) return null;

        const agentCommissions = commissions.filter(c => c.agent_name === currentAgentName);
        const agentBonuses = bonuses.filter(b => b.agent_name === currentAgentName);
        
        const totalCommissions = agentCommissions.reduce((sum, c) => sum + (c.commission_amount || 0), 0);
        const totalBonuses = agentBonuses.reduce((sum, b) => sum + (b.bonus_amount || 0), 0);
        
        return {
            ...agent,
            total_commissions: totalCommissions,
            total_bonuses: totalBonuses,
            total_earnings: totalCommissions + totalBonuses,
            accessories_per_device: agent.devices_units > 0 ? (agent.accessories_net / agent.devices_units) : 0
        };
    }, [agentPerformance, commissions, bonuses, currentAgentName]);

    // Agent goals
    const agentGoals = useMemo(() => {
        return goals.filter(g => 
            g.agent_name === currentAgentName &&
            g.period_start <= dateTo && 
            g.period_end >= dateFrom
        );
    }, [goals, currentAgentName, dateFrom, dateTo]);

    // Team sorted by total earnings
    const teamSorted = useMemo(() => {
        return agentPerformance.map(agent => {
            const agentCommissions = commissions.filter(c => c.agent_name === agent.agent_name);
            const agentBonuses = bonuses.filter(b => b.agent_name === agent.agent_name);
            
            const totalCommissions = agentCommissions.reduce((sum, c) => sum + (c.commission_amount || 0), 0);
            const totalBonuses = agentBonuses.reduce((sum, b) => sum + (b.bonus_amount || 0), 0);
            
            return {
                ...agent,
                total_earnings: totalCommissions + totalBonuses,
                accessories_per_device: agent.devices_units > 0 ? (agent.accessories_net / agent.devices_units) : 0
            };
        }).sort((a, b) => b.total_earnings - a.total_earnings);
    }, [agentPerformance, commissions, bonuses]);

    // Daily trend data
    const dailyTrend = useMemo(() => {
        const dailyMap = {};
        
        sales.forEach(sale => {
            if (!sale.issue_date) return;
            const date = sale.issue_date;
            if (!dailyMap[date]) {
                dailyMap[date] = { date, devices: 0, lines: 0, accessories: 0 };
            }
            
            if (sale.sales_rep === currentAgentName) {
                const groupCode = getCommissionGroup(sale);
                const qty = Math.abs(sale.quantity || 0);
                const net = sale.price_ex_vat || 0;
                
                if (groupCode === 'DEVICES') dailyMap[date].devices += qty;
                else if (groupCode === 'LINES') dailyMap[date].lines += qty;
                else if (groupCode === 'ACCESSORIES_GROUP') dailyMap[date].accessories += net;
            }
        });
        
        return Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
    }, [sales, currentAgentName, mappings]);

    const handleDatePreset = (preset) => {
        const today = new Date();
        let from, to;
        switch (preset) {
            case 'today':
                from = startOfDay(today);
                to = endOfDay(today);
                break;
            case 'thisWeek':
                from = startOfWeek(today, { weekStartsOn: 0 });
                to = endOfWeek(today, { weekStartsOn: 0 });
                break;
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

    const getGoalProgress = (metricType, groupCode) => {
        const goal = agentGoals.find(g => 
            g.metric_type === metricType && 
            g.commission_group_code === groupCode
        );
        if (!goal) return null;

        const prog = progress[goal.id];
        if (!prog) return { goal, actual: 0, progress: 0, target: goal.target_value };

        return {
            goal,
            actual: prog.current_value,
            progress: Math.min(prog.progress_percent, 100),
            target: goal.target_value
        };
    };

    const openDrillDown = (groupCode, metricLabel) => {
        setDrilldownGroupCode(groupCode);
        setDrilldownTitle(`${metricLabel} - ${currentAgentName}`);
        setShowDrillDown(true);
    };

    return (
        <div className="p-4 md:p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
                        <Trophy className="w-8 h-8 text-amber-600" />
                        הדשבורד שלי
                    </h1>
                    <p className="text-gray-600 mt-1">ביצועים, יעדים והשוואה מול הצוות</p>
                </div>
                <Button onClick={loadData} disabled={isLoading} variant="outline">
                    <RefreshCw className={`w-4 h-4 ml-2 ${isLoading ? 'animate-spin' : ''}`} />
                    רענן
                </Button>
            </div>

            {/* Date Filters */}
            <Card className="glass-card border-0">
                <CardContent className="p-4">
                    <div className="flex flex-wrap gap-3 items-end">
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleDatePreset('today')}>היום</Button>
                            <Button variant="outline" size="sm" onClick={() => handleDatePreset('thisWeek')}>השבוע</Button>
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
                    </div>
                </CardContent>
            </Card>

            {/* Personal Card */}
            {currentAgentData && (
                <Card className="border-0 shadow-xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-white">
                            <Award className="w-6 h-6" />
                            הביצועים שלי - {currentAgentName}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Metrics Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div 
                                className="bg-white/10 backdrop-blur-sm p-4 rounded-lg cursor-pointer hover:bg-white/20 transition-all"
                                onClick={() => openDrillDown('DEVICES', 'מכשירים')}
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <Smartphone className="w-5 h-5" />
                                    <span className="text-sm font-medium">מכשירים</span>
                                </div>
                                <p className="text-3xl font-bold">{currentAgentData.devices_units}</p>
                            </div>
                            <div 
                                className="bg-white/10 backdrop-blur-sm p-4 rounded-lg cursor-pointer hover:bg-white/20 transition-all"
                                onClick={() => openDrillDown('LINES', 'קווים')}
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <Radio className="w-5 h-5" />
                                    <span className="text-sm font-medium">קווים</span>
                                </div>
                                <p className="text-3xl font-bold">{currentAgentData.lines_units}</p>
                                <p className="text-xs opacity-80 mt-1">4G: {currentAgentData.lines_4g_units} | 5G: {currentAgentData.lines_5g_units}</p>
                            </div>
                            <div 
                                className="bg-white/10 backdrop-blur-sm p-4 rounded-lg cursor-pointer hover:bg-white/20 transition-all"
                                onClick={() => openDrillDown('ACCESSORIES_GROUP', 'אביזרים')}
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <ShoppingBag className="w-5 h-5" />
                                    <span className="text-sm font-medium">אביזרים (נטו)</span>
                                </div>
                                <p className="text-3xl font-bold">₪{currentAgentData.accessories_net.toLocaleString(undefined, {maximumFractionDigits: 0})}</p>
                            </div>
                        </div>

                        {/* Ratio & Earnings */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-white/20">
                            <div className="bg-white/10 backdrop-blur-sm p-4 rounded-lg">
                                <p className="text-sm opacity-80 mb-1">יחס אביזרים למכשיר</p>
                                <p className="text-2xl font-bold">₪{currentAgentData.accessories_per_device.toLocaleString(undefined, {maximumFractionDigits: 0})}</p>
                            </div>
                            <div className="bg-white/10 backdrop-blur-sm p-4 rounded-lg">
                                <p className="text-sm opacity-80 mb-1">עמלות בסיס</p>
                                <p className="text-2xl font-bold">₪{currentAgentData.total_commissions.toLocaleString(undefined, {maximumFractionDigits: 0})}</p>
                            </div>
                            <div className="bg-white/10 backdrop-blur-sm p-4 rounded-lg">
                                <p className="text-sm opacity-80 mb-1">בונוסים</p>
                                <p className="text-2xl font-bold">₪{currentAgentData.total_bonuses.toLocaleString(undefined, {maximumFractionDigits: 0})}</p>
                            </div>
                        </div>

                        {/* Total Earnings */}
                        <div className="bg-white/20 backdrop-blur-sm p-4 rounded-lg">
                            <p className="text-sm opacity-90 mb-1">סה"כ עמלות לתקופה</p>
                            <p className="text-4xl font-bold">₪{currentAgentData.total_earnings.toLocaleString(undefined, {maximumFractionDigits: 0})}</p>
                        </div>

                        {/* Goals Progress */}
                        {agentGoals.length > 0 && (
                            <div className="space-y-3 pt-4 border-t border-white/20">
                                <h3 className="text-lg font-semibold flex items-center gap-2">
                                    <Target className="w-5 h-5" />
                                    היעדים שלי
                                </h3>
                                {['DEVICES', 'LINES', 'ACCESSORIES_GROUP'].map(groupCode => {
                                    const goalData = getGoalProgress('UNITS', groupCode) || getGoalProgress('NET_AMOUNT', groupCode);
                                    if (!goalData) return null;
                                    
                                    const progressColor = goalData.progress >= 100 ? 'bg-green-500' : goalData.progress >= 70 ? 'bg-amber-500' : 'bg-red-500';
                                    const groupLabel = groupCode === 'DEVICES' ? 'מכשירים' : groupCode === 'LINES' ? 'קווים' : 'אביזרים';
                                    
                                    return (
                                        <div key={groupCode} className="bg-white/10 backdrop-blur-sm p-3 rounded-lg">
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-sm font-medium">{groupLabel}</span>
                                                <span className="text-sm">
                                                    {goalData.actual} / {goalData.target} ({goalData.progress.toFixed(0)}%)
                                                </span>
                                            </div>
                                            <Progress value={goalData.progress} className={`h-2 [&>div]:${progressColor}`} />
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Team Comparison Table */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-indigo-600" />
                        השוואת ביצועים - כל הצוות
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="text-center py-12">
                            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                        </div>
                    ) : teamSorted.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>אין נתונים לתקופה זו</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-12">#</TableHead>
                                        <TableHead>נציג</TableHead>
                                        <TableHead className="text-center">מכשירים</TableHead>
                                        <TableHead className="text-center">קווים</TableHead>
                                        <TableHead className="text-left">אביזרים</TableHead>
                                        <TableHead className="text-center">יחס א׳/מ׳</TableHead>
                                        <TableHead className="text-left font-bold">סה״כ עמלות</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {teamSorted.map((agent, idx) => (
                                        <TableRow 
                                            key={agent.agent_name} 
                                            className={`hover:bg-gray-50 ${agent.agent_name === currentAgentName ? 'bg-blue-50 border-2 border-blue-400' : ''}`}
                                        >
                                            <TableCell>
                                                {idx === 0 && <Trophy className="w-5 h-5 text-amber-500" />}
                                                {idx === 1 && <Trophy className="w-5 h-5 text-gray-400" />}
                                                {idx === 2 && <Trophy className="w-5 h-5 text-orange-600" />}
                                                {idx > 2 && <span className="text-gray-500">{idx + 1}</span>}
                                            </TableCell>
                                            <TableCell className="font-medium">
                                                {agent.agent_name}
                                                {agent.agent_name === currentAgentName && (
                                                    <Badge className="mr-2 bg-blue-500 text-white">אני</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-center font-bold text-blue-600">{agent.devices_units}</TableCell>
                                            <TableCell className="text-center font-bold text-green-600">{agent.lines_units}</TableCell>
                                            <TableCell className="text-left text-purple-600 font-bold">
                                                ₪{agent.accessories_net.toLocaleString(undefined, {maximumFractionDigits: 0})}
                                            </TableCell>
                                            <TableCell className="text-center text-gray-600">
                                                ₪{agent.accessories_per_device.toLocaleString(undefined, {maximumFractionDigits: 0})}
                                            </TableCell>
                                            <TableCell className="text-left font-bold text-lg">
                                                ₪{agent.total_earnings.toLocaleString(undefined, {maximumFractionDigits: 0})}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Daily Trend Chart */}
            {dailyTrend.length > 0 && (
                <Card className="glass-card border-0">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Zap className="w-5 h-5 text-amber-600" />
                            מגמת ביצועים יומית
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={dailyTrend}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="date" fontSize={12} />
                                    <YAxis fontSize={12} />
                                    <RechartsTooltip />
                                    <Legend />
                                    <Line type="monotone" dataKey="devices" stroke="#3B82F6" strokeWidth={2} name="מכשירים" />
                                    <Line type="monotone" dataKey="lines" stroke="#10B981" strokeWidth={2} name="קווים" />
                                    <Line type="monotone" dataKey="accessories" stroke="#8B5CF6" strokeWidth={2} name="אביזרים (₪)" />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Drilldown Modal */}
            {showDrillDown && (
                <SalesDrilldown
                    isOpen={showDrillDown}
                    onClose={() => setShowDrillDown(false)}
                    title={drilldownTitle}
                    agentName={currentAgentName}
                    filters={{ sales_rep: currentAgentName }}
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    groupCode={drilldownGroupCode}
                    mappings={mappings}
                />
            )}
        </div>
    );
}