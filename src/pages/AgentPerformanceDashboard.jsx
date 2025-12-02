import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { 
    BarChart3, RefreshCw, Users, Filter, Smartphone, Radio, 
    ShoppingBag, TrendingUp, ChevronDown, Target, X
} from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid } from 'recharts';

export default function AgentPerformanceDashboard() {
    const { currentUser } = useUser();
    const [isLoading, setIsLoading] = useState(false);
    const [sales, setSales] = useState([]);
    const [mappings, setMappings] = useState([]);
    const [groups, setGroups] = useState([]);
    const [goals, setGoals] = useState([]);
    
    // Filters
    const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
    const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
    const [availableAgents, setAvailableAgents] = useState([]);
    const [selectedAgents, setSelectedAgents] = useState([]);
    
    // Chart metric selector
    const [chartMetric, setChartMetric] = useState("devices");
    
    // Drill-down
    const [selectedAgent, setSelectedAgent] = useState(null);
    const [showDrillDown, setShowDrillDown] = useState(false);

    const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';

    useEffect(() => {
        loadInitialData();
    }, []);

    useEffect(() => {
        if (mappings.length > 0) {
            loadSales();
        }
    }, [dateFrom, dateTo, selectedAgents, mappings]);

    const loadInitialData = async () => {
        setIsLoading(true);
        try {
            const [groupsData, mappingsData, goalsData, agentsData] = await Promise.all([
                base44.entities.CommissionGroup.filter({ is_active: true }),
                base44.entities.CommissionGroupMapping.filter({ is_active: true }),
                base44.entities.SalesGoal.filter({ is_active: true }),
                base44.entities.LinetUsersMap.list(null, 100)
            ]);
            setGroups(groupsData);
            setMappings(mappingsData);
            setGoals(goalsData);
            setAvailableAgents(agentsData.map(a => a.user_name));
        } catch (error) {
            console.error("Error loading initial data:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const loadSales = async () => {
        setIsLoading(true);
        try {
            let query = {
                issue_date: { $gte: dateFrom, $lte: dateTo }
            };
            
            const salesData = await base44.entities.SalesTransaction.filter(query, '-issue_date', 10000);
            
            // Filter by selected agents if any
            let filtered = salesData;
            if (selectedAgents.length > 0) {
                filtered = salesData.filter(s => selectedAgents.includes(s.sales_rep));
            }
            
            setSales(filtered);
        } catch (error) {
            console.error("Error loading sales:", error);
        } finally {
            setIsLoading(false);
        }
    };

    // Function to determine commission group for a sale
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

        if (filters.category && sale.category !== filters.category) {
            return false;
        }

        if (filters.product_name_contains) {
            if (!sale.product_name || !sale.product_name.includes(filters.product_name_contains)) {
                return false;
            }
        }

        return true;
    };

    // Calculate agent performance data
    const agentPerformance = useMemo(() => {
        const perfMap = {};

        sales.forEach(sale => {
            const agent = sale.sales_rep || 'Unknown';
            if (!perfMap[agent]) {
                perfMap[agent] = {
                    agent_name: agent,
                    devices_units: 0,
                    devices_net: 0,
                    lines_units: 0,
                    lines_4g_units: 0,
                    lines_5g_units: 0,
                    accessories_net: 0,
                    total_net: 0
                };
            }

            const groupCode = getCommissionGroup(sale);
            const qty = Math.abs(sale.quantity || 0);
            const net = sale.price_ex_vat || 0;

            perfMap[agent].total_net += net;

            if (groupCode === 'DEVICES') {
                perfMap[agent].devices_units += qty;
                perfMap[agent].devices_net += net;
            } else if (groupCode === 'LINES') {
                perfMap[agent].lines_units += qty;
                // Check for 4G/5G
                const productName = (sale.product_name || '').toLowerCase();
                if (productName.includes('5g')) {
                    perfMap[agent].lines_5g_units += qty;
                } else {
                    perfMap[agent].lines_4g_units += qty;
                }
            } else if (groupCode === 'ACCESSORIES_GROUP') {
                perfMap[agent].accessories_net += net;
            }
        });

        return Object.values(perfMap).sort((a, b) => b.total_net - a.total_net);
    }, [sales, mappings]);

    // KPI totals
    const totals = useMemo(() => {
        return agentPerformance.reduce((acc, agent) => ({
            devices: acc.devices + agent.devices_units,
            lines: acc.lines + agent.lines_units,
            accessories: acc.accessories + agent.accessories_net,
            total: acc.total + agent.total_net
        }), { devices: 0, lines: 0, accessories: 0, total: 0 });
    }, [agentPerformance]);

    // Chart data
    const chartData = useMemo(() => {
        return agentPerformance.slice(0, 10).map(agent => ({
            name: agent.agent_name,
            value: chartMetric === 'devices' ? agent.devices_units :
                   chartMetric === 'lines' ? agent.lines_units :
                   agent.accessories_net
        }));
    }, [agentPerformance, chartMetric]);

    // Get goal progress for an agent
    const getGoalProgress = (agentName, metricType) => {
        const agentGoals = goals.filter(g => 
            g.agent_name === agentName && 
            g.metric_type === metricType &&
            g.period_start <= dateTo && 
            g.period_end >= dateFrom
        );
        
        if (agentGoals.length === 0) return null;

        const goal = agentGoals[0];
        const agentData = agentPerformance.find(a => a.agent_name === agentName);
        if (!agentData) return null;

        let actual = 0;
        switch (metricType) {
            case 'DEVICES_UNITS': actual = agentData.devices_units; break;
            case 'LINES_UNITS': actual = agentData.lines_units; break;
            case 'LINES_4G_UNITS': actual = agentData.lines_4g_units; break;
            case 'LINES_5G_UNITS': actual = agentData.lines_5g_units; break;
            case 'ACCESSORIES_NET': actual = agentData.accessories_net; break;
        }

        const progress = goal.target_value > 0 ? (actual / goal.target_value) * 100 : 0;
        return { goal, actual, progress: Math.min(progress, 100), target: goal.target_value };
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

    const openDrillDown = (agent) => {
        setSelectedAgent(agent);
        setShowDrillDown(true);
    };

    // Drill-down sales for selected agent
    const drillDownSales = useMemo(() => {
        if (!selectedAgent) return [];
        return sales
            .filter(s => s.sales_rep === selectedAgent.agent_name)
            .map(s => ({ ...s, commission_group_code: getCommissionGroup(s) }));
    }, [selectedAgent, sales, mappings]);

    return (
        <div className="p-4 md:p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
                        <BarChart3 className="w-8 h-8 text-indigo-600" />
                        ביצועי נציגים לפי קבוצות
                    </h1>
                    <p className="text-gray-600 mt-1">מכשירים, קווים ואביזרים</p>
                </div>
                <Button onClick={loadSales} disabled={isLoading} variant="outline">
                    <RefreshCw className={`w-4 h-4 ml-2 ${isLoading ? 'animate-spin' : ''}`} />
                    רענן
                </Button>
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
                                        <span className="truncate">
                                            {selectedAgents.length === 0 ? "כל הנציגים" : `${selectedAgents.length} נבחרו`}
                                        </span>
                                        <Filter className="w-4 h-4 mr-2" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-64 p-2 max-h-64 overflow-y-auto">
                                    <div className="flex justify-between items-center mb-2 pb-2 border-b">
                                        <span className="text-sm font-medium">בחר נציגים</span>
                                        {selectedAgents.length > 0 && (
                                            <Button variant="ghost" size="sm" onClick={() => setSelectedAgents([])}>נקה</Button>
                                        )}
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

            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-600 to-blue-500 text-white">
                    <CardContent className="p-6">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-blue-100 text-sm font-medium mb-1">מכשירים</p>
                                <h3 className="text-3xl font-bold">{totals.devices.toLocaleString()}</h3>
                            </div>
                            <Smartphone className="w-8 h-8 text-blue-200" />
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-green-600 to-green-500 text-white">
                    <CardContent className="p-6">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-green-100 text-sm font-medium mb-1">קווים</p>
                                <h3 className="text-3xl font-bold">{totals.lines.toLocaleString()}</h3>
                            </div>
                            <Radio className="w-8 h-8 text-green-200" />
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-purple-600 to-purple-500 text-white">
                    <CardContent className="p-6">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-purple-100 text-sm font-medium mb-1">אביזרים (נטו)</p>
                                <h3 className="text-3xl font-bold">₪{totals.accessories.toLocaleString(undefined, { maximumFractionDigits: 0 })}</h3>
                            </div>
                            <ShoppingBag className="w-8 h-8 text-purple-200" />
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-orange-600 to-orange-500 text-white">
                    <CardContent className="p-6">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-orange-100 text-sm font-medium mb-1">סה"כ נטו</p>
                                <h3 className="text-3xl font-bold">₪{totals.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</h3>
                            </div>
                            <TrendingUp className="w-8 h-8 text-orange-200" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Chart */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <CardTitle className="flex items-center gap-2">
                            <BarChart3 className="w-5 h-5 text-indigo-600" />
                            השוואת נציגים
                        </CardTitle>
                        <Select value={chartMetric} onValueChange={setChartMetric}>
                            <SelectTrigger className="w-40">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="devices">מכשירים</SelectItem>
                                <SelectItem value="lines">קווים</SelectItem>
                                <SelectItem value="accessories">אביזרים (נטו)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="name" fontSize={12} />
                                <YAxis fontSize={12} />
                                <RechartsTooltip 
                                    formatter={(value) => chartMetric === 'accessories' ? `₪${value.toLocaleString()}` : value}
                                />
                                <Bar 
                                    dataKey="value" 
                                    fill={chartMetric === 'devices' ? '#3B82F6' : chartMetric === 'lines' ? '#10B981' : '#8B5CF6'} 
                                    radius={[4, 4, 0, 0]} 
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            {/* Agent Performance Table */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-indigo-600" />
                        סיכום לפי נציג
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="text-center py-12">
                            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                        </div>
                    ) : agentPerformance.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>אין נתונים לתקופה זו</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>נציג</TableHead>
                                        <TableHead className="text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <Smartphone className="w-4 h-4" /> מכשירים
                                            </div>
                                        </TableHead>
                                        <TableHead className="text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <Radio className="w-4 h-4" /> קווים
                                            </div>
                                        </TableHead>
                                        <TableHead className="text-center">4G</TableHead>
                                        <TableHead className="text-center">5G</TableHead>
                                        <TableHead className="text-left">
                                            <div className="flex items-center gap-1">
                                                <ShoppingBag className="w-4 h-4" /> אביזרים
                                            </div>
                                        </TableHead>
                                        <TableHead className="text-left font-bold">סה"כ נטו</TableHead>
                                        <TableHead>יעד</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {agentPerformance.map((agent) => {
                                        const deviceGoal = getGoalProgress(agent.agent_name, 'DEVICES_UNITS');
                                        return (
                                            <TableRow 
                                                key={agent.agent_name} 
                                                className="cursor-pointer hover:bg-blue-50"
                                                onClick={() => openDrillDown(agent)}
                                            >
                                                <TableCell className="font-medium">{agent.agent_name}</TableCell>
                                                <TableCell className="text-center font-bold text-blue-600">{agent.devices_units}</TableCell>
                                                <TableCell className="text-center font-bold text-green-600">{agent.lines_units}</TableCell>
                                                <TableCell className="text-center text-gray-600">{agent.lines_4g_units}</TableCell>
                                                <TableCell className="text-center text-gray-600">{agent.lines_5g_units}</TableCell>
                                                <TableCell className="text-left text-purple-600">₪{agent.accessories_net.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                                                <TableCell className="text-left font-bold">₪{agent.total_net.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                                                <TableCell>
                                                    {deviceGoal && (
                                                        <div className="w-24">
                                                            <div className="flex justify-between text-xs mb-1">
                                                                <span>{deviceGoal.actual}/{deviceGoal.target}</span>
                                                                <span>{deviceGoal.progress.toFixed(0)}%</span>
                                                            </div>
                                                            <Progress value={deviceGoal.progress} className="h-2" />
                                                        </div>
                                                    )}
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

            {/* Drill-down Dialog */}
            <Dialog open={showDrillDown} onOpenChange={setShowDrillDown}>
                <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Users className="w-5 h-5" />
                            פירוט מכירות - {selectedAgent?.agent_name}
                        </DialogTitle>
                    </DialogHeader>
                    
                    {selectedAgent && (
                        <div className="space-y-4">
                            {/* Summary */}
                            <div className="grid grid-cols-4 gap-3">
                                <div className="bg-blue-50 p-3 rounded-lg text-center">
                                    <p className="text-xs text-gray-600">מכשירים</p>
                                    <p className="text-xl font-bold text-blue-600">{selectedAgent.devices_units}</p>
                                </div>
                                <div className="bg-green-50 p-3 rounded-lg text-center">
                                    <p className="text-xs text-gray-600">קווים</p>
                                    <p className="text-xl font-bold text-green-600">{selectedAgent.lines_units}</p>
                                </div>
                                <div className="bg-purple-50 p-3 rounded-lg text-center">
                                    <p className="text-xs text-gray-600">אביזרים</p>
                                    <p className="text-xl font-bold text-purple-600">₪{selectedAgent.accessories_net.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                                </div>
                                <div className="bg-orange-50 p-3 rounded-lg text-center">
                                    <p className="text-xs text-gray-600">סה"כ</p>
                                    <p className="text-xl font-bold text-orange-600">₪{selectedAgent.total_net.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                                </div>
                            </div>

                            {/* Sales Table */}
                            <div className="border rounded-lg overflow-hidden">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>תאריך</TableHead>
                                            <TableHead>מוצר</TableHead>
                                            <TableHead>קטגוריה</TableHead>
                                            <TableHead>קבוצה</TableHead>
                                            <TableHead className="text-center">כמות</TableHead>
                                            <TableHead className="text-left">נטו</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {drillDownSales.slice(0, 50).map((sale) => (
                                            <TableRow key={sale.id}>
                                                <TableCell className="text-sm">{sale.issue_date}</TableCell>
                                                <TableCell className="text-sm max-w-[200px] truncate">{sale.product_name}</TableCell>
                                                <TableCell><Badge variant="outline" className="text-xs">{sale.category}</Badge></TableCell>
                                                <TableCell>
                                                    {sale.commission_group_code ? (
                                                        <Badge className={
                                                            sale.commission_group_code === 'DEVICES' ? 'bg-blue-100 text-blue-800' :
                                                            sale.commission_group_code === 'LINES' ? 'bg-green-100 text-green-800' :
                                                            'bg-purple-100 text-purple-800'
                                                        }>
                                                            {sale.commission_group_code}
                                                        </Badge>
                                                    ) : '-'}
                                                </TableCell>
                                                <TableCell className="text-center font-medium">{sale.quantity}</TableCell>
                                                <TableCell className="text-left">₪{(sale.price_ex_vat || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                            {drillDownSales.length > 50 && (
                                <p className="text-sm text-gray-500 text-center">מציג 50 מתוך {drillDownSales.length} שורות</p>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}