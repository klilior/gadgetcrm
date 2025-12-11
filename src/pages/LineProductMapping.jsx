import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import UnauthorizedRedirect from "../components/UnauthorizedRedirect";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { 
    Settings, Download, Edit, Save, X, CheckCircle, XCircle, RefreshCw
} from "lucide-react";

const CARRIERS = [
    { code: 'PELEPHONE', name: 'פלאפון' },
    { code: 'PARTNER', name: 'פרטנר' },
    { code: 'HOT_MOBILE', name: 'הוט מובייל' },
    { code: 'CELLCOM', name: 'סלקום' },
    { code: 'GOLAN', name: 'גולן טלקום' },
    { code: 'WE4G', name: 'We4G' }
];

export default function LineProductMapping() {
    const { currentUser } = useUser();
    const [definitions, setDefinitions] = useState([]);
    const [filteredDefs, setFilteredDefs] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingSkus, setIsLoadingSkus] = useState(false);
    
    // Filters
    const [searchTerm, setSearchTerm] = useState("");
    const [lineFilter, setLineFilter] = useState("all"); // all | lines | non_lines
    const [carrierFilter, setCarrierFilter] = useState("all");
    
    // Edit modal
    const [editingDef, setEditingDef] = useState(null);
    const [showEditModal, setShowEditModal] = useState(false);

    const isManager = currentUser?.role === 'מנהל';

    useEffect(() => {
        if (isManager) loadDefinitions();
    }, [isManager]);

    useEffect(() => {
        applyFilters();
    }, [definitions, searchTerm, lineFilter, carrierFilter]);

    const loadDefinitions = async () => {
        setIsLoading(true);
        try {
            const data = await base44.entities.LineProductDefinition.filter(
                { is_active: true },
                'item_sku',
                5000
            );
            setDefinitions(data);
        } catch (error) {
            console.error('Error loading definitions:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const applyFilters = () => {
        let filtered = [...definitions];

        // Search filter
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filtered = filtered.filter(d => 
                d.item_sku?.toLowerCase().includes(term) ||
                d.item_name_sample?.toLowerCase().includes(term)
            );
        }

        // Line filter
        if (lineFilter === "lines") {
            filtered = filtered.filter(d => d.is_line);
        } else if (lineFilter === "non_lines") {
            filtered = filtered.filter(d => !d.is_line);
        }

        // Carrier filter
        if (carrierFilter !== "all") {
            filtered = filtered.filter(d => d.carrier_code === carrierFilter);
        }

        setFilteredDefs(filtered);
    };

    const handleLoadSkus = async () => {
        if (!confirm('טעינת מק״טים חדשים מהבאצ׳ האחרון. להמשיך?')) return;

        setIsLoadingSkus(true);
        try {
            const response = await base44.functions.invoke('loadSkusFromBatch', {});
            
            if (response.data.success) {
                alert(response.data.message);
                await loadDefinitions();
            } else {
                throw new Error(response.data.error);
            }
        } catch (error) {
            console.error('Error loading SKUs:', error);
            alert('שגיאה: ' + error.message);
        } finally {
            setIsLoadingSkus(false);
        }
    };

    const handleEdit = (def) => {
        setEditingDef({ ...def });
        setShowEditModal(true);
    };

    const handleSave = async () => {
        if (!editingDef) return;

        try {
            await base44.entities.LineProductDefinition.update(editingDef.id, {
                is_line: editingDef.is_line,
                carrier_code: editingDef.carrier_code || null,
                churn_window_months: editingDef.churn_window_months || null,
                safety_buffer_days: editingDef.safety_buffer_days || 5
            });

            setShowEditModal(false);
            await loadDefinitions();
        } catch (error) {
            alert('שגיאה בשמירה: ' + error.message);
        }
    };

    const handleQuickToggle = async (def) => {
        try {
            await base44.entities.LineProductDefinition.update(def.id, {
                is_line: !def.is_line
            });
            await loadDefinitions();
        } catch (error) {
            console.error('Error toggling:', error);
        }
    };

    if (!isManager) {
        return <UnauthorizedRedirect currentUser={currentUser} />;
    }

    const linesCount = definitions.filter(d => d.is_line).length;
    const mappedCount = definitions.filter(d => d.is_line && d.carrier_code).length;

    return (
        <div className="p-4 md:p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
                    <Settings className="w-8 h-8 text-indigo-600" />
                    הגדרת מק״טי קווים וחברות סלולר
                </h1>
                <p className="text-gray-600 mt-1">
                    שלב 2: סיווג וקביעת חוקי churn
                </p>
            </div>

            {/* Stats & Actions */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="bg-blue-50">
                    <CardContent className="p-4">
                        <p className="text-sm text-gray-600">סה״כ מק״טים</p>
                        <p className="text-2xl font-bold text-blue-600">{definitions.length}</p>
                    </CardContent>
                </Card>
                <Card className="bg-green-50">
                    <CardContent className="p-4">
                        <p className="text-sm text-gray-600">מסומנים כקווים</p>
                        <p className="text-2xl font-bold text-green-600">{linesCount}</p>
                    </CardContent>
                </Card>
                <Card className="bg-purple-50">
                    <CardContent className="p-4">
                        <p className="text-sm text-gray-600">ממופים לחברה</p>
                        <p className="text-2xl font-bold text-purple-600">{mappedCount}</p>
                    </CardContent>
                </Card>
                <Card className="bg-white">
                    <CardContent className="p-4">
                        <Button
                            onClick={handleLoadSkus}
                            disabled={isLoadingSkus}
                            className="w-full bg-indigo-600 hover:bg-indigo-700"
                        >
                            {isLoadingSkus ? (
                                <RefreshCw className="w-4 h-4 animate-spin ml-2" />
                            ) : (
                                <Download className="w-4 h-4 ml-2" />
                            )}
                            טען מק״טים מהקובץ האחרון
                        </Button>
                    </CardContent>
                </Card>
            </div>

            {/* Filters */}
            <Card className="glass-card border-0">
                <CardContent className="p-4">
                    <div className="flex flex-wrap gap-4">
                        <Input
                            placeholder="חיפוש לפי מק״ט או שם פריט..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="flex-1 min-w-[200px]"
                        />
                        
                        <Select value={lineFilter} onValueChange={setLineFilter}>
                            <SelectTrigger className="w-40">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">הכל</SelectItem>
                                <SelectItem value="lines">רק קווים</SelectItem>
                                <SelectItem value="non_lines">לא קווים</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={carrierFilter} onValueChange={setCarrierFilter}>
                            <SelectTrigger className="w-40">
                                <SelectValue placeholder="כל החברות" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">כל החברות</SelectItem>
                                {CARRIERS.map(c => (
                                    <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {(searchTerm || lineFilter !== "all" || carrierFilter !== "all") && (
                            <Button
                                variant="ghost"
                                onClick={() => {
                                    setSearchTerm("");
                                    setLineFilter("all");
                                    setCarrierFilter("all");
                                }}
                            >
                                נקה סינון
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Table */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle>מק״טים ({filteredDefs.length})</CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <p className="text-center py-8">טוען...</p>
                    ) : filteredDefs.length === 0 ? (
                        <p className="text-center text-gray-500 py-8">אין תוצאות</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>קו?</TableHead>
                                        <TableHead>מק״ט</TableHead>
                                        <TableHead>שם פריט</TableHead>
                                        <TableHead>חברה</TableHead>
                                        <TableHead>חודשי נעילה</TableHead>
                                        <TableHead>ימי בטחון</TableHead>
                                        <TableHead>פעולות</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredDefs.map((def) => (
                                        <TableRow key={def.id}>
                                            <TableCell>
                                                <Switch
                                                    checked={def.is_line}
                                                    onCheckedChange={() => handleQuickToggle(def)}
                                                />
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">{def.item_sku}</TableCell>
                                            <TableCell className="text-sm">{def.item_name_sample}</TableCell>
                                            <TableCell>
                                                {def.carrier_code ? (
                                                    <Badge variant="outline">
                                                        {CARRIERS.find(c => c.code === def.carrier_code)?.name || def.carrier_code}
                                                    </Badge>
                                                ) : (
                                                    <span className="text-gray-400 text-xs">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                {def.churn_window_months || '-'}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                {def.safety_buffer_days || 5}
                                            </TableCell>
                                            <TableCell>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => handleEdit(def)}
                                                >
                                                    <Edit className="w-4 h-4" />
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

            {/* Edit Modal */}
            {showEditModal && editingDef && (
                <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>עריכת הגדרת מק״ט</DialogTitle>
                        </DialogHeader>
                        
                        <div className="space-y-4">
                            <div>
                                <Label>מק״ט</Label>
                                <Input value={editingDef.item_sku} disabled className="font-mono bg-gray-50" />
                            </div>

                            <div>
                                <Label>שם פריט</Label>
                                <Input value={editingDef.item_name_sample || ''} disabled className="bg-gray-50" />
                            </div>

                            <div className="flex items-center gap-2">
                                <Switch
                                    checked={editingDef.is_line}
                                    onCheckedChange={(checked) => 
                                        setEditingDef({...editingDef, is_line: checked})
                                    }
                                />
                                <Label>זהו קו סלולר</Label>
                            </div>

                            {editingDef.is_line && (
                                <>
                                    <div>
                                        <Label>חברת סלולר</Label>
                                        <Select 
                                            value={editingDef.carrier_code || ""}
                                            onValueChange={(value) => 
                                                setEditingDef({...editingDef, carrier_code: value})
                                            }
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="בחר חברה" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {CARRIERS.map(c => (
                                                    <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <Label>חודשי נעילה (churn window)</Label>
                                            <Input
                                                type="number"
                                                value={editingDef.churn_window_months || ''}
                                                onChange={(e) => 
                                                    setEditingDef({
                                                        ...editingDef, 
                                                        churn_window_months: parseInt(e.target.value) || null
                                                    })
                                                }
                                                placeholder="3, 4, 5..."
                                            />
                                        </div>

                                        <div>
                                            <Label>ימי בטחון נוספים</Label>
                                            <Input
                                                type="number"
                                                value={editingDef.safety_buffer_days || 5}
                                                onChange={(e) => 
                                                    setEditingDef({
                                                        ...editingDef, 
                                                        safety_buffer_days: parseInt(e.target.value) || 5
                                                    })
                                                }
                                            />
                                        </div>
                                    </div>
                                </>
                            )}

                            <div className="flex justify-end gap-2 pt-4">
                                <Button variant="outline" onClick={() => setShowEditModal(false)}>
                                    <X className="w-4 h-4 ml-2" />
                                    ביטול
                                </Button>
                                <Button onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-700">
                                    <Save className="w-4 h-4 ml-2" />
                                    שמור
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}