import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3, Calendar, ArrowUpRight, RefreshCw, Settings, PieChart as PieIcon, Users } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths, isSameDay, parseISO } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#8dd1e1', '#a4de6c', '#d0ed57'];

export default function SalesDashboard() {
    const { currentUser } = useUser();
    const [transactions, setTransactions] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [dateRange, setDateRange] = useState({
        from: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
        to: format(endOfMonth(new Date()), 'yyyy-MM-dd')
    });
    const [stats, setStats] = useState({
        totalSales: 0,
        count: 0,
        avgSale: 0
    });
    const [categoriesData, setCategoriesData] = useState([]);
    const [dailyData, setDailyData] = useState([]);
    const [salesByRepData, setSalesByRepData] = useState([]);
    const [selectedRep, setSelectedRep] = useState("all");
    const [availableReps, setAvailableReps] = useState([]);

    const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';

    const loadData = async () => {
        setIsLoading(true);
        try {
            let query = {};
            
            // Date Filter
            if (dateRange.from && dateRange.to) {
                query.issue_date = {
                    $gte: dateRange.from,
                    $lte: dateRange.to
                };
            }

            // User Filter
            if (!isManager) {
                const possibleNames = [currentUser.employee_name];
                if (currentUser.linet_employee_code) {
                    possibleNames.push(currentUser.linet_employee_code);
                    try {
                        const maps = await base44.entities.LinetUsersMap.filter({ user_id: currentUser.linet_employee_code });
                        if (maps.length > 0) {
                            possibleNames.push(maps[0].user_name);
                        }
                    } catch (e) { console.error(e); }
                }
                query.sales_rep = { $in: possibleNames };
            } else if (selectedRep !== "all") {
                // Manager filtering by specific rep
                query.sales_rep = selectedRep;
            }

            console.log("Fetching sales with query:", query);
            const data = await base44.entities.SalesTransaction.filter(query, '-issue_date', 2000);
            
            setTransactions(data);
            calculateStats(data);
        } catch (error) {
            console.error("Error loading sales data:", error);
            setTransactions([]);
        } finally {
            setIsLoading(false);
        }
    };

    const calculateStats = (data) => {
        const total = data.reduce((sum, tx) => sum + (tx.total_row_amount || 0), 0);
        const count = data.length;
        setStats({
            totalSales: total,
            count: count,
            avgSale: count > 0 ? total / count : 0
        });

        // Category Breakdown
        const catMap = {};
        data.forEach(tx => {
            const cat = tx.category || 'אחר';
            catMap[cat] = (catMap[cat] || 0) + (tx.total_row_amount || 0);
        });
        
        const catData = Object.entries(catMap)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);
        
        setCategoriesData(catData);

        // Daily Breakdown
        const dayMap = {};
        data.forEach(tx => {
            const day = tx.issue_date ? format(new Date(tx.issue_date), 'dd/MM') : 'Unknown';
            dayMap[day] = (dayMap[day] || 0) + (tx.total_row_amount || 0);
        });

        const dayData = Object.entries(dayMap)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => { // sort by date simple hack: assuming same month/year roughly or iso
                 return 0; // keeping order of keys if possible or rely on API sort
            }); 
            // Better sort if we parse dates, but simplified for now as API returns sorted desc
        
        // Since API returns desc, reverse for chart
        setDailyData(dayData.reverse());

        // Sales by Rep (for Managers)
        if (isManager) {
            const repMap = {};
            data.forEach(tx => {
                const rep = tx.sales_rep || 'לא משויך';
                repMap[rep] = (repMap[rep] || 0) + (tx.total_row_amount || 0);
            });
            const repData = Object.entries(repMap)
                .map(([name, value]) => ({ name, value }))
                .sort((a, b) => b.value - a.value);
            setSalesByRepData(repData);

            // Extract unique reps for filter if not already loaded or if we want dynamic based on current data
            // Better to fetch all possible reps maybe, but for now from current data is okay
            const reps = [...new Set(data.map(tx => tx.sales_rep).filter(Boolean))].sort();
            setAvailableReps(reps);
        }
    };

    useEffect(() => {
        loadData();
    }, [dateRange, selectedRep]);

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
            case 'last3Months':
                from = startOfMonth(subMonths(today, 3));
                to = endOfMonth(today);
                break;
            case 'today':
                from = today;
                to = today;
                break;
            default:
                return;
        }

        setDateRange({
            from: format(from, 'yyyy-MM-dd'),
            to: format(to, 'yyyy-MM-dd')
        });
    };

    return (
        <div className="p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">דשבורד מכירות</h1>
                    <p className="text-gray-600">סיכום נתונים מתוך Linet</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Link to={createPageUrl("SalesDataAdmin")}>
                        <Button className="bg-purple-600 text-white hover:bg-purple-700 shadow-md">
                            <Settings className="w-4 h-4 ml-2" />
                            ניהול וסנכרון
                        </Button>
                    </Link>
                    <Button 
                        onClick={loadData} 
                        disabled={isLoading} 
                        className="bg-blue-600 text-white hover:bg-blue-700 shadow-md"
                    >
                        <RefreshCw className={`w-4 h-4 ml-2 ${isLoading ? 'animate-spin' : ''}`} />
                        רענן נתונים
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <Card className="glass-card border-0">
                <CardContent className="p-4 flex flex-wrap gap-4 items-end">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">טווח תאריכים מהיר</label>
                        <Select onValueChange={handleDatePreset} defaultValue="last3Months">
                            <SelectTrigger className="w-[180px] bg-white border">
                                <SelectValue placeholder="בחר תקופה" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="today">היום</SelectItem>
                                <SelectItem value="thisMonth">החודש הנוכחי</SelectItem>
                                <SelectItem value="lastMonth">חודש שעבר</SelectItem>
                                <SelectItem value="last3Months">3 חודשים אחרונים</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {isManager && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">סינון לפי נציג</label>
                            <Select value={selectedRep} onValueChange={setSelectedRep}>
                                <SelectTrigger className="w-[180px] bg-white border">
                                    <SelectValue placeholder="כל הנציגים" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">כל הנציגים</SelectItem>
                                    {availableReps.map(rep => (
                                        <SelectItem key={rep} value={rep}>{rep}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">מתאריך</label>
                        <Input 
                            type="date" 
                            value={dateRange.from}
                            onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                            className="bg-white border w-auto"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">עד תאריך</label>
                        <Input 
                            type="date" 
                            value={dateRange.to}
                            onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                            className="bg-white border w-auto"
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-600 to-blue-500 text-white">
                    <CardContent className="p-6">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-blue-100 text-sm font-medium mb-1">סה"כ מכירות (לתקופה)</p>
                                <h3 className="text-3xl font-bold text-white">
                                    ₪{stats.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </h3>
                            </div>
                            <div className="p-2 bg-white/20 rounded-lg">
                                <BarChart3 className="w-6 h-6 text-white" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-purple-600 to-purple-500 text-white">
                    <CardContent className="p-6">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-purple-100 text-sm font-medium mb-1">מספר עסקאות</p>
                                <h3 className="text-3xl font-bold text-white">{stats.count}</h3>
                            </div>
                            <div className="p-2 bg-white/20 rounded-lg">
                                <ArrowUpRight className="w-6 h-6 text-white" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-emerald-600 to-emerald-500 text-white">
                    <CardContent className="p-6">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-emerald-100 text-sm font-medium mb-1">ממוצע לעסקה</p>
                                <h3 className="text-3xl font-bold text-white">
                                    ₪{stats.avgSale.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </h3>
                            </div>
                            <div className="p-2 bg-white/20 rounded-lg">
                                <Calendar className="w-6 h-6 text-white" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {isManager && (
                    <Card className="glass-card border-0 lg:col-span-2">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-gray-800">
                                <Users className="w-5 h-5 text-indigo-600" />
                                מכירות לפי נציג
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[300px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={salesByRepData}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                        <XAxis dataKey="name" stroke="#6B7280" fontSize={12} />
                                        <YAxis stroke="#6B7280" fontSize={12} tickFormatter={(val) => `₪${val/1000}k`} />
                                        <RechartsTooltip 
                                            formatter={(value) => [`₪${value.toLocaleString()}`, 'מכירות']}
                                            contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                                        />
                                        <Bar dataKey="value" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>
                )}

                <Card className="glass-card border-0">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-gray-800">
                            <PieIcon className="w-5 h-5 text-purple-600" />
                            התפלגות לפי קטגוריות
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={categoriesData}
                                        cx="50%"
                                        cy="50%"
                                        labelLine={false}
                                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                                        outerRadius={100}
                                        fill="#8884d8"
                                        dataKey="value"
                                    >
                                        {categoriesData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <RechartsTooltip formatter={(value) => `₪${value.toLocaleString()}`} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                <Card className="glass-card border-0">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-gray-800">
                            <BarChart3 className="w-5 h-5 text-blue-600" />
                            מכירות יומיות
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={dailyData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                    <XAxis dataKey="name" stroke="#6B7280" fontSize={12} />
                                    <YAxis stroke="#6B7280" fontSize={12} tickFormatter={(val) => `₪${val/1000}k`} />
                                    <RechartsTooltip 
                                        formatter={(value) => [`₪${value.toLocaleString()}`, 'מכירות']}
                                        contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                                    />
                                    <Bar dataKey="value" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Transactions Table */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle>פירוט עסקאות</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="rounded-lg overflow-hidden border border-gray-200">
                        <Table>
                            <TableHeader className="bg-gray-50">
                                <TableRow>
                                    <TableHead className="text-right">סוג מסמך</TableHead>
                                    <TableHead className="text-right">תאריך הפקה</TableHead>
                                    <TableHead className="text-right">חברה</TableHead>
                                    <TableHead className="text-right">מספר מסמך</TableHead>
                                    <TableHead className="text-right">מק"ט</TableHead>
                                    <TableHead className="text-right">שם פריט</TableHead>
                                    <TableHead className="text-center">כמות</TableHead>
                                    <TableHead className="text-left">מחיר פריט (כולל מע"מ)</TableHead>
                                    <TableHead className="text-left">סך שורה לפני מע"מ</TableHead>
                                    <TableHead className="text-left">סך שורה (כולל מע"מ)</TableHead>
                                    <TableHead className="text-right">קטגוריה</TableHead>
                                    <TableHead className="text-right">בעלים</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {transactions.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan="8" className="text-center py-12 text-gray-500">
                                            {isLoading ? (
                                                <div className="flex flex-col items-center gap-2">
                                                    <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                                                    <p>טוען נתונים...</p>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center gap-4">
                                                    <p className="text-lg font-semibold">לא נמצאו נתונים לטווח הנבחר</p>
                                                    <p className="text-sm text-gray-500">יתכן וטרם בוצע סנכרון מול Linet, או שאין עסקאות בטווח התאריכים.</p>
                                                    <Link to={createPageUrl("SalesDataAdmin")}>
                                                        <Button variant="outline" className="mt-2">
                                                            <Settings className="w-4 h-4 mr-2" />
                                                            עבור למסך ניהול וסנכרון
                                                        </Button>
                                                    </Link>
                                                </div>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    transactions.map((tx) => (
                                        <TableRow key={tx.id} className="hover:bg-gray-50/50">
                                            <TableCell>
                                                <span className={`px-2 py-1 rounded-full text-xs ${
                                                    tx.doc_type && tx.doc_type.includes('זיכוי') ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                                                }`}>
                                                    {tx.doc_type}
                                                </span>
                                            </TableCell>
                                            <TableCell className="font-medium">
                                                {format(new Date(tx.issue_date), 'dd/MM/yyyy')}
                                            </TableCell>
                                            <TableCell>{tx.customer_name}</TableCell>
                                            <TableCell>{tx.doc_number}</TableCell>
                                            <TableCell className="font-mono text-xs">{tx.sku}</TableCell>
                                            <TableCell className="max-w-[200px] truncate" title={tx.product_name}>
                                                {tx.product_name}
                                            </TableCell>
                                            <TableCell className="text-center font-bold">{tx.quantity}</TableCell>
                                            <TableCell className="text-left">₪{tx.unit_price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                            <TableCell className="text-left">₪{tx.price_ex_vat?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                            <TableCell className="text-left font-bold" dir="ltr">
                                                ₪{tx.total_row_amount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </TableCell>
                                            <TableCell>
                                                <span className="px-2 py-1 bg-gray-100 rounded text-xs font-medium text-gray-600">
                                                    {tx.category || '-'}
                                                </span>
                                            </TableCell>
                                            <TableCell>{tx.sales_rep}</TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}