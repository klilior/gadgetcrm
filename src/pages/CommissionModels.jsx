import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Edit, Copy, Trash2, ChevronRight, Settings, Calculator, ArrowLeft } from "lucide-react";
import { format } from "date-fns";

const RULE_TYPES = {
    PERCENT_OF_NET: { label: "אחוז מהמכירות (נטו)", icon: "%" },
    PER_UNIT: { label: "עמלה ליחידה", icon: "₪" },
    LINE_4G: { label: "קו 4G", icon: "📶" },
    LINE_5G: { label: "קו 5G", icon: "📡" }
};



export default function CommissionModels() {
    const { currentUser } = useUser();
    const [models, setModels] = useState([]);
    const [rules, setRules] = useState([]);
    const [selectedModel, setSelectedModel] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [availableCategories, setAvailableCategories] = useState([]);
    
    // Modal states
    const [showModelModal, setShowModelModal] = useState(false);
    const [showRuleModal, setShowRuleModal] = useState(false);
    const [editingModel, setEditingModel] = useState(null);
    const [editingRule, setEditingRule] = useState(null);
    
    // Form states
    const [modelForm, setModelForm] = useState({
        name: "",
        description: "",
        is_default: false,
        valid_from: "",
        valid_to: "",
        is_active: true
    });
    
    const [ruleForm, setRuleForm] = useState({
        rule_name: "",
        rule_type: "PERCENT_OF_NET",
        percentage: 0,
        amount_per_unit: 0,
        filters_json: { categories_included: [] },
        is_active: true,
        priority: 0
    });

    const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';

    useEffect(() => {
        loadModels();
        loadCategories();
    }, []);

    const loadCategories = async () => {
        try {
            const categories = await base44.entities.LinetCategoryTranslation.list('category_name', 500);
            setAvailableCategories(categories.map(c => c.category_name).filter(Boolean).sort());
        } catch (error) {
            console.error("Error loading categories:", error);
        }
    };

    useEffect(() => {
        if (selectedModel) {
            loadRules(selectedModel.id);
        }
    }, [selectedModel]);

    const loadModels = async () => {
        setIsLoading(true);
        try {
            const data = await base44.entities.CommissionModel.list('-created_date', 100);
            setModels(data);
        } catch (error) {
            console.error("Error loading models:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const loadRules = async (modelId) => {
        try {
            const data = await base44.entities.CommissionRule.filter({ model_id: modelId }, 'priority', 100);
            setRules(data);
        } catch (error) {
            console.error("Error loading rules:", error);
        }
    };

    const handleSaveModel = async () => {
        try {
            // If setting as default, unset other defaults first
            if (modelForm.is_default) {
                const currentDefaults = models.filter(m => m.is_default && m.id !== editingModel?.id);
                for (const model of currentDefaults) {
                    await base44.entities.CommissionModel.update(model.id, { is_default: false });
                }
            }

            if (editingModel) {
                await base44.entities.CommissionModel.update(editingModel.id, modelForm);
            } else {
                await base44.entities.CommissionModel.create(modelForm);
            }
            
            setShowModelModal(false);
            setEditingModel(null);
            resetModelForm();
            loadModels();
        } catch (error) {
            alert("שגיאה בשמירת המודל: " + error.message);
        }
    };

    const handleSaveRule = async () => {
        try {
            const ruleData = {
                ...ruleForm,
                model_id: selectedModel.id
            };

            if (editingRule) {
                await base44.entities.CommissionRule.update(editingRule.id, ruleData);
            } else {
                await base44.entities.CommissionRule.create(ruleData);
            }
            
            setShowRuleModal(false);
            setEditingRule(null);
            resetRuleForm();
            loadRules(selectedModel.id);
        } catch (error) {
            alert("שגיאה בשמירת החוק: " + error.message);
        }
    };

    const handleDeleteModel = async (model) => {
        if (!confirm(`למחוק את המודל "${model.name}"? כל החוקים המשויכים יימחקו גם.`)) return;
        
        try {
            // Delete associated rules first
            const modelRules = await base44.entities.CommissionRule.filter({ model_id: model.id });
            for (const rule of modelRules) {
                await base44.entities.CommissionRule.delete(rule.id);
            }
            await base44.entities.CommissionModel.delete(model.id);
            
            if (selectedModel?.id === model.id) {
                setSelectedModel(null);
                setRules([]);
            }
            loadModels();
        } catch (error) {
            alert("שגיאה במחיקת המודל: " + error.message);
        }
    };

    const handleDeleteRule = async (rule) => {
        if (!confirm(`למחוק את החוק "${rule.rule_name}"?`)) return;
        
        try {
            await base44.entities.CommissionRule.delete(rule.id);
            loadRules(selectedModel.id);
        } catch (error) {
            alert("שגיאה במחיקת החוק: " + error.message);
        }
    };

    const handleDuplicateRule = async (rule) => {
        try {
            const newRule = {
                model_id: rule.model_id,
                rule_name: rule.rule_name + " (העתק)",
                rule_type: rule.rule_type,
                percentage: rule.percentage,
                amount_per_unit: rule.amount_per_unit,
                filters_json: rule.filters_json,
                is_active: false,
                priority: rule.priority + 1
            };
            await base44.entities.CommissionRule.create(newRule);
            loadRules(selectedModel.id);
        } catch (error) {
            alert("שגיאה בשכפול החוק: " + error.message);
        }
    };

    const openModelModal = (model = null) => {
        if (model) {
            setEditingModel(model);
            setModelForm({
                name: model.name || "",
                description: model.description || "",
                is_default: model.is_default || false,
                valid_from: model.valid_from || "",
                valid_to: model.valid_to || "",
                is_active: model.is_active !== false
            });
        } else {
            resetModelForm();
        }
        setShowModelModal(true);
    };

    const openRuleModal = (rule = null) => {
        if (rule) {
            setEditingRule(rule);
            setRuleForm({
                rule_name: rule.rule_name || "",
                rule_type: rule.rule_type || "PERCENT_OF_NET",
                percentage: rule.percentage || 0,
                amount_per_unit: rule.amount_per_unit || 0,
                filters_json: rule.filters_json || { categories_included: [] },
                is_active: rule.is_active !== false,
                priority: rule.priority || 0
            });
        } else {
            resetRuleForm();
        }
        setShowRuleModal(true);
    };

    const resetModelForm = () => {
        setModelForm({
            name: "",
            description: "",
            is_default: false,
            valid_from: "",
            valid_to: "",
            is_active: true
        });
        setEditingModel(null);
    };

    const resetRuleForm = () => {
        setRuleForm({
            rule_name: "",
            rule_type: "PERCENT_OF_NET",
            percentage: 0,
            amount_per_unit: 0,
            filters_json: { categories_included: [] },
            is_active: true,
            priority: 0
        });
        setEditingRule(null);
    };

    const toggleCategory = (category) => {
        const currentCategories = ruleForm.filters_json.categories_included || [];
        const newCategories = currentCategories.includes(category)
            ? currentCategories.filter(c => c !== category)
            : [...currentCategories, category];
        
        setRuleForm({
            ...ruleForm,
            filters_json: { ...ruleForm.filters_json, categories_included: newCategories }
        });
    };

    if (!isManager) {
        return (
            <div className="p-6 text-center">
                <h1 className="text-2xl font-bold text-red-600">אין הרשאה</h1>
                <p className="text-gray-600 mt-2">עמוד זה מיועד למנהלים בלבד</p>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
                        <Calculator className="w-8 h-8 text-purple-600" />
                        ניהול מודלי עמלות
                    </h1>
                    <p className="text-gray-600 mt-1">הגדרת מודלים וחוקי עמלות לנציגים</p>
                </div>
                
                {!selectedModel && (
                    <Button onClick={() => openModelModal()} className="bg-purple-600 hover:bg-purple-700 text-white">
                        <Plus className="w-4 h-4 ml-2" />
                        מודל חדש
                    </Button>
                )}
            </div>

            {/* Back button when viewing model */}
            {selectedModel && (
                <Button 
                    variant="outline" 
                    onClick={() => { setSelectedModel(null); setRules([]); }}
                    className="mb-4"
                >
                    <ArrowLeft className="w-4 h-4 ml-2" />
                    חזרה לרשימת המודלים
                </Button>
            )}

            {/* Models List */}
            {!selectedModel && (
                <Card className="glass-card border-0">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Settings className="w-5 h-5 text-purple-600" />
                            מודלי עמלות ({models.length})
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {models.length === 0 ? (
                            <div className="text-center py-12 text-gray-500">
                                <Calculator className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                <p>אין מודלי עמלות עדיין</p>
                                <Button onClick={() => openModelModal()} className="mt-4 bg-purple-600 hover:bg-purple-700 text-white">
                                    <Plus className="w-4 h-4 ml-2" />
                                    צור מודל ראשון
                                </Button>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>שם המודל</TableHead>
                                            <TableHead>תיאור</TableHead>
                                            <TableHead className="text-center">ברירת מחדל</TableHead>
                                            <TableHead>תוקף</TableHead>
                                            <TableHead className="text-center">סטטוס</TableHead>
                                            <TableHead className="text-left">פעולות</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {models.map((model) => (
                                            <TableRow 
                                                key={model.id} 
                                                className="hover:bg-purple-50/50 cursor-pointer"
                                                onClick={() => setSelectedModel(model)}
                                            >
                                                <TableCell className="font-medium">
                                                    <div className="flex items-center gap-2">
                                                        {model.name}
                                                        <ChevronRight className="w-4 h-4 text-gray-400" />
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-gray-600 max-w-xs truncate">
                                                    {model.description || "-"}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    {model.is_default && (
                                                        <Badge className="bg-yellow-100 text-yellow-800">ברירת מחדל</Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    {model.valid_from && (
                                                        <span>
                                                            {model.valid_from}
                                                            {model.valid_to ? ` - ${model.valid_to}` : " ואילך"}
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Badge className={model.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}>
                                                        {model.is_active ? "פעיל" : "מושבת"}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                                                        <Button size="sm" variant="ghost" onClick={() => openModelModal(model)}>
                                                            <Edit className="w-4 h-4" />
                                                        </Button>
                                                        <Button size="sm" variant="ghost" className="text-red-600" onClick={() => handleDeleteModel(model)}>
                                                            <Trash2 className="w-4 h-4" />
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
            )}

            {/* Rules List (when model selected) */}
            {selectedModel && (
                <Card className="glass-card border-0">
                    <CardHeader>
                        <div className="flex justify-between items-center">
                            <CardTitle className="flex items-center gap-2">
                                <Calculator className="w-5 h-5 text-blue-600" />
                                חוקי עמלות - {selectedModel.name}
                            </CardTitle>
                            <Button onClick={() => openRuleModal()} className="bg-blue-600 hover:bg-blue-700 text-white">
                                <Plus className="w-4 h-4 ml-2" />
                                הוסף חוק
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {rules.length === 0 ? (
                            <div className="text-center py-12 text-gray-500">
                                <p>אין חוקים במודל זה</p>
                                <Button onClick={() => openRuleModal()} className="mt-4 bg-blue-600 hover:bg-blue-700 text-white">
                                    <Plus className="w-4 h-4 ml-2" />
                                    הוסף חוק ראשון
                                </Button>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>שם החוק</TableHead>
                                            <TableHead>סוג</TableHead>
                                            <TableHead className="text-center">ערך</TableHead>
                                            <TableHead>פילטרים</TableHead>
                                            <TableHead className="text-center">סטטוס</TableHead>
                                            <TableHead className="text-left">פעולות</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {rules.map((rule) => (
                                            <TableRow key={rule.id} className="hover:bg-blue-50/50">
                                                <TableCell className="font-medium">{rule.rule_name}</TableCell>
                                                <TableCell>
                                                    <Badge variant="outline">
                                                        {RULE_TYPES[rule.rule_type]?.icon} {RULE_TYPES[rule.rule_type]?.label}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-center font-bold">
                                                    {rule.rule_type === "PERCENT_OF_NET" 
                                                        ? `${rule.percentage}%`
                                                        : `₪${rule.amount_per_unit}`
                                                    }
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-wrap gap-1">
                                                        {rule.filters_json?.categories_included?.slice(0, 3).map((cat, i) => (
                                                            <Badge key={i} variant="secondary" className="text-xs">
                                                                {cat}
                                                            </Badge>
                                                        ))}
                                                        {rule.filters_json?.categories_included?.length > 3 && (
                                                            <Badge variant="secondary" className="text-xs">
                                                                +{rule.filters_json.categories_included.length - 3}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Badge className={rule.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}>
                                                        {rule.is_active ? "פעיל" : "מושבת"}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex gap-1">
                                                        <Button size="sm" variant="ghost" onClick={() => openRuleModal(rule)}>
                                                            <Edit className="w-4 h-4" />
                                                        </Button>
                                                        <Button size="sm" variant="ghost" onClick={() => handleDuplicateRule(rule)}>
                                                            <Copy className="w-4 h-4" />
                                                        </Button>
                                                        <Button size="sm" variant="ghost" className="text-red-600" onClick={() => handleDeleteRule(rule)}>
                                                            <Trash2 className="w-4 h-4" />
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
            )}

            {/* Model Modal */}
            <Dialog open={showModelModal} onOpenChange={setShowModelModal}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editingModel ? "עריכת מודל" : "מודל חדש"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <label className="text-sm font-medium mb-1 block">שם המודל *</label>
                            <Input 
                                value={modelForm.name}
                                onChange={(e) => setModelForm({ ...modelForm, name: e.target.value })}
                                placeholder="לדוגמה: מודל בסיסי נציגים 2025"
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1 block">תיאור</label>
                            <Textarea 
                                value={modelForm.description}
                                onChange={(e) => setModelForm({ ...modelForm, description: e.target.value })}
                                placeholder="תיאור קצר של המודל"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium mb-1 block">תוקף מ-</label>
                                <Input 
                                    type="date"
                                    value={modelForm.valid_from}
                                    onChange={(e) => setModelForm({ ...modelForm, valid_from: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium mb-1 block">תוקף עד</label>
                                <Input 
                                    type="date"
                                    value={modelForm.valid_to}
                                    onChange={(e) => setModelForm({ ...modelForm, valid_to: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium">מודל ברירת מחדל</label>
                            <Switch 
                                checked={modelForm.is_default}
                                onCheckedChange={(checked) => setModelForm({ ...modelForm, is_default: checked })}
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium">מודל פעיל</label>
                            <Switch 
                                checked={modelForm.is_active}
                                onCheckedChange={(checked) => setModelForm({ ...modelForm, is_active: checked })}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowModelModal(false)}>ביטול</Button>
                        <Button onClick={handleSaveModel} className="bg-purple-600 hover:bg-purple-700 text-white">
                            {editingModel ? "שמור שינויים" : "צור מודל"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Rule Modal */}
            <Dialog open={showRuleModal} onOpenChange={setShowRuleModal}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingRule ? "עריכת חוק" : "חוק חדש"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <label className="text-sm font-medium mb-1 block">שם החוק *</label>
                            <Input 
                                value={ruleForm.rule_name}
                                onChange={(e) => setRuleForm({ ...ruleForm, rule_name: e.target.value })}
                                placeholder="לדוגמה: 3% אביזרים"
                            />
                        </div>
                        
                        <div>
                            <label className="text-sm font-medium mb-1 block">סוג החוק *</label>
                            <Select 
                                value={ruleForm.rule_type} 
                                onValueChange={(value) => setRuleForm({ ...ruleForm, rule_type: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(RULE_TYPES).map(([key, { label, icon }]) => (
                                        <SelectItem key={key} value={key}>
                                            {icon} {label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {ruleForm.rule_type === "PERCENT_OF_NET" ? (
                            <div>
                                <label className="text-sm font-medium mb-1 block">אחוז עמלה</label>
                                <div className="flex items-center gap-2">
                                    <Input 
                                        type="number"
                                        step="0.1"
                                        value={ruleForm.percentage}
                                        onChange={(e) => setRuleForm({ ...ruleForm, percentage: parseFloat(e.target.value) || 0 })}
                                        className="w-32"
                                    />
                                    <span className="text-lg font-bold">%</span>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <label className="text-sm font-medium mb-1 block">סכום ליחידה</label>
                                <div className="flex items-center gap-2">
                                    <Input 
                                        type="number"
                                        step="0.5"
                                        value={ruleForm.amount_per_unit}
                                        onChange={(e) => setRuleForm({ ...ruleForm, amount_per_unit: parseFloat(e.target.value) || 0 })}
                                        className="w-32"
                                    />
                                    <span className="text-lg font-bold">₪</span>
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="text-sm font-medium mb-2 block">קטגוריות כלולות ({availableCategories.length} קטגוריות)</label>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-3 bg-gray-50 rounded-lg max-h-64 overflow-y-auto">
                                {availableCategories.length === 0 ? (
                                    <p className="text-sm text-gray-500 col-span-3">טוען קטגוריות...</p>
                                ) : (
                                    availableCategories.map((category) => (
                                        <div key={category} className="flex items-center gap-2">
                                            <Checkbox 
                                                id={category}
                                                checked={ruleForm.filters_json?.categories_included?.includes(category)}
                                                onCheckedChange={() => toggleCategory(category)}
                                            />
                                            <label htmlFor={category} className="text-sm cursor-pointer truncate" title={category}>
                                                {category}
                                            </label>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        <div>
                            <label className="text-sm font-medium mb-1 block">פילטרים מתקדמים (JSON)</label>
                            <Textarea 
                                value={JSON.stringify(ruleForm.filters_json, null, 2)}
                                onChange={(e) => {
                                    try {
                                        const parsed = JSON.parse(e.target.value);
                                        setRuleForm({ ...ruleForm, filters_json: parsed });
                                    } catch (err) {
                                        // Invalid JSON, ignore
                                    }
                                }}
                                className="font-mono text-xs h-24"
                                dir="ltr"
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                ניתן להוסיף פילטרים כמו: product_sku, product_name, line_type וכו'
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium mb-1 block">עדיפות</label>
                                <Input 
                                    type="number"
                                    value={ruleForm.priority}
                                    onChange={(e) => setRuleForm({ ...ruleForm, priority: parseInt(e.target.value) || 0 })}
                                />
                            </div>
                            <div className="flex items-center justify-between pt-6">
                                <label className="text-sm font-medium">חוק פעיל</label>
                                <Switch 
                                    checked={ruleForm.is_active}
                                    onCheckedChange={(checked) => setRuleForm({ ...ruleForm, is_active: checked })}
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowRuleModal(false)}>ביטול</Button>
                        <Button onClick={handleSaveRule} className="bg-blue-600 hover:bg-blue-700 text-white">
                            {editingRule ? "שמור שינויים" : "צור חוק"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}