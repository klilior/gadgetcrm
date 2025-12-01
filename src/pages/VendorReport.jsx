
import React, { useState, useEffect } from 'react';
import { Repair, Client, Employee } from '@/entities/all';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Loader, HandCoins, TrendingUp, Wrench, Package, Edit, Save, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { he } from 'date-fns/locale';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useUser } from '../components/UserAuth';

const StatCard = ({ title, value, icon: Icon, color }) => (
  <div className="glass-card p-6 rounded-2xl flex-1">
    <div className="flex justify-between items-center">
      <h3 className="text-lg font-medium text-gray-700">{title}</h3>
      <Icon className={`w-8 h-8 ${color}`} />
    </div>
    <p className="text-4xl font-bold mt-4 text-gray-900">{value}</p>
  </div>
);

export default function VendorReport() {
    const { currentUser } = useUser();
    const [monthlyData, setMonthlyData] = useState({});
    const [overallStats, setOverallStats] = useState({
        totalLabPayment: 0,
        totalNetProfit: 0, // Changed from totalProfit
        totalPartCost: 0,
        totalRepairs: 0,
        totalRevenue: 0 // New
    });
    const [isLoading, setIsLoading] = useState(true);
    const [editingRepairId, setEditingRepairId] = useState(null);
    const [editValues, setEditValues] = useState({}); // Initialize as object

    const isManager = currentUser?.role === 'מנהל';
    const isTechnician = currentUser?.role === 'טכנאי';

    useEffect(() => {
        loadReportData();
    }, [currentUser]); // Added currentUser to dependencies to re-run if user changes role or logs in

    const loadReportData = async () => {
        setIsLoading(true);
        try {
            // טכנאי ומנהל רואים את כל תיקוני המעבדה
            const closedRepairs = await Repair.filter({
                repair_type: "מעבדת Gadget-Team",
                status: "תיקון נסגר"
            }, "-updated_date", 500);

            if (closedRepairs.length === 0) {
                setIsLoading(false);
                setMonthlyData({}); // Clear data if no repairs found
                setOverallStats({ // Reset stats as well
                    totalLabPayment: 0,
                    totalNetProfit: 0,
                    totalPartCost: 0,
                    totalRepairs: 0,
                    totalRevenue: 0
                });
                return;
            }

            const clientIds = [...new Set(closedRepairs.map(r => r.client_id))];
            const technicianIds = [...new Set(closedRepairs.map(r => r.technician_id))];
            
            const [clients, technicians] = await Promise.all([
                Client.filter({ id: { $in: clientIds } }),
                Employee.filter({ id: { $in: technicianIds } })
            ]);
            
            const clientsMap = clients.reduce((acc, c) => ({ ...acc, [c.id]: c }), {});
            const techniciansMap = technicians.reduce((acc, t) => ({ ...acc, [t.id]: t }), {});

            const enrichedRepairs = closedRepairs.map(r => ({
                ...r,
                customer: clientsMap[r.client_id],
                technician: techniciansMap[r.technician_id]
            }));
            
            processAndGroupRepairs(enrichedRepairs);

        } catch (error) {
            console.error("Error loading vendor report:", error);
            // Optionally, handle error state or show a message to the user
            setMonthlyData({});
            setOverallStats({
                totalLabPayment: 0,
                totalNetProfit: 0,
                totalPartCost: 0,
                totalRepairs: 0,
                totalRevenue: 0
            });
        } finally {
            setIsLoading(false);
        }
    };

    const processAndGroupRepairs = (repairs) => {
        let totalLabPayment = 0;
        let totalNetProfit = 0;
        let totalPartCost = 0;
        let totalRevenue = 0;

        const monthlyGroups = repairs.reduce((acc, repair) => {
            const finalPrice = repair.final_price || 0;
            const partCost = repair.part_cost || 0;
            
            // חישוב תשלום למעבדה
            const grossProfit = finalPrice - partCost;
            const labShare = grossProfit / 2;
            const labPayment = labShare + partCost; // This is the payment from the business to the lab
            
            // רווח נקי לעסק = הכנסה פחות תשלום למעבדה
            const netProfit = finalPrice - labPayment;

            repair.grossProfit = grossProfit;
            repair.labPayment = labPayment;
            repair.netProfit = netProfit;

            totalLabPayment += labPayment;
            totalNetProfit += netProfit;
            totalPartCost += partCost;
            totalRevenue += finalPrice;
            
            const monthKey = format(parseISO(repair.updated_date), 'yyyy-MM');
            if (!acc[monthKey]) {
                acc[monthKey] = {
                    repairs: [],
                    totalLabPayment: 0,
                    totalNetProfit: 0,
                    totalRevenue: 0
                };
            }
            acc[monthKey].repairs.push(repair);
            acc[monthKey].totalLabPayment += labPayment;
            acc[monthKey].totalNetProfit += netProfit;
            acc[monthKey].totalRevenue += finalPrice;
            
            return acc;
        }, {});

        setMonthlyData(monthlyGroups);
        setOverallStats({
            totalLabPayment,
            totalNetProfit,
            totalPartCost,
            totalRepairs: repairs.length,
            totalRevenue
        });
    };

    const handleEdit = (repair) => {
        setEditingRepairId(repair.id);
        setEditValues({
            final_price: repair.final_price || 0,
            part_cost: repair.part_cost || 0
        });
    };

    const handleSave = async (repair) => {
        try {
            await Repair.update(repair.id, {
                final_price: parseFloat(editValues.final_price),
                part_cost: parseFloat(editValues.part_cost)
            });
            
            setEditingRepairId(null);
            setEditValues({});
            await loadReportData();
        } catch (error) {
            console.error("Error updating repair:", error);
            alert("שגיאה בשמירת השינויים: " + (error.message || "שגיאה לא ידועה"));
        }
    };

    const handleCancel = () => {
        setEditingRepairId(null);
        setEditValues({});
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
    
    const sortedMonths = Object.keys(monthlyData).sort().reverse();

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
                    דוח התחשבנות מעבדת Gadget-Team
                </h1>
                {!isManager && (
                    <div className="text-sm text-gray-600 bg-blue-50 px-4 py-2 rounded-lg">
                        📋 מצב צפיה בלבד
                    </div>
                )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard title="סה״כ הכנסות" value={`₪${overallStats.totalRevenue.toLocaleString()}`} icon={TrendingUp} color="text-blue-500" />
                <StatCard title="סה״כ לתשלום למעבדה" value={`₪${overallStats.totalLabPayment.toLocaleString()}`} icon={HandCoins} color="text-orange-500" />
                <StatCard title="סה״כ רווח נקי" value={`₪${overallStats.totalNetProfit.toLocaleString()}`} icon={TrendingUp} color="text-green-500" />
                <StatCard title="סה״כ תיקונים" value={overallStats.totalRepairs} icon={Package} color="text-indigo-500" />
            </div>

            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle>פירוט תיקונים לפי חודש</CardTitle>
                </CardHeader>
                <CardContent>
                    {sortedMonths.length === 0 ? (
                         <div className="text-center py-10 text-gray-500">
                             {isTechnician ? 
                                 "אין תיקונים סגורים להצגה. תיקונים יופיעו כאן לאחר שתסיים אותם ותסגור אותם." :
                                 "אין תיקונים סגורים להצגה."}
                         </div>
                    ) : (
                        <Accordion type="single" collapsible className="w-full">
                            {sortedMonths.map(monthKey => (
                                <AccordionItem key={monthKey} value={monthKey}>
                                    <AccordionTrigger className="glass-card px-4 py-3 rounded-lg text-lg font-semibold">
                                        <div className="flex flex-col items-start gap-1">
                                            <span>{format(parseISO(monthKey + '-01'), 'MMMM yyyy', { locale: he })}</span>
                                            <div className="flex gap-4 text-sm">
                                                <span className="text-blue-600">הכנסות: ₪{monthlyData[monthKey].totalRevenue.toLocaleString()}</span>
                                                <span className="text-orange-600">למעבדה: ₪{monthlyData[monthKey].totalLabPayment.toLocaleString()}</span>
                                                <span className="text-green-600">רווח נקי: ₪{monthlyData[monthKey].totalNetProfit.toLocaleString()}</span>
                                            </div>
                                        </div>
                                    </AccordionTrigger>
                                    <AccordionContent className="p-2">
                                        <div className="overflow-x-auto">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>מס׳ תיקון</TableHead>
                                                        <TableHead>לקוח</TableHead>
                                                        <TableHead>טכנאי</TableHead>
                                                        <TableHead className="text-right">הכנסה</TableHead>
                                                        <TableHead className="text-right">עלות חלק</TableHead>
                                                        <TableHead className="text-right">רווח גולמי</TableHead>
                                                        <TableHead className="text-right font-bold text-orange-700">תשלום למעבדה</TableHead>
                                                        <TableHead className="text-right font-bold text-green-700">רווח נקי</TableHead>
                                                        {isManager && <TableHead>פעולות</TableHead>}
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {monthlyData[monthKey].repairs.map(repair => {
                                                        const isEditing = editingRepairId === repair.id;
                                                        const finalPrice = isEditing ? parseFloat(editValues.final_price) : (repair.final_price || 0);
                                                        const partCost = isEditing ? parseFloat(editValues.part_cost) : (repair.part_cost || 0);
                                                        const grossProfit = finalPrice - partCost;
                                                        const labPayment = (grossProfit / 2) + partCost;
                                                        const netProfit = finalPrice - labPayment;
                                                        
                                                        return (
                                                            <TableRow key={repair.id}>
                                                                <TableCell className="font-mono">{repair.repair_id}</TableCell>
                                                                <TableCell>{repair.customer?.full_name || "N/A"}</TableCell>
                                                                <TableCell>{repair.technician?.employee_name || "N/A"}</TableCell>
                                                                <TableCell className="text-right">
                                                                    {isEditing ? (
                                                                        <Input
                                                                            type="number"
                                                                            value={editValues.final_price}
                                                                            onChange={(e) => setEditValues({...editValues, final_price: e.target.value})}
                                                                            className="w-24"
                                                                        />
                                                                    ) : (
                                                                        `₪${finalPrice.toLocaleString()}`
                                                                    )}
                                                                </TableCell>
                                                                <TableCell className="text-right">
                                                                    {isEditing ? (
                                                                        <Input
                                                                            type="number"
                                                                            value={editValues.part_cost}
                                                                            onChange={(e) => setEditValues({...editValues, part_cost: e.target.value})}
                                                                            className="w-24"
                                                                        />
                                                                    ) : (
                                                                        `₪${partCost.toLocaleString()}`
                                                                    )}
                                                                </TableCell>
                                                                <TableCell className="text-right">₪{grossProfit.toLocaleString()}</TableCell>
                                                                <TableCell className="text-right font-bold text-orange-600">
                                                                    ₪{labPayment.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                </TableCell>
                                                                <TableCell className="text-right font-bold text-green-600">
                                                                    ₪{netProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                </TableCell>
                                                                {isManager && (
                                                                    <TableCell>
                                                                        {isEditing ? (
                                                                            <div className="flex gap-2">
                                                                                <Button size="icon" variant="ghost" onClick={() => handleSave(repair)}>
                                                                                    <Save className="w-4 h-4 text-green-600" />
                                                                                </Button>
                                                                                <Button size="icon" variant="ghost" onClick={handleCancel}>
                                                                                    <X className="w-4 h-4 text-red-600" />
                                                                                </Button>
                                                                            </div>
                                                                        ) : (
                                                                            <Button size="icon" variant="ghost" onClick={() => handleEdit(repair)}>
                                                                                <Edit className="w-4 h-4 text-blue-600" />
                                                                            </Button>
                                                                        )}
                                                                    </TableCell>
                                                                )}
                                                            </TableRow>
                                                        );
                                                    })}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            ))}
                        </Accordion>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
