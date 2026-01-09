import React, { useState, useEffect, useCallback } from "react";
import { Repair, Client, RepairDevice, RepairVendor, RepairLog } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Wrench, Package, AlertTriangle, Clock, Search, Filter, Plus,
  CheckCircle, XCircle, Settings as SettingsIcon, Truck, X, Trash2, Loader2
} from "lucide-react";
import { format, isAfter, differenceInDays } from "date-fns";
import { Repair as RepairEntity } from "@/entities/all";
import RepairDetailsModal from "../components/repairs/RepairDetailsModal";
import NewRepairModal from "../components/repairs/NewRepairModal";
import { useUser } from "../components/UserAuth";
import { customersService } from "../components/utils/customersService";

const StatCard = ({ title, value, icon: Icon, color, onClick }) => (
  <div
    onClick={onClick}
    className={`glass-card p-6 rounded-2xl flex-1 ${onClick ? 'cursor-pointer hover:shadow-xl hover:scale-105 transition-all duration-300' : ''}`}
  >
    <div className="flex justify-between items-center">
      <h3 className="text-lg font-medium text-gray-700">{title}</h3>
      <Icon className={`w-8 h-8 ${color}`} />
    </div>
    <p className="text-4xl font-bold mt-4 text-gray-900">{value}</p>
  </div>
);

export default function RepairDashboard() {
    const { currentUser } = useUser();
    const [repairs, setRepairs] = useState([]);
    const [stats, setStats] = useState({
        openLab: 0,
        openImporter: 0,
        readyForPickup: 0,
        slaBreached: 0,
        orderedParts: 0
    });
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [quickFilter, setQuickFilter] = useState(null);
    const [selectedRepair, setSelectedRepair] = useState(null);
    const [showNewRepairModal, setShowNewRepairModal] = useState(false);

    // New states for bulk delete
    const [selectedRepairs, setSelectedRepairs] = useState([]);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const isManager = currentUser?.role === "מנהל";
    const isTechnicianRole = currentUser?.role === "טכנאי";

    const getSlaStatus = (repair) => {
        if (!repair.sla_due) return { isBreached: false, daysRemaining: null };
        const dueDate = new Date(repair.sla_due);
        const today = new Date();
        const isBreached = isAfter(today, dueDate);
        const daysRemaining = differenceInDays(dueDate, today);
        return { isBreached, daysRemaining };
    };

    const getStatusBadgeProps = (status) => {
        const configs = {
            'בטיפול/אבחון': { style: { backgroundColor: '#2563EB', color: 'white' }, icon: <SettingsIcon className="w-3 h-3" /> },
            'בטיפול החנות': { style: { backgroundColor: '#1D4ED8', color: 'white' }, icon: <SettingsIcon className="w-3 h-3" /> },
            'הוזמן חלק': { style: { backgroundColor: '#7C3AED', color: 'white' }, icon: <Package className="w-3 h-3" /> },
            'מכשיר סיים תיקון וממתין לאיסוף': { style: { backgroundColor: '#059669', color: 'white' }, icon: <CheckCircle className="w-3 h-3" /> },
            'לא ניתן לתיקון': { style: { backgroundColor: '#991B1B', color: 'white' }, icon: <XCircle className="w-3 h-3" /> },
            'תיקון נסגר': { style: { backgroundColor: '#6B7280', color: 'white' }, icon: <XCircle className="w-3 h-3" /> },
            'To_Importer': { style: { backgroundColor: '#DC2626', color: 'white' }, icon: <Truck className="w-3 h-3" /> },
            'At_Importer': { style: { backgroundColor: '#B91C1C', color: 'white' }, icon: <Truck className="w-3 h-3" /> },
            'Back_From_Importer': { style: { backgroundColor: '#7C3AED', color: 'white' }, icon: <Truck className="w-3 h-3" /> },
        };

        const defaultBadge = { style: { backgroundColor: '#2563EB', color: 'white' }, icon: <AlertTriangle className="w-3 h-3" /> };

        if (status === 'בטיפול' || status === 'In_Diagnosis' || status === 'In_Repair') {
            return configs['בטיפול/אבחון'];
        }
        if (status === 'QA' || status === 'Ready') {
            return configs['מכשיר סיים תיקון וממתין לאיסוף'];
        }
        if (status === 'Closed' || status === 'Return_Unrepaired') {
            return configs['תיקון נסגר'];
        }
        // Explicitly return for the new status if it doesn't match an existing alias
        if (status === 'בטיפול החנות') {
            return configs['בטיפול החנות'];
        }

        return configs[status] || defaultBadge;
    };

    const loadData = useCallback(async () => {
        console.log("🔵 RepairDashboard: Starting loadData...");
        setIsLoading(true);
        try {
            // STEP 1: Load repairs FIRST and show them immediately (fastest path to content)
            let repairsData;
            if (isTechnicianRole) {
                repairsData = await Repair.filter({
                    repair_type: "מעבדת Gadget-Team"
                }, "-updated_date", 200).catch(err => {
                    console.error("❌ Error loading repairs for technician:", err);
                    return [];
                });
            } else {
                repairsData = await Repair.filter({}, "-updated_date", 200).catch(err => {
                    console.error("❌ Error loading all repairs:", err);
                    return [];
                });
            }

            console.log(`✅ Loaded ${repairsData.length} repairs`);

            // Show repairs immediately WITHOUT enrichment
            setRepairs(repairsData.map(r => ({ ...r, customer: null, device: null, vendor: null })));
            setSelectedRepairs([]);
            setIsLoading(false); // Table is now visible!

            // Calculate stats from raw data (no enrichment needed for stats)
            const nonOpenStatuses = [
                "תיקון נסגר", "לא ניתן לתיקון", "מכשיר סיים תיקון וממתין לאיסוף",
                "Closed", "Return_Unrepaired", "Ready"
            ];

            if (isTechnicianRole) {
                setStats({
                    openLab: repairsData.filter(r => !nonOpenStatuses.includes(r.status) && r.status !== 'הוזמן חלק').length,
                    orderedParts: repairsData.filter(r => r.status === 'הוזמן חלק').length,
                    slaBreached: repairsData.filter(r => getSlaStatus(r).isBreached && !nonOpenStatuses.includes(r.status)).length,
                    openImporter: 0,
                    readyForPickup: 0
                });
            } else {
                setStats({
                    openLab: repairsData.filter(r => r.repair_type === 'מעבדת Gadget-Team' && !nonOpenStatuses.includes(r.status)).length,
                    openImporter: repairsData.filter(r => ["To_Importer", "At_Importer", "Back_From_Importer"].includes(r.status)).length,
                    readyForPickup: repairsData.filter(r => r.status === "מכשיר סיים תיקון וממתין לאיסוף" || r.status === "Ready").length,
                    slaBreached: repairsData.filter(r => getSlaStatus(r).isBreached && !nonOpenStatuses.includes(r.status)).length,
                    orderedParts: 0
                });
            }

            // STEP 2: Load enrichment data in BACKGROUND (non-blocking)
            // Extract unique IDs to minimize queries
            const clientIds = [...new Set(repairsData.map(r => r.client_id).filter(Boolean))];
            const deviceIds = [...new Set(repairsData.map(r => r.device_id).filter(Boolean))];
            const vendorIds = [...new Set(repairsData.map(r => r.vendor_id).filter(Boolean))];

            // Load only what we need in parallel
            const [clientsData, devicesData, vendorsData] = await Promise.all([
                customersService.list().catch(() => []),
                deviceIds.length > 0 ? RepairDevice.list().catch(() => []) : Promise.resolve([]),
                vendorIds.length > 0 ? RepairVendor.filter({ active: true }).catch(() => []) : Promise.resolve([])
            ]);

            const clientsMap = clientsData.reduce((acc, c) => ({ ...acc, [c.id]: c }), {});
            const devicesMap = devicesData.reduce((acc, d) => ({ ...acc, [d.id]: d }), {});
            const vendorsMap = vendorsData.reduce((acc, v) => ({ ...acc, [v.id]: v }), {});

            // STEP 3: Update with enriched data (seamless update)
            const enrichedRepairs = repairsData.map(repair => ({
                ...repair,
                customer: clientsMap[repair.client_id] || null,
                device: devicesMap[repair.device_id] || null,
                vendor: vendorsMap[repair.vendor_id] || null
            }));

            setRepairs(enrichedRepairs);
            console.log("✅ RepairDashboard: loadData completed with enrichment");

        } catch (error) {
            console.error("❌ Error loading dashboard data:", error);
            setIsLoading(false);
        }
    }, [isTechnicianRole]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const filteredRepairs = repairs.filter(repair => {
        const matchesSearch = searchTerm === "" ||
            repair.repair_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            repair.customer?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            repair.customer?.phone?.includes(searchTerm) ||
            repair.device?.model?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            repair.device?.serial_imei?.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesStatus = statusFilter === "all" || repair.status === statusFilter;

        // סינון מהיר מהסיכום
        let matchesQuickFilter = true;
        if (quickFilter) {
            const nonOpenStatuses = ["תיקון נסגר", "לא ניתן לתיקון", "מכשיר סיים תיקון וממתין לאיסוף", "Closed", "Return_Unrepaired", "Ready"];

            switch (quickFilter) {
                case 'openLab':
                    matchesQuickFilter = repair.repair_type === 'מעבדת Gadget-Team' &&
                                       !nonOpenStatuses.includes(repair.status) &&
                                       repair.status !== 'הוזמן חלק';
                    break;
                case 'orderedParts':
                    matchesQuickFilter = repair.status === 'הוזמן חלק';
                    break;
                case 'openImporter':
                    matchesQuickFilter = ["To_Importer", "At_Importer", "Back_From_Importer"].includes(repair.status);
                    break;
                case 'readyForPickup':
                    matchesQuickFilter = repair.status === "מכשיר סיים תיקון וממתין לאיסוף" || repair.status === "Ready";
                    break;
                case 'slaBreached':
                    matchesQuickFilter = getSlaStatus(repair).isBreached && !nonOpenStatuses.includes(repair.status);
                    break;
                default:
                    matchesQuickFilter = true;
            }
        }

        return matchesSearch && matchesStatus && matchesQuickFilter;
    });

    const formatDate = (dateString) => {
        try {
            return format(new Date(dateString), "dd/MM/yyyy");
        } catch (error) {
            return "תאריך לא תקין";
        }
    };

    // Extract short repair number (last 4 digits from REP-YYYYMMDD-XXXX format)
    const getShortRepairId = (repairId) => {
        if (!repairId) return '----';
        // Extract last 4 digits after the last dash
        const parts = repairId.split('-');
        if (parts.length >= 3) {
            return parts[parts.length - 1]; // Returns the last part (e.g., "4255")
        }
        // If format is different, try to extract last 4 digits
        const match = repairId.match(/(\d{4})$/);
        return match ? match[1] : repairId.slice(-4);
    };

    // Handle inline status change
    const handleStatusChange = async (repair, newStatus) => {
        try {
            await Repair.update(repair.id, { status: newStatus });
            // Update local state
            setRepairs(prev => prev.map(r => 
                r.id === repair.id ? { ...r, status: newStatus } : r
            ));
        } catch (error) {
            console.error("Error updating status:", error);
            alert("שגיאה בעדכון סטטוס");
        }
    };

    const handleRepairSelect = (repair) => {
        setSelectedRepair(repair);
    };

    const renderSlaCell = (repair) => {
        const slaStatus = getSlaStatus(repair);
        if (!slaStatus.daysRemaining && !slaStatus.isBreached) return null;

        if (slaStatus.isBreached) {
            return (
                <Badge className="bg-red-500 text-white text-xs">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    חריגת SLA
                </Badge>
            );
        }

        if (slaStatus.daysRemaining <= 1) {
            return (
                <Badge className="bg-orange-500 text-white text-xs">
                    <Clock className="w-3 h-3 mr-1" />
                    יום {slaStatus.daysRemaining}
                </Badge>
            );
        }

        return (
            <Badge variant="outline" className="text-xs">
                {slaStatus.daysRemaining} ימים
            </Badge>
        );
    };

    // New functions for bulk selection
    const handleSelectRepair = (repairId) => {
        setSelectedRepairs(prev => {
            if (prev.includes(repairId)) {
                return prev.filter(id => id !== repairId);
            } else {
                return [...prev, repairId];
            }
        });
    };

    const handleSelectAll = () => {
        if (selectedRepairs.length === filteredRepairs.length && filteredRepairs.length > 0) {
            setSelectedRepairs([]);
        } else {
            setSelectedRepairs(filteredRepairs.map(r => r.id));
        }
    };

    const handleBulkDelete = async () => {
        setIsDeleting(true);
        try {
            // Delete all logs for selected repairs
            for (const repairId of selectedRepairs) {
                const logs = await RepairLog.filter({ repair_id: repairId }); // Assuming RepairLog has a filter method
                for (const log of logs) {
                    await RepairLog.delete(log.id);
                }
            }

            // Delete all selected repairs
            for (const repairId of selectedRepairs) {
                await Repair.delete(repairId);
            }

            alert(`✅ נמחקו ${selectedRepairs.length} תיקונים בהצלחה!`);
            setSelectedRepairs([]);
            setShowDeleteConfirm(false);
            await loadData(); // Reload data after deletion
        } catch (error) {
            console.error("❌ Error deleting repairs:", error);
            alert("שגיאה במחיקת תיקונים. נסה שוב.");
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-3">
                    <Wrench className="w-8 h-8 text-purple-600" />
                    דשבורד תיקונים
                </h1>
                <div className="flex gap-2">
                    {isManager && selectedRepairs.length > 0 && (
                        <Button
                            onClick={() => setShowDeleteConfirm(true)}
                            className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg shadow-lg"
                        >
                            <Trash2 className="w-4 h-4 ml-2" />
                            מחק {selectedRepairs.length} נבחרים
                        </Button>
                    )}
                    <Button onClick={() => setShowNewRepairModal(true)} className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg shadow-lg">
                        <Plus className="w-4 h-4 ml-2" />
                        תיקון חדש
                    </Button>
                </div>
            </div>

            {isTechnicianRole ? (
                // Technician stats - 3 cards
                <div className="flex flex-col sm:flex-row gap-4">
                    <StatCard
                        title="פתוחים במעבדה"
                        value={stats.openLab}
                        icon={Wrench}
                        color="text-blue-500"
                        onClick={() => setQuickFilter(quickFilter === 'openLab' ? null : 'openLab')}
                    />
                    <StatCard
                        title="הוזמן חלק"
                        value={stats.orderedParts}
                        icon={Package}
                        color="text-purple-500"
                        onClick={() => setQuickFilter(quickFilter === 'orderedParts' ? null : 'orderedParts')}
                    />
                    <StatCard
                        title="חריגות SLA"
                        value={stats.slaBreached}
                        icon={AlertTriangle}
                        color="text-red-500"
                        onClick={() => setQuickFilter(quickFilter === 'slaBreached' ? null : 'slaBreached')}
                    />
                </div>
            ) : (
                // Manager/Representative stats - 4 cards
                <div className="flex flex-col sm:flex-row gap-4">
                    <StatCard
                        title="פתוחים במעבדה"
                        value={stats.openLab}
                        icon={Wrench}
                        color="text-blue-500"
                        onClick={() => setQuickFilter(quickFilter === 'openLab' ? null : 'openLab')}
                    />
                    <StatCard
                        title="אצל יבואנים"
                        value={stats.openImporter}
                        icon={Truck}
                        color="text-orange-500"
                        onClick={() => setQuickFilter(quickFilter === 'openImporter' ? null : 'openImporter')}
                    />
                    <StatCard
                        title="מוכנים לאיסוף"
                        value={stats.readyForPickup}
                        icon={CheckCircle}
                        color="text-green-500"
                        onClick={() => setQuickFilter(quickFilter === 'readyForPickup' ? null : 'readyForPickup')}
                    />
                    <StatCard
                        title="חריגות SLA"
                        value={stats.slaBreached}
                        icon={AlertTriangle}
                        color="text-red-500"
                        onClick={() => setQuickFilter(quickFilter === 'slaBreached' ? null : 'slaBreached')}
                    />
                </div>
            )}

            {quickFilter && (
                <div className="flex items-center gap-2 bg-blue-50 p-3 rounded-lg">
                    <Filter className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-900">
                        מציג סינון: {
                            quickFilter === 'openLab' ? 'פתוחים במעבדה' :
                            quickFilter === 'orderedParts' ? 'הוזמן חלק' :
                            quickFilter === 'openImporter' ? 'אצל יבואנים' :
                            quickFilter === 'readyForPickup' ? 'מוכנים לאיסוף' :
                            'חריגות SLA'
                        }
                    </span>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setQuickFilter(null)}
                        className="mr-auto"
                    >
                        <X className="w-4 h-4" />
                        נקה סינון
                    </Button>
                </div>
            )}

            <div className="flex flex-col sm:flex-row gap-4 mb-6">
                <div className="relative flex-1">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <Input
                        placeholder="חיפוש לפי מס׳ תיקון, לקוח, טלפון או מכשיר..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="glass-button pr-10"
                    />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-48 glass-button">
                        <Filter className="w-4 h-4 ml-2" />
                        <SelectValue placeholder="סינון לפי סטטוס" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">כל הסטטוסים</SelectItem>
                        <SelectItem value="בטיפול/אבחון">בטיפול/אבחון</SelectItem>
                        <SelectItem value="בטיפול החנות">בטיפול החנות</SelectItem> {/* New filter option */}
                        <SelectItem value="הוזמן חלק">הוזמן חלק</SelectItem>
                        <SelectItem value="מכשיר סיים תיקון וממתין לאיסוף">מוכן לאיסוף</SelectItem>
                        <SelectItem value="At_Importer">אצל היבואן</SelectItem>
                        <SelectItem value="Back_From_Importer">חזר מהיבואן</SelectItem>
                        <SelectItem value="תיקון נסגר">נסגר</SelectItem>
                        <SelectItem value="לא ניתן לתיקון">לא ניתן לתיקון</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle>רשימת תיקונים ({filteredRepairs.length})</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto hidden md:block">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    {isManager && (
                                        <TableHead className="w-12">
                                            <Checkbox
                                                checked={selectedRepairs.length === filteredRepairs.length && filteredRepairs.length > 0}
                                                onCheckedChange={handleSelectAll}
                                            />
                                        </TableHead>
                                    )}
                                    <TableHead>מס׳</TableHead>
                                    <TableHead>לקוח</TableHead>
                                    <TableHead>מכשיר</TableHead>
                                    <TableHead>סוג תיקון</TableHead>
                                    <TableHead>סטטוס</TableHead>
                                    <TableHead>תאריך קבלה</TableHead>
                                    <TableHead>SLA</TableHead>
                                    <TableHead>פעולות</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    Array(5).fill(0).map((_, i) => (
                                        <TableRow key={i}>
                                            {isManager && <TableCell className="animate-pulse"><div className="h-4 w-4 rounded bg-gray-200"></div></TableCell>}
                                            <TableCell className="animate-pulse"><div className="h-4 w-20 rounded bg-gray-200"></div></TableCell>
                                            <TableCell className="animate-pulse"><div className="h-4 w-24 rounded bg-gray-200"></div></TableCell>
                                            <TableCell className="animate-pulse"><div className="h-4 w-32 rounded bg-gray-200"></div></TableCell>
                                            <TableCell className="animate-pulse"><div className="h-4 w-28 rounded bg-gray-200"></div></TableCell>
                                            <TableCell className="animate-pulse"><div className="h-6 w-24 rounded-full bg-gray-200"></div></TableCell>
                                            <TableCell className="animate-pulse"><div className="h-4 w-20 rounded bg-gray-200"></div></TableCell>
                                            <TableCell className="animate-pulse"><div className="h-4 w-16 rounded bg-gray-200"></div></TableCell>
                                            <TableCell className="animate-pulse"><div className="h-8 w-16 rounded bg-gray-200"></div></TableCell>
                                        </TableRow>
                                    ))
                                ) : filteredRepairs.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={isManager ? "9" : "8"} className="text-center py-10 text-gray-500">
                                            לא נמצאו תיקונים התואמים לסינון.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredRepairs.map((repair) => {
                                        const { style: badgeStyle, icon: statusIcon } = getStatusBadgeProps(repair.status);
                                        return (
                                            <TableRow key={repair.id} className="cursor-pointer hover:bg-white/50">
                                                {isManager && (
                                                    <TableCell onClick={(e) => e.stopPropagation()}>
                                                        <Checkbox
                                                            checked={selectedRepairs.includes(repair.id)}
                                                            onCheckedChange={() => handleSelectRepair(repair.id)}
                                                        />
                                                    </TableCell>
                                                )}
                                                <TableCell onClick={() => handleRepairSelect(repair)} className="font-mono text-sm font-bold text-purple-700">
                                                    {getShortRepairId(repair.repair_id)}
                                                </TableCell>
                                                <TableCell onClick={() => handleRepairSelect(repair)}>
                                                    <div>
                                                        <div className="font-medium">{repair.customer?.full_name || 'לקוח לא ידוע'}</div>
                                                        <div className="text-xs text-gray-500">{repair.customer?.phone || ''}</div>
                                                    </div>
                                                </TableCell>
                                                <TableCell onClick={() => handleRepairSelect(repair)}>
                                                    <div>
                                                        <div className="font-medium">{repair.device ? `${repair.device.manufacturer || ''} ${repair.device.model || ''}` : 'מכשיר לא ידוע'}</div>
                                                        <div className="text-xs text-gray-500 font-mono">{repair.device?.serial_imei || ''}</div>
                                                    </div>
                                                </TableCell>
                                                <TableCell onClick={() => handleRepairSelect(repair)}>
                                                    <div>
                                                        <div className="font-medium">{repair.repair_type || 'לא ידוע'}</div>
                                                        {repair.repair_type === 'מעבדת יבואן' && repair.vendor && (
                                                            <div className="text-xs text-gray-500">{repair.vendor.name}</div>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell onClick={(e) => e.stopPropagation()}>
                                                    <Select
                                                        value={repair.status}
                                                        onValueChange={(newStatus) => handleStatusChange(repair, newStatus)}
                                                    >
                                                        <SelectTrigger className="w-auto min-w-[140px] h-8 border-0 p-0">
                                                            <Badge style={badgeStyle} className="text-xs flex items-center gap-1 w-fit cursor-pointer">
                                                                {statusIcon}
                                                                {repair.status}
                                                            </Badge>
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="בטיפול/אבחון">בטיפול/אבחון</SelectItem>
                                                            <SelectItem value="בטיפול החנות">בטיפול החנות</SelectItem>
                                                            <SelectItem value="הוזמן חלק">הוזמן חלק</SelectItem>
                                                            <SelectItem value="מכשיר סיים תיקון וממתין לאיסוף">מוכן לאיסוף</SelectItem>
                                                            <SelectItem value="At_Importer">אצל היבואן</SelectItem>
                                                            <SelectItem value="Back_From_Importer">חזר מהיבואן</SelectItem>
                                                            <SelectItem value="לא ניתן לתיקון">לא ניתן לתיקון</SelectItem>
                                                            <SelectItem value="תיקון נסגר">תיקון נסגר</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </TableCell>
                                                <TableCell onClick={() => handleRepairSelect(repair)} className="text-sm">
                                                    {formatDate(repair.created_date)}
                                                </TableCell>
                                                <TableCell onClick={() => handleRepairSelect(repair)}>
                                                    {renderSlaCell(repair)}
                                                </TableCell>
                                                <TableCell>
                                                    <Button
                                                        size="sm"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedRepair(repair);
                                                        }}
                                                        className="text-xs rounded-full"
                                                        style={{ backgroundColor: '#7D0F82', color: 'white' }}
                                                    >
                                                        פתח
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    <div className="space-y-4 md:hidden">
                        {isLoading ? (
                            Array(3).fill(0).map((_, i) => (
                                <div key={i} className="glass-card p-4 animate-pulse h-40 rounded-2xl"></div>
                            ))
                        ) : filteredRepairs.length === 0 ? (
                            <div className="text-center py-10 text-gray-500">
                                לא נמצאו תיקונים התואמים לסינון.
                            </div>
                        ) : (
                            filteredRepairs.map((repair) => {
                                const { style: badgeStyle, icon: statusIcon } = getStatusBadgeProps(repair.status);
                                return (
                                    <Card
                                        key={repair.id}
                                        className="glass-card rounded-2xl overflow-hidden relative"
                                        onClick={() => handleRepairSelect(repair)}
                                    >
                                        <div className="p-4">
                                            {isManager && (
                                                <div className="absolute top-3 right-3" onClick={(e) => e.stopPropagation()}>
                                                    <Checkbox
                                                        checked={selectedRepairs.includes(repair.id)}
                                                        onCheckedChange={() => handleSelectRepair(repair.id)}
                                                    />
                                                </div>
                                            )}
                                            <div className="flex justify-between items-start mb-3">
                                                <div>
                                                    <p className="font-mono text-sm font-bold text-purple-700">{getShortRepairId(repair.repair_id)}</p>
                                                    <h3 className="font-bold text-lg text-gray-900">{repair.customer?.full_name || 'לקוח לא ידוע'}</h3>
                                                </div>
                                                <Badge style={badgeStyle} className="text-xs flex items-center gap-1 w-fit">
                                                    {statusIcon}
                                                    {repair.status}
                                                </Badge>
                                            </div>

                                            <div className="text-sm space-y-2 text-gray-700">
                                                <p><strong>מכשיר:</strong> {repair.device ? `${repair.device.manufacturer || ''} ${repair.device.model || ''}` : 'מכשיר לא ידוע'}</p>
                                                <p><strong>תקלה:</strong> {repair.issue_category || 'לא צוין'}</p>
                                                <p><strong>סוג תיקון:</strong> {repair.repair_type || 'לא ידוע'} {repair.repair_type === 'מעבדת יבואן' && repair.vendor ? ` - ${repair.vendor.name}` : ''}</p>
                                            </div>
                                            <div className="text-xs text-gray-500 pt-2 mt-3 border-t border-gray-200/50 flex justify-between items-center">
                                                <span>תאריך כניסה: {formatDate(repair.created_date)}</span>
                                                {renderSlaCell(repair)}
                                            </div>
                                        </div>
                                    </Card>
                                );
                            })
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60]">
                    <div className="glass-card p-6 rounded-2xl max-w-md w-full mx-4">
                        <div className="flex items-center gap-3 mb-4">
                            <AlertTriangle className="w-8 h-8 text-red-500" />
                            <h3 className="text-xl font-bold text-gray-800">אישור מחיקה</h3>
                        </div>
                        <div className="mb-6">
                            <p className="text-gray-700 mb-2">
                                האם אתה בטוח שברצונך למחוק {selectedRepairs.length} תיקונים?
                            </p>
                            <p className="text-red-600 text-sm font-medium">
                                פעולה זו בלתי הפיכה ותמחק את כל ההיסטוריה של התיקונים!
                            </p>
                        </div>
                        <div className="flex justify-end gap-3">
                            <Button
                                variant="outline"
                                onClick={() => setShowDeleteConfirm(false)}
                                disabled={isDeleting}
                            >
                                ביטול
                            </Button>
                            <Button
                                onClick={handleBulkDelete}
                                disabled={isDeleting}
                                className="bg-red-600 hover:bg-red-700 text-white"
                            >
                                {isDeleting ? (
                                    <>
                                        <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                                        מוחק...
                                    </>
                                ) : (
                                    <>
                                        <Trash2 className="w-4 h-4 ml-2" />
                                        מחק {selectedRepairs.length} תיקונים
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {selectedRepair && (
                <RepairDetailsModal
                    isOpen={!!selectedRepair}
                    onClose={() => setSelectedRepair(null)}
                    repair={selectedRepair}
                    onUpdate={() => {
                        console.log("🔵 Repair updated, reloading data...");
                        loadData();
                    }}
                />
            )}

            <NewRepairModal
                isOpen={showNewRepairModal}
                onClose={() => {
                    console.log("🔵 NewRepairModal closed");
                    setShowNewRepairModal(false);
                }}
                onRepairCreated={() => {
                    console.log("🔵 New repair created, reloading data...");
                    return loadData();
                }}
            />
        </div>
    );
}