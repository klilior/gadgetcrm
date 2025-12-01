import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BarChart3, Calendar, ArrowUpRight, RefreshCw, Settings, PieChart as PieIcon, Users, Filter, X } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid, PieChart, Pie, Cell } from 'recharts';

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
    const [selectedCategories, setSelectedCategories] = useState([]);
    const [availableCategories, setAvailableCategories] = useState([]);

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
            const data = await base44.entities.SalesTransaction.filter(query, '-issue_date', 10000);
            
            // Extract all categories for filter
            const cats = [...new Set(data.map(tx => tx.category).filter(Boolean))].sort();
            setAvailableCategories(cats);
            
            // Apply category filter client-side
            let filteredData = data;
            if (selectedCategories.length > 0) {
                filteredData = data.filter(tx => selectedCategories.includes(tx.category));
            }
            
            setTransactions(filteredData);
            calculateStats(filteredData);
        } catch (error) {
            console.error("Error loading sales data:", error);
            setTransactions([]);
        } finally {
            setIsLoading(false);
        }
    };

    const calculateStats = (data) => {
        // Use price_ex_vat (without VAT) for all calculations
        const total = data.reduce((sum, tx) => sum + (tx.price_ex_vat || 0), 0);
        const count = data.length;
        setStats({
            totalSales: total,
            count: count,
            avgSale: count > 0 ? total / count : 0
        });

        // Category Breakdown (using price_ex_vat)
        const catMap = {};
        data.forEach(tx => {
            const cat = tx.category || 'אחר';
            catMap[cat] = (catMap[cat] || 0) + (tx.price_ex_vat || 0);
        });
        
        const catData = Object.entries(catMap)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);
        
        setCategoriesData(catData);

        // Daily Breakdown (using price_ex_vat)
        const dayMap = {};
        data.forEach(tx => {
            const day = tx.issue_date ? format(new Date(tx.issue_date), 'dd/MM') : 'Unknown';
            dayMap[day] = (dayMap[day] || 0) + (tx.price_ex_vat || 0);
        });

        const dayData = Object.entries(dayMap)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => { // sort by date simple hack: assuming same month/year roughly or iso
                 return 0; // keeping order of keys if possible or rely on API sort
            }); 
            // Better sort if we parse dates, but simplified for now as API returns sorted desc
        
        // Since API returns desc, reverse for chart
        setDailyData(dayData.reverse());

        // Sales by Rep (for Managers) - using price_ex_vat
        if (isManager) {
            const repMap = {};
            data.forEach(tx => {
                const rep = tx.sales_rep || 'לא משויך';
                repMap[rep] = (repMap[rep] || 0) + (tx.price_ex_vat || 0);
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
    }, [dateRange, selectedRep, selectedCategories]);

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
        <div className="p-3 md:p-6 space-y-4 md:space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 md:gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900">דשבורד מכירות</h1>
                    <p className="text-sm md:text-base text-gray-600">סיכום נתונים מתוך Linet</p>
                </div>
                <div className="flex flex-wrap gap-2 w-full md:w-auto">
                    {isManager && (
                        <Link to={createPageUrl("SalesDataAdmin")} className="flex-1 md:flex-none">
                            <Button className="w-full md:w-auto bg-purple-600 text-white hover:bg-purple-700 shadow-md text-sm">
                                <Settings className="w-4 h-4 ml-1 md:ml-2" />
                                <span className="hidden sm:inline">ניהול וסנכרון</span>
                                <span className="sm:hidden">ניהול</span>
                            </Button>
                        </Link>
                    )}
                    <Button 
                        onClick={loadData} 
                        disabled={isLoading} 
                        className="flex-1 md:flex-none bg-blue-600 text-white hover:bg-blue-700 shadow-md text-sm"
                    >
                        <RefreshCw className={`w-4 h-4 ml-1 md:ml-2 ${isLoading ? 'animate-spin' : ''}`} />
                        רענן
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <Card className="glass-card border-0">
                <CardContent className="p-3 md:p-4">
                    <div className="grid grid-cols-2 md:flex md:flex-wrap gap-3 md:gap-4 items-end">
                        <div className="space-y-1 md:space-y-2 col-span-2 md:col-span-1">
                            <label className="text-xs md:text-sm font-medium text-gray-700">תקופה</label>
                            <Select onValueChange={handleDatePreset} defaultValue="last3Months">
                                <SelectTrigger className="w-full md:w-[160px] bg-white border text-sm">
                                    <SelectValue placeholder="בחר תקופה" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="today">היום</SelectItem>
                                    <SelectItem value="thisMonth">החודש הנוכחי</SelectItem>
                                    <SelectItem value="lastMonth">חודש שעבר</SelectItem>
                                    <SelectItem value="last3Months">3 חודשים</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {isManager && (
                            <div className="space-y-1 md:space-y-2 col-span-2 md:col-span-1">
                                <label className="text-xs md:text-sm font-medium text-gray-700">נציג</label>
                                <Select value={selectedRep} onValueChange={setSelectedRep}>
                                    <SelectTrigger className="w-full md:w-[160px] bg-white border text-sm">
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
                        <div className="space-y-1 md:space-y-2">
                            <label className="text-xs md:text-sm font-medium text-gray-700">מתאריך</label>
                            <Input 
                                type="date" 
                                value={dateRange.from}
                                onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                                className="bg-white border text-sm"
                            />
                        </div>
                        <div className="space-y-1 md:space-y-2">
                            <label className="text-xs md:text-sm font-medium text-gray-700">עד תאריך</label>
                            <Input 
                                type="date" 
                                value={dateRange.to}
                                onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                                className="bg-white border text-sm"
                            />
                        </div>
                        
                        {/* Category Multi-Select Filter */}
                        <div className="space-y-1 md:space-y-2 col-span-2 md:col-span-1">
                            <label className="text-xs md:text-sm font-medium text-gray-700">קטגוריות</label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-full md:w-[200px] justify-between bg-white text-sm">
                                        <span className="truncate">
                                            {selectedCategories.length === 0 
                                                ? "כל הקטגוריות" 
                                                : `${selectedCategories.length} נבחרו`}
                                        </span>
                                        <Filter className="w-4 h-4 mr-2 shrink-0" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[250px] p-2 max-h-[300px] overflow-y-auto" align="start">
                                    <div className="flex justify-between items-center mb-2 pb-2 border-b">
                                        <span className="text-sm font-medium">בחר קטגוריות</span>
                                        {selectedCategories.length > 0 && (
                                            <Button 
                                                variant="ghost" 
                                                size="sm" 
                                                onClick={() => setSelectedCategories([])}
                                                className="h-6 px-2 text-xs"
                                            >
                                                נקה הכל
                                            </Button>
                                        )}
                                    </div>
                                    <div className="space-y-1">
                                        {availableCategories.map(cat => (
                                            <div key={cat} className="flex items-center gap-2 p-1 hover:bg-gray-100 rounded cursor-pointer"
                                                onClick={() => {
                                                    setSelectedCategories(prev => 
                                                        prev.includes(cat) 
                                                            ? prev.filter(c => c !== cat)
                                                            : [...prev, cat]
                                                    );
                                                }}
                                            >
                                                <Checkbox 
                                                    checked={selectedCategories.includes(cat)}
                                                    className="pointer-events-none"
                                                />
                                                <span className="text-sm">{cat}</span>
                                            </div>
                                        ))}
                                    </div>
                                </PopoverContent>
                            </Popover>
                        </div>
                    </div>
                    
                    {/* Selected Categories Tags */}
                    {selectedCategories.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t">
                            {selectedCategories.map(cat => (
                                <span key={cat} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">
                                    {cat}
                                    <X 
                                        className="w-3 h-3 cursor-pointer hover:text-blue-600" 
                                        onClick={() => setSelectedCategories(prev => prev.filter(c => c !== cat))}
                                    />
                                </span>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-6">
                <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-600 to-blue-500 text-white">
                    <CardContent className="p-4 md:p-6">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-blue-100 text-xs md:text-sm font-medium mb-1">סה"כ (ללא מע"מ)</p>
                                <h3 className="text-xl md:text-3xl font-bold text-white">
                                    ₪{stats.totalSales.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </h3>
                            </div>
                            <div className="p-2 bg-white/20 rounded-lg">
                                <BarChart3 className="w-5 h-5 md:w-6 md:h-6 text-white" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-purple-600 to-purple-500 text-white">
                    <CardContent className="p-4 md:p-6">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-purple-100 text-xs md:text-sm font-medium mb-1">עסקאות</p>
                                <h3 className="text-xl md:text-3xl font-bold text-white">{stats.count}</h3>
                            </div>
                            <div className="p-2 bg-white/20 rounded-lg">
                                <ArrowUpRight className="w-5 h-5 md:w-6 md:h-6 text-white" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-emerald-600 to-emerald-500 text-white">
                    <CardContent className="p-4 md:p-6">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-emerald-100 text-xs md:text-sm font-medium mb-1">ממוצע</p>
                                <h3 className="text-xl md:text-3xl font-bold text-white">
                                    ₪{stats.avgSale.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </h3>
                            </div>
                            <div className="p-2 bg-white/20 rounded-lg">
                                <Calendar className="w-5 h-5 md:w-6 md:h-6 text-white" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-6">
                {isManager && salesByRepData.length > 0 && (
                    <Card className="glass-card border-0 lg:col-span-2">
                        <CardHeader className="p-3 md:p-6">
                            <CardTitle className="flex items-center gap-2 text-gray-800 text-sm md:text-base">
                                <Users className="w-4 h-4 md:w-5 md:h-5 text-indigo-600" />
                                מכירות לפי נציג
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-2 md:p-6 pt-0">
                            <div className="h-[200px] md:h-[300px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={salesByRepData}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                        <XAxis dataKey="name" stroke="#6B7280" fontSize={10} tick={{ fontSize: 10 }} />
                                        <YAxis stroke="#6B7280" fontSize={10} tickFormatter={(val) => `₪${val/1000}k`} width={50} />
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
                    <CardHeader className="p-3 md:p-6">
                        <CardTitle className="flex items-center gap-2 text-gray-800 text-sm md:text-base">
                            <PieIcon className="w-4 h-4 md:w-5 md:h-5 text-purple-600" />
                            התפלגות קטגוריות
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-2 md:p-6 pt-0">
                        <div className="h-[220px] md:h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={categoriesData.slice(0, 8)}
                                        cx="50%"
                                        cy="50%"
                                        labelLine={false}
                                        label={({ name, percent }) => percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ''}
                                        outerRadius={70}
                                        fill="#8884d8"
                                        dataKey="value"
                                    >
                                        {categoriesData.slice(0, 8).map((entry, index) => (
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
                    <CardHeader className="p-3 md:p-6">
                        <CardTitle className="flex items-center gap-2 text-gray-800 text-sm md:text-base">
                            <BarChart3 className="w-4 h-4 md:w-5 md:h-5 text-blue-600" />
                            מכירות יומיות
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-2 md:p-6 pt-0">
                        <div className="h-[220px] md:h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={dailyData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                    <XAxis dataKey="name" stroke="#6B7280" fontSize={10} tick={{ fontSize: 10 }} />
                                    <YAxis stroke="#6B7280" fontSize={10} tickFormatter={(val) => `₪${val/1000}k`} width={50} />
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

            {/* Transactions Table - Desktop */}
            <Card className="glass-card border-0 hidden md:block">
                <CardHeader className="p-4 md:p-6">
                    <CardTitle className="text-sm md:text-base">פירוט עסקאות ({transactions.length})</CardTitle>
                </CardHeader>
                <CardContent className="p-0 md:p-6 md:pt-0">
                    <div className="rounded-lg overflow-x-auto border border-gray-200">
                        <Table>
                            <TableHeader className="bg-gray-50">
                                <TableRow>
                                    <TableHead className="text-right text-xs">סוג</TableHead>
                                    <TableHead className="text-right text-xs">תאריך</TableHead>
                                    <TableHead className="text-right text-xs">חברה</TableHead>
                                    <TableHead className="text-right text-xs">מסמך</TableHead>
                                    <TableHead className="text-right text-xs">פריט</TableHead>
                                    <TableHead className="text-center text-xs">כמות</TableHead>
                                    <TableHead className="text-left text-xs">ללא מע"מ</TableHead>
                                    <TableHead className="text-left text-xs">כולל מע"מ</TableHead>
                                    <TableHead className="text-right text-xs">קטגוריה</TableHead>
                                    <TableHead className="text-right text-xs">נציג</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {transactions.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan="10" className="text-center py-12 text-gray-500">
                                            {isLoading ? (
                                                <div className="flex flex-col items-center gap-2">
                                                    <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                                                    <p>טוען...</p>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center gap-4">
                                                    <p className="font-semibold">אין נתונים</p>
                                                    {isManager && (
                                                        <Link to={createPageUrl("SalesDataAdmin")}>
                                                            <Button variant="outline" size="sm">
                                                                <Settings className="w-4 h-4 mr-2" />
                                                                סנכרן נתונים
                                                            </Button>
                                                        </Link>
                                                    )}
                                                </div>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    transactions.map((tx) => (
                                        <TableRow key={tx.id} className="hover:bg-gray-50/50">
                                            <TableCell>
                                                <span className={`px-2 py-1 rounded-full text-xs ${
                                                    tx.doc_type?.includes('זיכוי') ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                                                }`}>
                                                    {tx.doc_type?.includes('זיכוי') ? 'זיכוי' : 'מכירה'}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-xs">{format(new Date(tx.issue_date), 'dd/MM')}</TableCell>
                                            <TableCell className="text-xs max-w-[120px] truncate">{tx.customer_name}</TableCell>
                                            <TableCell className="text-xs">{tx.doc_number}</TableCell>
                                            <TableCell className="text-xs max-w-[150px] truncate" title={tx.product_name}>{tx.product_name}</TableCell>
                                            <TableCell className="text-center text-xs font-bold">{tx.quantity}</TableCell>
                                            <TableCell className="text-left text-xs font-bold text-blue-700" dir="ltr">
                                                ₪{tx.price_ex_vat?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </TableCell>
                                            <TableCell className="text-left text-xs text-gray-500" dir="ltr">
                                                ₪{tx.total_row_amount?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </TableCell>
                                            <TableCell>
                                                <span className="px-2 py-1 bg-gray-100 rounded text-xs">{tx.category || '-'}</span>
                                            </TableCell>
                                            <TableCell className="text-xs">{tx.sales_rep}</TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            {/* Transactions - Mobile Cards */}
            <div className="md:hidden space-y-3">
                <div className="flex justify-between items-center px-1">
                    <h3 className="font-semibold text-gray-800">עסקאות ({transactions.length})</h3>
                </div>
                {isLoading ? (
                    <div className="flex justify-center py-8">
                        <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                    </div>
                ) : transactions.length === 0 ? (
                    <Card className="glass-card border-0 p-6 text-center text-gray-500">
                        <p>אין נתונים לתקופה זו</p>
                    </Card>
                ) : (
                    transactions.map((tx) => (
                        <Card key={tx.id} className="glass-card border-0 p-3">
                            <div className="flex justify-between items-start mb-2">
                                <div>
                                    <p className="font-semibold text-sm">{tx.customer_name}</p>
                                    <p className="text-xs text-gray-500">{tx.product_name}</p>
                                </div>
                                <div className="text-left">
                                    <span className={`block px-2 py-1 rounded-full text-xs font-bold ${
                                        tx.doc_type?.includes('זיכוי') ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                                    }`}>
                                        ₪{tx.price_ex_vat?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </span>
                                    <span className="text-xs text-gray-400 block text-center mt-1">
                                        כולל: ₪{tx.total_row_amount?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </span>
                                </div>
                            </div>
                            <div className="flex justify-between text-xs text-gray-500">
                                <span>{format(new Date(tx.issue_date), 'dd/MM/yyyy')}</span>
                                <span>{tx.sales_rep}</span>
                            </div>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}