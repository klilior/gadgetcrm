import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { 
    Settings, Plus, Pencil, Trash2, RefreshCw, Filter, 
    Smartphone, Radio, ShoppingBag, AlertCircle
} from "lucide-react";

export default function CommissionGroupMappings() {
    const { currentUser } = useUser();
    const [mappings, setMappings] = useState([]);
    const [groups, setGroups] = useState([]);
    const [categories, setCategories] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [editingMapping, setEditingMapping] = useState(null);
    
    // Form state
    const [formData, setFormData] = useState({
        commission_group_id: '',
        commission_group_code: '',
        filters_json: {
            category_in: [],
            product_name_contains: ''
        },
        priority: 0,
        is_active: true
    });

    const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [mappingsData, groupsData, salesData] = await Promise.all([
                base44.entities.CommissionGroupMapping.list(null, 200),
                base44.entities.CommissionGroup.filter({ is_active: true }),
                base44.entities.SalesTransaction.list(null, 10000) // Get all to extract all categories
            ]);
            
            setMappings(mappingsData.sort((a, b) => (b.priority || 0) - (a.priority || 0)));
            setGroups(groupsData);
            
            // Extract unique categories
            const uniqueCategories = [...new Set(salesData.map(s => s.category).filter(Boolean))];
            setCategories(uniqueCategories.sort());
        } catch (error) {
            console.error("Error loading data:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const openModal = (mapping = null) => {
        if (mapping) {
            setEditingMapping(mapping);
            setFormData({
                commission_group_id: mapping.commission_group_id,
                commission_group_code: mapping.commission_group_code,
                filters_json: mapping.filters_json || { category_in: [], product_name_contains: '' },
                priority: mapping.priority || 0,
                is_active: mapping.is_active !== false
            });
        } else {
            setEditingMapping(null);
            setFormData({
                commission_group_id: '',
                commission_group_code: '',
                filters_json: { category_in: [], product_name_contains: '' },
                priority: 0,
                is_active: true
            });
        }
        setShowModal(true);
    };

    const handleSave = async () => {
        try {
            if (editingMapping) {
                await base44.entities.CommissionGroupMapping.update(editingMapping.id, formData);
            } else {
                await base44.entities.CommissionGroupMapping.create(formData);
            }
            setShowModal(false);
            loadData();
        } catch (error) {
            alert('שגיאה בשמירה: ' + error.message);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('האם למחוק מיפוי זה?')) return;
        try {
            await base44.entities.CommissionGroupMapping.delete(id);
            loadData();
        } catch (error) {
            alert('שגיאה במחיקה: ' + error.message);
        }
    };

    const handleCategoryToggle = (category) => {
        const currentCategories = formData.filters_json.category_in || [];
        const newCategories = currentCategories.includes(category)
            ? currentCategories.filter(c => c !== category)
            : [...currentCategories, category];
        
        setFormData({
            ...formData,
            filters_json: {
                ...formData.filters_json,
                category_in: newCategories
            }
        });
    };

    const handleGroupChange = (groupId) => {
        const group = groups.find(g => g.id === groupId);
        setFormData({
            ...formData,
            commission_group_id: groupId,
            commission_group_code: group?.code || ''
        });
    };

    if (!isManager) {
        return (
            <div className="p-6 text-center">
                <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-500" />
                <h1 className="text-2xl font-bold text-red-600">אין הרשאה</h1>
                <p className="text-gray-600 mt-2">רק מנהלים יכולים לגשת לעמוד זה</p>
            </div>
        );
    }

    const getGroupIcon = (code) => {
        switch (code) {
            case 'DEVICES': return <Smartphone className="w-4 h-4" />;
            case 'LINES': return <Radio className="w-4 h-4" />;
            case 'ACCESSORIES_GROUP': return <ShoppingBag className="w-4 h-4" />;
            default: return <Filter className="w-4 h-4" />;
        }
    };

    const getGroupColor = (code) => {
        switch (code) {
            case 'DEVICES': return 'bg-blue-100 text-blue-800';
            case 'LINES': return 'bg-green-100 text-green-800';
            case 'ACCESSORIES_GROUP': return 'bg-purple-100 text-purple-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    return (
        <div className="p-4 md:p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
                        <Settings className="w-8 h-8 text-indigo-600" />
                        מיפוי קבוצות עמלות
                    </h1>
                    <p className="text-gray-600 mt-1">הגדר אילו קטגוריות ומוצרים נכנסים לכל קבוצה (מכשירים, קווים, אביזרים)</p>
                </div>
                <div className="flex gap-2">
                    <Button onClick={loadData} variant="outline" disabled={isLoading}>
                        <RefreshCw className={`w-4 h-4 ml-2 ${isLoading ? 'animate-spin' : ''}`} />
                        רענן
                    </Button>
                    <Button onClick={() => openModal()} className="bg-indigo-600 hover:bg-indigo-700">
                        <Plus className="w-4 h-4 ml-2" />
                        מיפוי חדש
                    </Button>
                </div>
            </div>

            {/* Info Card */}
            <Card className="border-l-4 border-l-blue-500 bg-blue-50">
                <CardContent className="p-4">
                    <p className="text-sm text-gray-700">
                        💡 <strong>שים לב:</strong> המיפויים נבדקים לפי סדר עדיפות (Priority) מהגבוה לנמוך.
                        המיפוי הראשון שתואם מכירה מסוימת - קובע את הקבוצה שלה.
                        לכן, מיפויים ספציפיים יותר צריכים לקבל עדיפות גבוהה יותר.
                    </p>
                </CardContent>
            </Card>

            {/* Mappings Table */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Filter className="w-5 h-5 text-indigo-600" />
                        מיפויים קיימים ({mappings.length})
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="text-center py-12">
                            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                        </div>
                    ) : mappings.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <Filter className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>אין מיפויים עדיין</p>
                            <p className="text-sm mt-2">לחץ "מיפוי חדש" כדי להתחיל</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-20">עדיפות</TableHead>
                                        <TableHead>קבוצה</TableHead>
                                        <TableHead>קטגוריות</TableHead>
                                        <TableHead>מכיל בשם מוצר</TableHead>
                                        <TableHead className="w-24">סטטוס</TableHead>
                                        <TableHead className="w-32">פעולות</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {mappings.map((mapping) => (
                                        <TableRow key={mapping.id}>
                                            <TableCell>
                                                <Badge variant="outline" className="font-bold">
                                                    {mapping.priority || 0}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    {getGroupIcon(mapping.commission_group_code)}
                                                    <Badge className={getGroupColor(mapping.commission_group_code)}>
                                                        {mapping.commission_group_code}
                                                    </Badge>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-wrap gap-1">
                                                    {mapping.filters_json?.category_in?.length > 0 ? (
                                                        mapping.filters_json.category_in.map((cat, idx) => (
                                                            <Badge key={idx} variant="outline" className="text-xs">
                                                                {cat}
                                                            </Badge>
                                                        ))
                                                    ) : (
                                                        <span className="text-gray-400 text-sm">הכל</span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {mapping.filters_json?.product_name_contains ? (
                                                    <code className="text-xs bg-gray-100 px-2 py-1 rounded">
                                                        {mapping.filters_json.product_name_contains}
                                                    </code>
                                                ) : (
                                                    <span className="text-gray-400 text-sm">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={mapping.is_active ? "default" : "secondary"}>
                                                    {mapping.is_active ? 'פעיל' : 'לא פעיל'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex gap-2">
                                                    <Button 
                                                        size="sm" 
                                                        variant="outline"
                                                        onClick={() => openModal(mapping)}
                                                    >
                                                        <Pencil className="w-3 h-3" />
                                                    </Button>
                                                    <Button 
                                                        size="sm" 
                                                        variant="destructive"
                                                        onClick={() => handleDelete(mapping.id)}
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Edit/Create Modal */}
            <Dialog open={showModal} onOpenChange={setShowModal}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {editingMapping ? 'עריכת מיפוי' : 'מיפוי חדש'}
                        </DialogTitle>
                    </DialogHeader>
                    
                    <div className="space-y-6 py-4">
                        {/* Group Selection */}
                        <div className="space-y-2">
                            <Label>קבוצת עמלות *</Label>
                            <Select 
                                value={formData.commission_group_id} 
                                onValueChange={handleGroupChange}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="בחר קבוצה" />
                                </SelectTrigger>
                                <SelectContent>
                                    {groups.map(group => (
                                        <SelectItem key={group.id} value={group.id}>
                                            <div className="flex items-center gap-2">
                                                {getGroupIcon(group.code)}
                                                {group.name} ({group.code})
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Priority */}
                        <div className="space-y-2">
                            <Label>עדיפות (Priority) *</Label>
                            <Input 
                                type="number" 
                                value={formData.priority}
                                onChange={(e) => setFormData({...formData, priority: parseInt(e.target.value) || 0})}
                                placeholder="גבוה יותר = נבדק קודם"
                            />
                            <p className="text-xs text-gray-500">
                                ככל שהעדיפות גבוהה יותר, המיפוי ייבדק קודם. מומלץ: 100 למיפויים ספציפיים, 0 לכלליים.
                            </p>
                        </div>

                        {/* Category Selection */}
                        <div className="space-y-2">
                            <Label>קטגוריות (רב-בחירה)</Label>
                            <div className="border rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
                                <p className="text-xs text-gray-500 mb-2">
                                    בחר קטגוריות שיתאימו למיפוי. אם לא נבחר כלום - כל הקטגוריות תואמות.
                                </p>
                                {categories.map(category => (
                                    <div 
                                        key={category}
                                        className={`p-2 rounded cursor-pointer hover:bg-gray-100 ${
                                            formData.filters_json?.category_in?.includes(category) ? 'bg-blue-50 border border-blue-200' : ''
                                        }`}
                                        onClick={() => handleCategoryToggle(category)}
                                    >
                                        <span className="text-sm">{category}</span>
                                    </div>
                                ))}
                            </div>
                            <p className="text-xs text-gray-600">
                                נבחרו: {formData.filters_json?.category_in?.length || 0} קטגוריות
                            </p>
                        </div>

                        {/* Product Name Contains */}
                        <div className="space-y-2">
                            <Label>מכיל בשם המוצר (אופציונלי)</Label>
                            <Input 
                                value={formData.filters_json?.product_name_contains || ''}
                                onChange={(e) => setFormData({
                                    ...formData,
                                    filters_json: {
                                        ...formData.filters_json,
                                        product_name_contains: e.target.value
                                    }
                                })}
                                placeholder="לדוגמה: iPhone, Samsung, קו"
                            />
                            <p className="text-xs text-gray-500">
                                אם מצוין, רק מוצרים ששמם מכיל את הטקסט יתאימו למיפוי.
                            </p>
                        </div>

                        {/* Active Status */}
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={formData.is_active}
                                onChange={(e) => setFormData({...formData, is_active: e.target.checked})}
                                className="rounded"
                            />
                            <Label>מיפוי פעיל</Label>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowModal(false)}>
                            ביטול
                        </Button>
                        <Button onClick={handleSave} disabled={!formData.commission_group_id}>
                            שמור
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}