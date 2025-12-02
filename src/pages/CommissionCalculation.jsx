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
import { 
    Calculator, RefreshCw, Download, Users, ChevronDown, ChevronUp, 
    Calendar, DollarSign, TrendingUp, Filter, FileSpreadsheet
} from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";

export default function CommissionCalculation() {
    const { currentUser } = useUser();
    const [isLoading, setIsLoading] = useState(false);
    const [isCalculating, setIsCalculating] = useState(false);
    const [entries, setEntries] = useState([]);
    const [summaryByAgent, setSummaryByAgent] = useState([]);
    const [expandedAgents, setExpandedAgents] = useState({});
    
    // Filters
    const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
    const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
    const [availableAgents, setAvailableAgents] = useState([]);
    const [selectedAgents, setSelectedAgents] = useState([]);
    
    // Stats
    const [totalCommission, setTotalCommission] = useState(0);
    const [totalEntries, setTotalEntries] = useState(0);

    const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';

    useEffect(() => {
        loadAvailableAgents();
    }, []);

    useEffect(() => {
        loadEntries();
    }, [dateFrom, dateTo, selectedAgents]);

    const loadAvailableAgents = async () => {
        try {
            // Get unique agents from LinetUsersMap
            const usersMap = await base44.entities.LinetUsersMap.list(null, 100);
            setAvailableAgents(usersMap.map(u => u.user_name));
        } catch (error) {
            console.error("Error loading agents:", error);
        }
    };

    const loadEntries = async () => {
        setIsLoading(true);
        try {
            let query = {
                issue_date: { $gte: dateFrom, $lte: dateTo }
            };

            const data = await base44.entities.CommissionEntry.filter(query, '-issue_date', 5000);
            
            // Filter by selected agents if any
            let filteredData = data;
            if (selectedAgents.length > 0) {
                filteredData = data.filter(e => selectedAgents.includes(e.agent_name));
            }

            setEntries(filteredData);
            
            // Calculate summaries
            const agentSummary = {};
            let total = 0;

            filteredData.forEach(entry => {
                const agent = entry.agent_name || 'Unknown';
                if (!agentSummary[agent]) {
                    agentSummary[agent] = {
                        agent_name: agent,
                        total: 0,
                        count: 0,
                        byRule: {}
                    };
                }
                agentSummary[agent].total += entry.commission_amount || 0;
                agentSummary[agent].count++;
                total += entry.commission_amount || 0;

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

            const summaryArray = Object.values(agentSummary).sort((a, b) => b.total - a.total);
            setSummaryByAgent(summaryArray);
            setTotalCommission(total);
            setTotalEntries(filteredData.length);

        } catch (error) {
            console.error("Error loading entries:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCalculate = async () => {
        if (!confirm('לחשב עמלות מחדש לתקופה זו? פעולה זו תמחק חישובים קודמים לתקופה.')) return;
        
        setIsCalculating(true);
        try {
            const res = await base44.functions.invoke('calculateCommissions', {
                date_from: dateFrom,
                date_to: dateTo,
                agent_ids: selectedAgents.length > 0 ? selectedAgents : null,
                recalculate: true
            });

            if (res.data.success) {
                alert(`✅ החישוב הושלם!\n\nנוצרו ${res.data.stats.entries} רשומות עמלה\nסה"כ עמלות: ₪${res.data.stats.totalCommission?.toFixed(2) || 0}`);
                loadEntries();
            } else {
                alert('❌ שגיאה בחישוב: ' + res.data.error);
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

        let csv = 'נציג,סה"כ עמלות,מספר רשומות\n';
        summaryByAgent.forEach(agent => {
            csv += `"${agent.agent_name}",${agent.total.toFixed(2)},${agent.count}\n`;
        });

        csv += `\n\nפירוט לפי חוק:\n`;
        csv += 'נציג,חוק,סוג,סה"כ עמלה,מספר רשומות,בסיס נטו,בסיס כמות\n';
        
        summaryByAgent.forEach(agent => {
            Object.values(agent.byRule).forEach(rule => {
                csv += `"${agent.agent_name}","${rule.rule_name}","${rule.rule_type}",${rule.total.toFixed(2)},${rule.count},${rule.base_net.toFixed(2)},${rule.base_qty}\n`;
            });
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
        setExpandedAgents(prev => ({
            ...prev,
            [agentName]: !prev[agentName]
        }));
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
            default:
                return;
        }

        setDateFrom(format(from, 'yyyy-MM-dd'));
        setDateTo(format(to, 'yyyy-MM-dd'));
    };

    if (!isManager) {
        return (
            <div className="p-6 text-center">
                <h1 className="text-2xl font-bold text-red-600">אין הרשאה</h1>
                <p className="text-gray-600 mt-2">עמוד זה מיועד למנהלים בלבד</p>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
                        <Calculator className="w-8 h-8 text-green-600" />
                        חישוב עמלות נציגים
                    </h1>
                    <p className="text-gray-600 mt-1">חישוב וסיכום עמלות לפי תקופה</p>
                </div>
                
                <div className="flex gap-2">
                    <Button 
                        onClick={handleExportCSV} 
                        variant="outline"
                        disabled={summaryByAgent.length === 0}
                    >
                        <Download className="w-4 h-4 ml-2" />
                        ייצוא CSV
                    </Button>
                    <Button 
                        onClick={handleCalculate} 
                        disabled={isCalculating}
                        className="bg-green-600 hover:bg-green-700 text-white"
                    >
                        <RefreshCw className={`w-4 h-4 ml-2 ${isCalculating ? 'animate-spin' : ''}`} />
                        {isCalculating ? 'מחשב...' : 'חשב עמלות'}
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <Card className="glass-card border-0">
                <CardContent className="p-4">
                    <div className="flex flex-wrap gap-4 items-end">
                        <div className="flex gap-2">
                            <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => handleDatePreset('thisMonth')}
                            >
                                החודש
                            </Button>
                            <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => handleDatePreset('lastMonth')}
                            >
                                חודש שעבר
                            </Button>
                        </div>
                        
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-700">מתאריך</label>
                            <Input 
                                type="date"
                                value={dateFrom}
                                onChange={(e) => setDateFrom(e.target.value)}
                                className="w-40"
                            />
                        </div>
                        
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-700">עד תאריך</label>
                            <Input 
                                type="date"
                                value={dateTo}
                                onChange={(e) => setDateTo(e.target.value)}
                                className="w-40"
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-700">נציגים</label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-48 justify-between">
                                        <span className="truncate">
                                            {selectedAgents.length === 0 
                                                ? "כל הנציגים" 
                                                : `${selectedAgents.length} נבחרו`}
                                        </span>
                                        <Filter className="w-4 h-4 mr-2" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-64 p-2 max-h-64 overflow-y-auto">
                                    <div className="flex justify-between items-center mb-2 pb-2 border-b">
                                        <span className="text-sm font-medium">בחר נציגים</span>
                                        {selectedAgents.length > 0 && (
                                            <Button 
                                                variant="ghost" 
                                                size="sm"
                                                onClick={() => setSelectedAgents([])}
                                            >
                                                נקה
                                            </Button>
                                        )}
                                    </div>
                                    {availableAgents.map(agent => (
                                        <div 
                                            key={agent} 
                                            className="flex items-center gap-2 p-1 hover:bg-gray-100 rounded cursor-pointer"
                                            onClick={() => {
                                                setSelectedAgents(prev => 
                                                    prev.includes(agent) 
                                                        ? prev.filter(a => a !== agent)
                                                        : [...prev, agent]
                                                );
                                            }}
                                        >
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="border-0 shadow-lg bg-gradient-to-br from-green-600 to-green-500 text-white">
                    <CardContent className="p-6">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-green-100 text-sm font-medium mb-1">סה"כ עמלות</p>
                                <h3 className="text-3xl font-bold">
                                    ₪{totalCommission.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </h3>
                            </div>
                            <DollarSign className="w-8 h-8 text-green-200" />
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-600 to-blue-500 text-white">
                    <CardContent className="p-6">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-blue-100 text-sm font-medium mb-1">רשומות עמלה</p>
                                <h3 className="text-3xl font-bold">{totalEntries.toLocaleString()}</h3>
                            </div>
                            <FileSpreadsheet className="w-8 h-8 text-blue-200" />
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-purple-600 to-purple-500 text-white">
                    <CardContent className="p-6">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-purple-100 text-sm font-medium mb-1">נציגים</p>
                                <h3 className="text-3xl font-bold">{summaryByAgent.length}</h3>
                            </div>
                            <Users className="w-8 h-8 text-purple-200" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Agent Summary Table */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-green-600" />
                        סיכום עמלות לפי נציג
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="text-center py-12">
                            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                            <p className="text-gray-500 mt-2">טוען נתונים...</p>
                        </div>
                    ) : summaryByAgent.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <Calculator className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>אין נתוני עמלות לתקופה זו</p>
                            <p className="text-sm mt-2">לחץ "חשב עמלות" כדי לחשב עמלות למכירות בתקופה</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {summaryByAgent.map((agent) => (
                                <div key={agent.agent_name} className="border rounded-lg overflow-hidden">
                                    {/* Agent Row */}
                                    <div 
                                        className="flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 cursor-pointer"
                                        onClick={() => toggleAgentExpand(agent.agent_name)}
                                    >
                                        <div className="flex items-center gap-4">
                                            {expandedAgents[agent.agent_name] ? (
                                                <ChevronUp className="w-5 h-5 text-gray-400" />
                                            ) : (
                                                <ChevronDown className="w-5 h-5 text-gray-400" />
                                            )}
                                            <div>
                                                <h3 className="font-bold text-lg">{agent.agent_name}</h3>
                                                <p className="text-sm text-gray-500">{agent.count} רשומות</p>
                                            </div>
                                        </div>
                                        <div className="text-left">
                                            <p className="text-2xl font-bold text-green-600">
                                                ₪{agent.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Expanded Details */}
                                    {expandedAgents[agent.agent_name] && (
                                        <div className="p-4 bg-white border-t">
                                            <h4 className="font-medium text-gray-700 mb-3">פירוט לפי חוק:</h4>
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>שם החוק</TableHead>
                                                        <TableHead>סוג</TableHead>
                                                        <TableHead className="text-center">רשומות</TableHead>
                                                        <TableHead className="text-left">בסיס נטו</TableHead>
                                                        <TableHead className="text-left">בסיס כמות</TableHead>
                                                        <TableHead className="text-left">סה"כ עמלה</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {Object.values(agent.byRule).map((rule, idx) => (
                                                        <TableRow key={idx}>
                                                            <TableCell className="font-medium">{rule.rule_name}</TableCell>
                                                            <TableCell>
                                                                <Badge variant="outline" className="text-xs">
                                                                    {rule.rule_type}
                                                                </Badge>
                                                            </TableCell>
                                                            <TableCell className="text-center">{rule.count}</TableCell>
                                                            <TableCell className="text-left">
                                                                {rule.base_net > 0 ? `₪${rule.base_net.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-'}
                                                            </TableCell>
                                                            <TableCell className="text-left">
                                                                {rule.base_qty > 0 ? rule.base_qty : '-'}
                                                            </TableCell>
                                                            <TableCell className="text-left font-bold text-green-600">
                                                                ₪{rule.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}