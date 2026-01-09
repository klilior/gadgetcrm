import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
    Phone, Search, Filter, RefreshCw, CheckCircle, 
    XCircle, Clock, User, Calendar
} from "lucide-react";
import { format } from "date-fns";
import ContractDetailModal from "../components/lines/ContractDetailModal";

export default function LinesToWorkOn() {
    const { currentUser } = useUser();
    const [contracts, setContracts] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedContract, setSelectedContract] = useState(null);
    
    // Filters
    const [viewMode, setViewMode] = useState("all_agents"); // my_portfolio | all_agents
    const [statusFilter, setStatusFilter] = useState("all"); // all מראה את הכל בברירת מחדל
    const [carrierFilter, setCarrierFilter] = useState("all");
    const [agentFilter, setAgentFilter] = useState("all");
    
    const [carriers, setCarriers] = useState([]);
    const [agents, setAgents] = useState([]);

    const isManager = currentUser?.role === 'מנהל';

    useEffect(() => {
        loadData();
        loadFilters();
    }, []);

    useEffect(() => {
        loadData();
    }, [viewMode, statusFilter, carrierFilter, agentFilter]);

    const loadFilters = async () => {
        try {
            const [carrierPolicies, agentsList] = await Promise.all([
                base44.entities.CarrierPolicy.filter({ is_active: true }),
                base44.entities.LinetUsersMap.list(null, 100)
            ]);
            setCarriers(carrierPolicies);
            setAgents(agentsList);
        } catch (error) {
            console.error("Error loading filters:", error);
        }
    };

    const loadData = async () => {
        setIsLoading(true);
        try {
            let query = {};
            
            // View mode filter
            if (viewMode === "my_portfolio") {
                query.account_owner_id = currentUser.id;
            }
            
            // Status filter - ברירת מחדל מראה הכל
            if (statusFilter === "eligible") {
                query.status = { $in: ['ELIGIBLE', 'IN_PROGRESS'] };
                query.$or = [
                    { snooze_until: null },
                    { snooze_until: { $lte: new Date().toISOString() } }
                ];
            } else if (statusFilter !== "all") {
                query.status = statusFilter.toUpperCase();
            }
            // אם statusFilter === "all" - לא מוסיפים שום תנאי סטטוס
            
            // Carrier filter
            if (carrierFilter !== "all") {
                query.carrier_code = carrierFilter;
            }
            
            // Agent filter (for manager view)
            if (viewMode === "all_agents" && agentFilter !== "all") {
                query.account_owner_id = agentFilter;
            }

            const data = await base44.entities.LineContract.filter(query, '-created_date', 1000);
            console.log('📊 טעון:', data.length, 'חוזים');
            setContracts(data);
        } catch (error) {
            console.error("Error loading contracts:", error);
        } finally {
            setIsLoading(false);
        }
    };

    // Search filtering
    const filteredContracts = useMemo(() => {
        let list = contracts;

        // Filter orphaned contracts (no current agent) when selected
        if (agentFilter === 'none') {
            const knownIds = new Set(agents.map(a => a.user_id));
            list = list.filter(c => !c.account_owner_id || !knownIds.has(c.account_owner_id));
        }

        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            list = list.filter(c => 
                c.customer_name?.toLowerCase().includes(term) ||
                c.customer_phone?.includes(term) ||
                c.customer_id_number?.includes(term) ||
                c.msisdn?.includes(term)
            );
        }
        return list;
    }, [contracts, searchTerm, agentFilter, agents]);

    const getStatusBadge = (status) => {
        const configs = {
            LOCKED: { label: 'נעול', color: 'bg-gray-500' },
            ELIGIBLE: { label: 'זמין לטיפול', color: 'bg-green-500' },
            IN_PROGRESS: { label: 'בטיפול', color: 'bg-blue-500' },
            RETAINED: { label: 'נשמר', color: 'bg-purple-500' },
            LOST: { label: 'אבד', color: 'bg-red-500' }
        };
        const config = configs[status] || configs.ELIGIBLE;
        return <Badge className={`${config.color} text-white`}>{config.label}</Badge>;
    };

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        try {
            return format(new Date(dateString), 'dd/MM/yyyy');
        } catch {
            return dateString;
        }
    };

    return (
        <div className="p-4 md:p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
                        <Phone className="w-8 h-8 text-indigo-600" />
                        קווים לטיפול
                    </h1>
                    <p className="text-gray-600 mt-1">
                        {filteredContracts.length} חוזים 
                        {viewMode === "my_portfolio" ? " בתיק שלי" : " בסך הכל"}
                    </p>
                </div>
                <Button onClick={loadData} disabled={isLoading} variant="outline">
                    <RefreshCw className={`w-4 h-4 ml-2 ${isLoading ? 'animate-spin' : ''}`} />
                    רענן
                </Button>
            </div>

            {/* Filters & Search */}
            <Card className="glass-card border-0">
                <CardContent className="p-4 space-y-4">
                    {/* Search Bar */}
                    <div className="relative">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <Input
                            placeholder="חיפוש לפי שם, טלפון, ת.ז., או מספר קו..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pr-10 text-lg"
                        />
                    </div>

                    {/* Filters Row */}
                    <div className="flex flex-wrap gap-4">
                        {isManager && (
                            <Select value={viewMode} onValueChange={setViewMode}>
                                <SelectTrigger className="w-40">
                                    <User className="w-4 h-4 ml-2" />
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="my_portfolio">התיק שלי</SelectItem>
                                    <SelectItem value="all_agents">כל הנציגים</SelectItem>
                                </SelectContent>
                            </Select>
                        )}

                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-40">
                                <Filter className="w-4 h-4 ml-2" />
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="eligible">זמין לטיפול</SelectItem>
                                <SelectItem value="in_progress">בטיפול</SelectItem>
                                <SelectItem value="retained">נשמרו</SelectItem>
                                <SelectItem value="lost">אבדו</SelectItem>
                                <SelectItem value="all">הכל</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={carrierFilter} onValueChange={setCarrierFilter}>
                            <SelectTrigger className="w-40">
                                <SelectValue placeholder="כל הספקים" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">כל הספקים</SelectItem>
                                {carriers.map(c => (
                                    <SelectItem key={c.carrier_code} value={c.carrier_code}>
                                        {c.carrier_name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {viewMode === "all_agents" && (
                            <Select value={agentFilter} onValueChange={setAgentFilter}>
                                <SelectTrigger className="w-40">
                                    <SelectValue placeholder="כל הנציגים" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">כל הנציגים</SelectItem>
                                    <SelectItem value="none">ללא נציג</SelectItem>
                                    {agents.map(a => (
                                        <SelectItem key={a.user_id} value={a.user_id}>
                                            {a.user_name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}

                        {(searchTerm || statusFilter !== "eligible" || carrierFilter !== "all" || agentFilter !== "all") && (
                            <Button 
                                variant="ghost" 
                                onClick={() => {
                                    setSearchTerm("");
                                    setStatusFilter("eligible");
                                    setCarrierFilter("all");
                                    setAgentFilter("all");
                                }}
                            >
                                נקה סינון
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Contracts Table */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle>רשימת קווים ({filteredContracts.length})</CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="text-center py-12">
                            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                        </div>
                    ) : filteredContracts.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <Phone className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>לא נמצאו קווים התואמים לסינון</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>לקוח</TableHead>
                                        <TableHead>טלפון</TableHead>
                                        <TableHead>מספר קו</TableHead>
                                        <TableHead>ספק</TableHead>
                                        <TableHead>תאריך הפעלה</TableHead>
                                        <TableHead>זמין לחידוש</TableHead>
                                        <TableHead>סטטוס</TableHead>
                                        {viewMode === "all_agents" && <TableHead>בעלים</TableHead>}
                                        <TableHead>פעולה אחרונה</TableHead>
                                        <TableHead>פעולות</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredContracts.map((contract) => (
                                        <TableRow key={contract.id} className="hover:bg-gray-50">
                                            <TableCell className="font-medium">{contract.customer_name}</TableCell>
                                            <TableCell className="font-mono text-sm">{contract.customer_phone || '-'}</TableCell>
                                            <TableCell className="font-mono text-sm">{contract.msisdn || '-'}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline">{contract.carrier_name}</Badge>
                                            </TableCell>
                                            <TableCell className="text-sm">{formatDate(contract.activation_date)}</TableCell>
                                            <TableCell className="text-sm">{formatDate(contract.safe_retarget_date)}</TableCell>
                                            <TableCell>{getStatusBadge(contract.status)}</TableCell>
                                            {viewMode === "all_agents" && (
                                                <TableCell className="text-sm">
                                                    {(!contract.account_owner_id || !agents.some(a => a.user_id === contract.account_owner_id)) 
                                                        ? '-' 
                                                        : (contract.account_owner_name || '-')}
                                                </TableCell>
                                            )}
                                            <TableCell className="text-xs text-gray-500">
                                                {contract.last_action_type || '-'}
                                            </TableCell>
                                            <TableCell>
                                                <Button
                                                    size="sm"
                                                    onClick={() => setSelectedContract(contract)}
                                                    className="bg-indigo-600 hover:bg-indigo-700"
                                                >
                                                    טפל
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Contract Detail Modal */}
            {selectedContract && (
                <ContractDetailModal
                    isOpen={!!selectedContract}
                    onClose={() => setSelectedContract(null)}
                    contract={selectedContract}
                    onUpdate={loadData}
                    currentUser={currentUser}
                />
            )}
        </div>
    );
}