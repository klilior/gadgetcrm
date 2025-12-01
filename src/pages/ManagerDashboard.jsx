import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, Users, Wrench, TrendingUp, DollarSign, AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

const StatCard = ({ title, value, icon: Icon, color }) => (
    <Card className="glass-card border-0">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            <Icon className={`h-4 w-4 ${color}`} />
        </CardHeader>
        <CardContent>
            <div className="text-2xl font-bold">{value}</div>
        </CardContent>
    </Card>
);

export default function ManagerDashboard() {
    const [stats, setStats] = useState({
        totalOrders: 0,
        totalClients: 0,
        openRepairs: 0,
        monthlyRevenue: 0
    });
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        loadDashboardData();
    }, []);

    const loadDashboardData = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const entities = await import("@/entities/all");
            
            // Load only entities that exist
            let totalOrders = 0;
            let totalClients = 0;
            let openRepairs = 0;

            if (entities.Order) {
                try {
                    const orders = await entities.Order.filter({});
                    totalOrders = orders.length;
                } catch (e) {
                    console.log("Could not load orders:", e.message);
                }
            }

            if (entities.Client) {
                try {
                    const clients = await entities.Client.filter({});
                    totalClients = clients.length;
                } catch (e) {
                    console.log("Could not load clients:", e.message);
                }
            }

            if (entities.Repair) {
                try {
                    const repairs = await entities.Repair.filter({
                        status: { $nin: ["תיקון נסגר", "לא ניתן לתיקון"] }
                    });
                    openRepairs = repairs.length;
                } catch (e) {
                    console.log("Could not load repairs:", e.message);
                }
            }

            setStats({
                totalOrders,
                totalClients,
                openRepairs,
                monthlyRevenue: 0 // Can be calculated from orders later
            });

        } catch (error) {
            console.error("Error loading dashboard data:", error);
            setError(error.message);
        } finally {
            setIsLoading(false);
        }
    };

    if (error) {
        return (
            <div className="p-6 space-y-6">
                <h1 className="text-3xl font-bold text-gray-900">דשבורד מנהל</h1>
                <Card className="glass-card border-0">
                    <CardContent className="p-6">
                        <div className="text-center py-10">
                            <AlertTriangle className="w-16 h-16 mx-auto mb-4 text-red-500" />
                            <h3 className="text-xl font-semibold text-red-700 mb-2">שגיאה בטעינת הנתונים</h3>
                            <p className="text-gray-600 mb-4">{error}</p>
                            <button onClick={loadDashboardData} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                                נסה שוב
                            </button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="p-6 space-y-6">
                <h1 className="text-3xl font-bold text-gray-900">דשבורד מנהל</h1>
                <div className="text-center py-10">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-4 text-gray-600">טוען נתונים...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">דשבורד מנהל</h1>
            
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatCard 
                    title="סך הזמנות" 
                    value={stats.totalOrders} 
                    icon={Package} 
                    color="text-blue-600" 
                />
                <StatCard 
                    title="לקוחות" 
                    value={stats.totalClients} 
                    icon={Users} 
                    color="text-green-600" 
                />
                <StatCard 
                    title="תיקונים פתוחים" 
                    value={stats.openRepairs} 
                    icon={Wrench} 
                    color="text-orange-600" 
                />
                <StatCard 
                    title="הכנסות חודשיות" 
                    value={`₪${stats.monthlyRevenue.toLocaleString()}`} 
                    icon={DollarSign} 
                    color="text-purple-600" 
                />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <Card className="glass-card border-0">
                    <CardHeader>
                        <CardTitle>סטטיסטיקות כלליות</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-gray-600">הזמנות פעילות</span>
                                <span className="font-bold">{stats.totalOrders}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-gray-600">לקוחות רשומים</span>
                                <span className="font-bold">{stats.totalClients}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-gray-600">תיקונים פתוחים</span>
                                <span className="font-bold">{stats.openRepairs}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="glass-card border-0">
                    <CardHeader>
                        <CardTitle>פעילות אחרונה</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-center py-8 text-gray-500">
                            <TrendingUp className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                            <p>נתוני פעילות יוצגו כאן</p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}