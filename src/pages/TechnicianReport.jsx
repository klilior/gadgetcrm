
import React, { useState, useEffect, useCallback } from 'react';
import { Repair, Client, RepairDevice } from "@/entities/all";
import { useUser } from '../components/UserAuth';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3, Wrench, Package, DollarSign, TrendingUp, Loader } from "lucide-react";
import { format } from 'date-fns';

const StatCard = ({ title, value, icon: Icon, color }) => (
  <div className="glass-card p-6 rounded-2xl flex-1">
    <div className="flex justify-between items-center">
      <h3 className="text-lg font-medium text-gray-700">{title}</h3>
      <Icon className={`w-8 h-8 ${color}`} />
    </div>
    <p className="text-4xl font-bold mt-4 text-gray-900">{value}</p>
  </div>
);

export default function TechnicianReport() {
    const { currentUser } = useUser();
    const [repairs, setRepairs] = useState([]);
    const [stats, setStats] = useState({ total: 0, parts: 0, revenue: 0, profit: 0 });
    const [isLoading, setIsLoading] = useState(true);

    const calculateStats = (data) => {
        const total = data.length;
        const parts = data.reduce((sum, r) => sum + (r.part_cost || 0), 0);
        const revenue = data.reduce((sum, r) => sum + (r.final_price || 0), 0);
        const profit = revenue - parts;
        setStats({ total, parts, revenue, profit });
    };

    const loadReportData = useCallback(async () => {
        if (!currentUser) return;
        
        setIsLoading(true);
        try {
            const closedRepairs = await Repair.filter({
                technician_id: currentUser.id,
                status: "תיקון נסגר"
            }, "-updated_date", 200);

            if (closedRepairs.length > 0) {
                const clientIds = [...new Set(closedRepairs.map(r => r.client_id))];
                const deviceIds = [...new Set(closedRepairs.map(r => r.device_id))];

                const [clients, devices] = await Promise.all([
                    Client.filter({ id: { $in: clientIds } }),
                    RepairDevice.filter({ id: { $in: deviceIds } })
                ]);

                const clientsMap = clients.reduce((acc, c) => ({ ...acc, [c.id]: c }), {});
                const devicesMap = devices.reduce((acc, d) => ({ ...acc, [d.id]: d }), {});

                const enrichedRepairs = closedRepairs.map(r => ({
                    ...r,
                    customer: clientsMap[r.client_id],
                    device: devicesMap[r.device_id]
                }));
                
                setRepairs(enrichedRepairs);
                calculateStats(enrichedRepairs);
            } else {
                setRepairs([]);
                setStats({ total: 0, parts: 0, revenue: 0, profit: 0 });
            }
        } catch (error) {
            console.error("Error loading technician report:", error);
        } finally {
            setIsLoading(false);
        }
    }, [currentUser]);

    useEffect(() => {
        loadReportData();
    }, [loadReportData]);

    const formatDate = (dateString) => {
        try {
            return format(new Date(dateString), "dd/MM/yyyy");
        } catch {
            return "N/A";
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full p-6">
                <div className="flex flex-col items-center gap-4">
                    <Loader className="w-12 h-12 text-purple-600 animate-spin" />
                    <p className="text-lg text-gray-600">טוען דוח התחשבנות...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-3">
                <BarChart3 className="w-8 h-8 text-purple-600" />
                דוח התחשבנות
            </h1>
            
            {/* Stats Cards */}
            <div className="flex flex-col sm:flex-row gap-4">
                <StatCard title="סה״כ תיקונים" value={stats.total} icon={Package} color="text-blue-500" />
                <StatCard title="עלות חלקים" value={`₪${stats.parts.toLocaleString()}`} icon={Wrench} color="text-orange-500" />
                <StatCard title="הכנסה" value={`₪${stats.revenue.toLocaleString()}`} icon={DollarSign} color="text-green-500" />
                <StatCard title="רווח" value={`₪${stats.profit.toLocaleString()}`} icon={TrendingUp} color="text-indigo-500" />
            </div>

            {/* Repairs Table */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle>פירוט תיקונים סגורים</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>מס׳ תיקון</TableHead>
                                    <TableHead>לקוח</TableHead>
                                    <TableHead>מכשיר</TableHead>
                                    <TableHead>תאריך סגירה</TableHead>
                                    <TableHead className="text-right">עלות חלקים</TableHead>
                                    <TableHead className="text-right">מחיר סופי</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {repairs.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center py-10 text-gray-500">
                                            אין תיקונים סגורים להצגה.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    repairs.map((repair) => (
                                        <TableRow key={repair.id}>
                                            <TableCell className="font-mono">{repair.repair_id}</TableCell>
                                            <TableCell>{repair.customer?.full_name || "N/A"}</TableCell>
                                            <TableCell>{repair.device ? `${repair.device.manufacturer} ${repair.device.model}` : "N/A"}</TableCell>
                                            <TableCell>{formatDate(repair.updated_date)}</TableCell>
                                            <TableCell className="text-right">₪{repair.part_cost?.toLocaleString() || 0}</TableCell>
                                            <TableCell className="text-right font-semibold">₪{repair.final_price?.toLocaleString() || 0}</TableCell>
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
