import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import UnauthorizedRedirect from "../components/UnauthorizedRedirect";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
    Radio, Plus, Pencil, Trash2, RefreshCw, Settings
} from "lucide-react";

export default function CarrierManagement() {
    const { currentUser } = useUser();
    const [policies, setPolicies] = useState([]);
    const [mappings, setMappings] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showPolicyModal, setShowPolicyModal] = useState(false);
    const [showMappingModal, setShowMappingModal] = useState(false);
    const [editingPolicy, setEditingPolicy] = useState(null);
    const [editingMapping, setEditingMapping] = useState(null);
    
    const [policyForm, setPolicyForm] = useState({
        carrier_code: '',
        carrier_name: '',
        churn_window_months: 12,
        safety_buffer_days: 30,
        is_active: true
    });
    
    const [mappingForm, setMappingForm] = useState({
        carrier_code: '',
        product_sku_exact: '',
        product_sku_prefix: '',
        name_contains: '',
        priority: 0,
        is_active: true
    });

    const isManager = currentUser?.role === 'מנהל';

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [policiesData, mappingsData] = await Promise.all([
                base44.entities.CarrierPolicy.list(),
                base44.entities.CarrierProductMapping.list(null, 500)
            ]);
            setPolicies(policiesData);
            setMappings(mappingsData.sort((a, b) => (b.priority || 0) - (a.priority || 0)));
        } catch (error) {
            console.error("Error loading data:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const openPolicyModal = (policy = null) => {
        if (policy) {
            setEditingPolicy(policy);
            setPolicyForm(policy);
        } else {
            setEditingPolicy(null);
            setPolicyForm({
                carrier_code: '',
                carrier_name: '',
                churn_window_months: 12,
                safety_buffer_days: 30,
                is_active: true
            });
        }
        setShowPolicyModal(true);
    };

    const openMappingModal = (mapping = null) => {
        if (mapping) {
            setEditingMapping(mapping);
            setMappingForm(mapping);
        } else {
            setEditingMapping(null);
            setMappingForm({
                carrier_code: '',
                product_sku_exact: '',
                product_sku_prefix: '',
                name_contains: '',
                priority: 0,
                is_active: true
            });
        }
        setShowMappingModal(true);
    };

    const handleSavePolicy = async () => {
        try {
            if (editingPolicy) {
                await base44.entities.CarrierPolicy.update(editingPolicy.id, policyForm);
            } else {
                await base44.entities.CarrierPolicy.create(policyForm);
            }
            setShowPolicyModal(false);
            loadData();
        } catch (error) {
            alert('שגיאה בשמירה: ' + error.message);
        }
    };

    const handleSaveMapping = async () => {
        try {
            if (editingMapping) {
                await base44.entities.CarrierProductMapping.update(editingMapping.id, mappingForm);
            } else {
                await base44.entities.CarrierProductMapping.create(mappingForm);
            }
            setShowMappingModal(false);
            loadData();
        } catch (error) {
            alert('שגיאה בשמירה: ' + error.message);
        }
    };

    const handleDeletePolicy = async (id) => {
        if (!confirm('האם למחוק ספק זה?')) return;
        try {
            await base44.entities.CarrierPolicy.delete(id);
            loadData();
        } catch (error) {
            alert('שגיאה במחיקה: ' + error.message);
        }
    };

    const handleDeleteMapping = async (id) => {
        if (!confirm('האם למחוק מיפוי זה?')) return;
        try {
            await base44.entities.CarrierProductMapping.delete(id);
            loadData();
        } catch (error) {
            alert('שגיאה במחיקה: ' + error.message);
        }
    };

    if (!isManager) {
        return <UnauthorizedRedirect currentUser={currentUser} />;
    }

    return (
        <div className="p-4 md:p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
                        <Radio className="w-8 h-8 text-indigo-600" />
                        ניהול ספקי סלולר
                    </h1>
                    <p className="text-gray-600 mt-1">הגדרות ספקים ומיפוי מוצרים</p>
                </div>
                <Button onClick={loadData} variant="outline" disabled={isLoading}>
                    <RefreshCw className={`w-4 h-4 ml-2 ${isLoading ? 'animate-spin' : ''}`} />
                    רענן
                </Button>
            </div>

            <Tabs defaultValue="policies" className="space-y-4">
                <TabsList className="grid w-full md:w-96 grid-cols-2">
                    <TabsTrigger value="policies">ספקים ומדיניות</TabsTrigger>
                    <TabsTrigger value="mappings">מיפוי מוצרים</TabsTrigger>
                </TabsList>

                {/* Policies Tab */}
                <TabsContent value="policies" className="space-y-4">
                    <Card className="glass-card border-0">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle>ספקי סלולר ({policies.length})</CardTitle>
                            <Button onClick={() => openPolicyModal()} className="bg-indigo-600 hover:bg-indigo-700">
                                <Plus className="w-4 h-4 ml-2" />
                                ספק חדש
                            </Button>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>קוד</TableHead>
                                        <TableHead>שם</TableHead>
                                        <TableHead>חלון Churn (חודשים)</TableHead>
                                        <TableHead>באפר בטיחות (ימים)</TableHead>
                                        <TableHead>סטטוס</TableHead>
                                        <TableHead>פעולות</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {policies.map((policy) => (
                                        <TableRow key={policy.id}>
                                            <TableCell className="font-mono font-bold">{policy.carrier_code}</TableCell>
                                            <TableCell className="font-medium">{policy.carrier_name}</TableCell>
                                            <TableCell>{policy.churn_window_months}</TableCell>
                                            <TableCell>{policy.safety_buffer_days}</TableCell>
                                            <TableCell>
                                                <Badge variant={policy.is_active ? "default" : "secondary"}>
                                                    {policy.is_active ? 'פעיל' : 'לא פעיל'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex gap-2">
                                                    <Button size="sm" variant="outline" onClick={() => openPolicyModal(policy)}>
                                                        <Pencil className="w-3 h-3" />
                                                    </Button>
                                                    <Button size="sm" variant="destructive" onClick={() => handleDeletePolicy(policy.id)}>
                                                        <Trash2 className="w-3 h-3" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Mappings Tab */}
                <TabsContent value="mappings" className="space-y-4">
                    <Card className="glass-card border-0">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle>מיפוי מוצרים לספקים ({mappings.length})</CardTitle>
                            <Button onClick={() => openMappingModal()} className="bg-indigo-600 hover:bg-indigo-700">
                                <Plus className="w-4 h-4 ml-2" />
                                מיפוי חדש
                            </Button>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>ספק</TableHead>
                                        <TableHead>SKU מדויק</TableHead>
                                        <TableHead>SKU מתחיל ב-</TableHead>
                                        <TableHead>שם מכיל</TableHead>
                                        <TableHead>עדיפות</TableHead>
                                        <TableHead>סטטוס</TableHead>
                                        <TableHead>פעולות</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {mappings.map((mapping) => (
                                        <TableRow key={mapping.id}>
                                            <TableCell>
                                                <Badge>{mapping.carrier_code}</Badge>
                                            </TableCell>
                                            <TableCell className="font-mono text-sm">{mapping.product_sku_exact || '-'}</TableCell>
                                            <TableCell className="font-mono text-sm">{mapping.product_sku_prefix || '-'}</TableCell>
                                            <TableCell className="text-sm">{mapping.name_contains || '-'}</TableCell>
                                            <TableCell>{mapping.priority}</TableCell>
                                            <TableCell>
                                                <Badge variant={mapping.is_active ? "default" : "secondary"}>
                                                    {mapping.is_active ? 'פעיל' : 'לא פעיל'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex gap-2">
                                                    <Button size="sm" variant="outline" onClick={() => openMappingModal(mapping)}>
                                                        <Pencil className="w-3 h-3" />
                                                    </Button>
                                                    <Button size="sm" variant="destructive" onClick={() => handleDeleteMapping(mapping.id)}>
                                                        <Trash2 className="w-3 h-3" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Policy Modal */}
            <Dialog open={showPolicyModal} onOpenChange={setShowPolicyModal}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingPolicy ? 'עריכת ספק' : 'ספק חדש'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>קוד ספק *</Label>
                            <Input 
                                value={policyForm.carrier_code} 
                                onChange={(e) => setPolicyForm({...policyForm, carrier_code: e.target.value.toUpperCase()})}
                                placeholder="PELEPHONE"
                                disabled={!!editingPolicy}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>שם ספק *</Label>
                            <Input 
                                value={policyForm.carrier_name} 
                                onChange={(e) => setPolicyForm({...policyForm, carrier_name: e.target.value})}
                                placeholder="פלאפון"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>חלון Churn (חודשים)</Label>
                            <Input 
                                type="number" 
                                value={policyForm.churn_window_months} 
                                onChange={(e) => setPolicyForm({...policyForm, churn_window_months: Number(e.target.value)})}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>באפר בטיחות (ימים)</Label>
                            <Input 
                                type="number" 
                                value={policyForm.safety_buffer_days} 
                                onChange={(e) => setPolicyForm({...policyForm, safety_buffer_days: Number(e.target.value)})}
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={policyForm.is_active}
                                onChange={(e) => setPolicyForm({...policyForm, is_active: e.target.checked})}
                                className="rounded"
                            />
                            <Label>ספק פעיל</Label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowPolicyModal(false)}>ביטול</Button>
                        <Button onClick={handleSavePolicy} disabled={!policyForm.carrier_code || !policyForm.carrier_name}>
                            שמור
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Mapping Modal */}
            <Dialog open={showMappingModal} onOpenChange={setShowMappingModal}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingMapping ? 'עריכת מיפוי' : 'מיפוי חדש'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>ספק *</Label>
                            <Input 
                                value={mappingForm.carrier_code} 
                                onChange={(e) => setMappingForm({...mappingForm, carrier_code: e.target.value.toUpperCase()})}
                                placeholder="PELEPHONE"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>SKU מדויק</Label>
                            <Input 
                                value={mappingForm.product_sku_exact} 
                                onChange={(e) => setMappingForm({...mappingForm, product_sku_exact: e.target.value})}
                                placeholder="LINE001"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>SKU מתחיל ב-</Label>
                            <Input 
                                value={mappingForm.product_sku_prefix} 
                                onChange={(e) => setMappingForm({...mappingForm, product_sku_prefix: e.target.value})}
                                placeholder="PEL_"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>שם מוצר מכיל</Label>
                            <Input 
                                value={mappingForm.name_contains} 
                                onChange={(e) => setMappingForm({...mappingForm, name_contains: e.target.value})}
                                placeholder="פלאפון"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>עדיפות (גבוה = קודם)</Label>
                            <Input 
                                type="number" 
                                value={mappingForm.priority} 
                                onChange={(e) => setMappingForm({...mappingForm, priority: Number(e.target.value)})}
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={mappingForm.is_active}
                                onChange={(e) => setMappingForm({...mappingForm, is_active: e.target.checked})}
                                className="rounded"
                            />
                            <Label>מיפוי פעיל</Label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowMappingModal(false)}>ביטול</Button>
                        <Button onClick={handleSaveMapping} disabled={!mappingForm.carrier_code}>
                            שמור
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}