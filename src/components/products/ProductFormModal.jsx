import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { X, Upload } from "lucide-react";

export default function ProductFormModal({ product, onClose, onSuccess }) {
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        short_description: '',
        sku: '',
        regular_price: '',
        sale_price: '',
        cost_price: '',
        cost_price_vat: '',
        status: 'draft',
        manage_stock: false,
        stock_quantity: '',
        stock_status: 'instock',
        categories: [],
        tags: [],
        brands: [],
        featured: false,
        images: []
    });
    
    const [categoryInput, setCategoryInput] = useState('');
    const [tagInput, setTagInput] = useState('');
    const [brandInput, setBrandInput] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    
    useEffect(() => {
        if (product) {
            setFormData({
                name: product.name || '',
                description: product.description || '',
                short_description: product.short_description || '',
                sku: product.sku || '',
                regular_price: product.regular_price || '',
                sale_price: product.sale_price || '',
                cost_price: product.cost_price || '',
                cost_price_vat: product.cost_price_vat || '',
                status: product.status || 'draft',
                manage_stock: product.manage_stock || false,
                stock_quantity: product.stock_quantity || '',
                stock_status: product.stock_status || 'instock',
                categories: product.categories || [],
                tags: product.tags || [],
                brands: product.brands || [],
                featured: product.featured || false,
                images: product.images || []
            });
        }
    }, [product]);
    
    const handleAddCategory = () => {
        if (categoryInput.trim()) {
            setFormData(prev => ({
                ...prev,
                categories: [...prev.categories, { name: categoryInput.trim() }]
            }));
            setCategoryInput('');
        }
    };
    
    const handleAddTag = () => {
        if (tagInput.trim()) {
            setFormData(prev => ({
                ...prev,
                tags: [...prev.tags, { name: tagInput.trim() }]
            }));
            setTagInput('');
        }
    };
    
    const handleAddBrand = () => {
        if (brandInput.trim()) {
            setFormData(prev => ({
                ...prev,
                brands: [...prev.brands, brandInput.trim()]
            }));
            setBrandInput('');
        }
    };
    
    const handleAddImage = () => {
        if (imageUrl.trim()) {
            setFormData(prev => ({
                ...prev,
                images: [...prev.images, { src: imageUrl.trim() }]
            }));
            setImageUrl('');
        }
    };
    
    const handleRemoveCategory = (index) => {
        setFormData(prev => ({
            ...prev,
            categories: prev.categories.filter((_, i) => i !== index)
        }));
    };
    
    const handleRemoveTag = (index) => {
        setFormData(prev => ({
            ...prev,
            tags: prev.tags.filter((_, i) => i !== index)
        }));
    };
    
    const handleRemoveBrand = (index) => {
        setFormData(prev => ({
            ...prev,
            brands: prev.brands.filter((_, i) => i !== index)
        }));
    };
    
    const handleRemoveImage = (index) => {
        setFormData(prev => ({
            ...prev,
            images: prev.images.filter((_, i) => i !== index)
        }));
    };
    
    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!formData.name.trim()) {
            alert('שם המוצר הוא שדה חובה');
            return;
        }
        
        setIsSaving(true);
        
        try {
            const { data } = await base44.functions.invoke('createWooProduct', {
                productData: formData
            });
            
            if (data.success) {
                alert(`✅ המוצר נוצר בהצלחה!\n\nניתן לראות את המוצר באתר:\n${data.permalink || 'בקרוב'}`);
                onSuccess();
            } else {
                alert(`❌ שגיאה ביצירת מוצר:\n\n${data.error}`);
            }
        } catch (error) {
            console.error('Error creating product:', error);
            alert(`❌ שגיאה ביצירת מוצר:\n\n${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };
    
    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" dir="rtl">
            <div className="w-full max-w-4xl max-h-[90vh] bg-white rounded-lg shadow-xl flex flex-col">
                <div className="flex items-center justify-between p-4 border-b bg-white rounded-t-lg flex-shrink-0">
                    <h2 className="text-xl font-bold">{product ? 'עריכת מוצר' : 'מוצר חדש'}</h2>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="w-5 h-5" />
                    </Button>
                </div>
                <div className="overflow-y-auto flex-1 p-6">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        
                        {/* Basic Info */}
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">פרטים בסיסיים</h3>
                            
                            <div>
                                <Label>שם המוצר *</Label>
                                <Input
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="לדוגמה: iPhone 15 Pro"
                                    required
                                />
                            </div>
                            
                            <div>
                                <Label>תיאור קצר</Label>
                                <Textarea
                                    value={formData.short_description}
                                    onChange={(e) => setFormData({ ...formData, short_description: e.target.value })}
                                    placeholder="תיאור קצר למוצר"
                                    rows={2}
                                />
                            </div>
                            
                            <div>
                                <Label>תיאור מלא</Label>
                                <Textarea
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    placeholder="תיאור מפורט של המוצר"
                                    rows={4}
                                />
                            </div>
                            
                            <div>
                                <Label>מק"ט (SKU)</Label>
                                <Input
                                    value={formData.sku}
                                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                                    placeholder="לדוגמה: IPHONE15PRO"
                                />
                            </div>
                        </div>
                        
                        {/* Pricing */}
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">תמחור</h3>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>מחיר עלות (לפני מע"מ)</Label>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        value={formData.cost_price}
                                        onChange={(e) => setFormData({ ...formData, cost_price: e.target.value })}
                                        placeholder="0.00"
                                    />
                                </div>
                                <div>
                                    <Label>מחיר עלות (אחרי מע"מ)</Label>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        value={formData.cost_price_vat}
                                        onChange={(e) => setFormData({ ...formData, cost_price_vat: e.target.value })}
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>מחיר מכירה *</Label>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        value={formData.regular_price}
                                        onChange={(e) => setFormData({ ...formData, regular_price: e.target.value })}
                                        placeholder="0.00"
                                        required
                                    />
                                </div>
                                <div>
                                    <Label>מחיר מבצע</Label>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        value={formData.sale_price}
                                        onChange={(e) => setFormData({ ...formData, sale_price: e.target.value })}
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>
                        </div>
                        
                        {/* Categories */}
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">קטגוריות</h3>
                            <div className="flex gap-2">
                                <Input
                                    value={categoryInput}
                                    onChange={(e) => setCategoryInput(e.target.value)}
                                    placeholder="הוסף קטגוריה"
                                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddCategory())}
                                />
                                <Button type="button" onClick={handleAddCategory}>הוסף</Button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {formData.categories.map((cat, idx) => (
                                    <span key={idx} className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm flex items-center gap-2">
                                        {cat.name}
                                        <button type="button" onClick={() => handleRemoveCategory(idx)} className="hover:text-blue-600">×</button>
                                    </span>
                                ))}
                            </div>
                        </div>
                        
                        {/* Tags */}
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">תגיות</h3>
                            <div className="flex gap-2">
                                <Input
                                    value={tagInput}
                                    onChange={(e) => setTagInput(e.target.value)}
                                    placeholder="הוסף תגית"
                                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                                />
                                <Button type="button" onClick={handleAddTag}>הוסף</Button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {formData.tags.map((tag, idx) => (
                                    <span key={idx} className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm flex items-center gap-2">
                                        {tag.name}
                                        <button type="button" onClick={() => handleRemoveTag(idx)} className="hover:text-purple-600">×</button>
                                    </span>
                                ))}
                            </div>
                        </div>
                        
                        {/* Brands */}
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">מותגים</h3>
                            <div className="flex gap-2">
                                <Input
                                    value={brandInput}
                                    onChange={(e) => setBrandInput(e.target.value)}
                                    placeholder="הוסף מותג"
                                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddBrand())}
                                />
                                <Button type="button" onClick={handleAddBrand}>הוסף</Button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {formData.brands.map((brand, idx) => (
                                    <span key={idx} className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm flex items-center gap-2">
                                        {brand}
                                        <button type="button" onClick={() => handleRemoveBrand(idx)} className="hover:text-green-600">×</button>
                                    </span>
                                ))}
                            </div>
                        </div>
                        
                        {/* Images */}
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">תמונות</h3>
                            <div className="flex gap-2">
                                <Input
                                    value={imageUrl}
                                    onChange={(e) => setImageUrl(e.target.value)}
                                    placeholder="הדבק קישור לתמונה"
                                />
                                <Button type="button" onClick={handleAddImage}>
                                    <Upload className="w-4 h-4 ml-2" />
                                    הוסף
                                </Button>
                            </div>
                            <div className="grid grid-cols-4 gap-4">
                                {formData.images.map((img, idx) => (
                                    <div key={idx} className="relative">
                                        <img src={img.src} alt="" className="w-full h-24 object-cover rounded" />
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveImage(idx)}
                                            className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600"
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                        
                        {/* Stock */}
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">מלאי</h3>
                            
                            <div className="flex items-center gap-3">
                                <Switch
                                    checked={formData.manage_stock}
                                    onCheckedChange={(checked) => setFormData({ ...formData, manage_stock: checked })}
                                />
                                <Label>ניהול מלאי</Label>
                            </div>
                            
                            {formData.manage_stock && (
                                <div>
                                    <Label>כמות במלאי</Label>
                                    <Input
                                        type="number"
                                        value={formData.stock_quantity}
                                        onChange={(e) => setFormData({ ...formData, stock_quantity: e.target.value })}
                                        placeholder="0"
                                    />
                                </div>
                            )}
                            
                            <div>
                                <Label>סטטוס מלאי</Label>
                                <select
                                    value={formData.stock_status}
                                    onChange={(e) => setFormData({ ...formData, stock_status: e.target.value })}
                                    className="w-full p-2 border rounded"
                                >
                                    <option value="instock">במלאי</option>
                                    <option value="outofstock">אזל</option>
                                    <option value="onbackorder">בהזמנה</option>
                                </select>
                            </div>
                        </div>
                        
                        {/* Status */}
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">סטטוס פרסום</h3>
                            
                            <div>
                                <Label>סטטוס</Label>
                                <select
                                    value={formData.status}
                                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                                    className="w-full p-2 border rounded"
                                >
                                    <option value="draft">טיוטה</option>
                                    <option value="publish">מפורסם</option>
                                    <option value="pending">ממתין</option>
                                    <option value="private">פרטי</option>
                                </select>
                            </div>
                            
                            <div className="flex items-center gap-3">
                                <Switch
                                    checked={formData.featured}
                                    onCheckedChange={(checked) => setFormData({ ...formData, featured: checked })}
                                />
                                <Label>מוצר מומלץ</Label>
                            </div>
                        </div>
                        
                        {/* Actions */}
                        <div className="flex justify-end gap-3 pt-4 border-t">
                            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
                                ביטול
                            </Button>
                            <Button type="submit" disabled={isSaving} className="bg-blue-600 hover:bg-blue-700">
                                {isSaving ? 'שומר...' : product ? 'עדכן' : 'פרסם'}
                            </Button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}