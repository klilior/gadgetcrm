import React, { useState, useEffect } from "react";
import { Product } from "@/entities/all";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Package, Plus, RefreshCw, Search, ExternalLink, Edit, StopCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";
import ProductFormModal from "../components/products/ProductFormModal";
import ImportCsvModal from "../components/products/ImportCsvModal";

export default function ProductsPage() {
    const [products, setProducts] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncProgress, setSyncProgress] = useState(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [showProductModal, setShowProductModal] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [totalCount, setTotalCount] = useState(null);
    const [showImportModal, setShowImportModal] = useState(false);
    const [itemsPerPage, setItemsPerPage] = useState(50);
    
    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchTerm);
            setCurrentPage(1); // Reset to first page on search change
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);
    
    useEffect(() => {
        loadProducts();
    }, [currentPage, debouncedSearch, itemsPerPage]);
    
    useEffect(() => {
        loadProductCount();
    }, []);
    
    const loadProducts = async () => {
        setIsLoading(true);
        try {
            const { data } = await base44.functions.invoke('getProducts', {
                page: currentPage,
                limit: itemsPerPage,
                search: debouncedSearch
            });
            
            setProducts(data.products || []);
            setHasMore(data.hasMore || false);
        } catch (error) {
            console.error("Error loading products:", error);
        } finally {
            setIsLoading(false);
        }
    };
    
    const loadProductCount = async () => {
        try {
            const { data } = await base44.functions.invoke('getProductsCount');
            setTotalCount(data.message || data.count);
        } catch (error) {
            console.error("Error loading product count:", error);
            setTotalCount('לא זמין');
        }
    };
    
    const handleSync = async () => {
        if (!confirm('האם לסנכרן את כל המוצרים מ-WooCommerce? פעולה זו תרוץ ברקע ותוכל לצאת מהעמוד.')) {
            return;
        }
        
        setIsSyncing(true);
        setSyncProgress({ status: 'running', total: 0, created: 0, updated: 0, errors: 0 });
        
        // Start sync in background (don't await)
        base44.functions.invoke('syncWooProducts').catch(error => {
            console.error("Sync error:", error);
        });
        
        // Poll for progress
        const pollInterval = setInterval(async () => {
            try {
                const settings = await base44.entities.Settings.filter({ 
                    setting_name: 'product_sync_progress' 
                });
                
                if (settings.length > 0) {
                    const progress = JSON.parse(settings[0].setting_value);
                    setSyncProgress(progress);
                    
                    if (progress.status === 'completed') {
                        clearInterval(pollInterval);
                        setIsSyncing(false);
                        alert(`✅ סנכרון הושלם!\n\nעובדו: ${progress.total}\nנוצרו: ${progress.created}\nעודכנו: ${progress.updated}\nשגיאות: ${progress.errors}`);
                        await loadProducts();
                        await loadProductCount();
                        setSyncProgress(null);
                    } else if (progress.status === 'paused' || progress.status === 'error') {
                        clearInterval(pollInterval);
                        setIsSyncing(false);
                    }
                }
            } catch (error) {
                console.error('Error polling progress:', error);
            }
        }, 3000);
        
        // Store interval ID for cleanup
        window.productSyncInterval = pollInterval;
    };
    
    const handleStopSync = async () => {
        try {
            const settings = await base44.entities.Settings.filter({ 
                setting_name: 'product_sync_progress' 
            });
            
            if (settings.length > 0) {
                const progress = JSON.parse(settings[0].setting_value);
                await base44.entities.Settings.update(settings[0].id, {
                    setting_value: JSON.stringify({ ...progress, shouldStop: true })
                });
            }
        } catch (error) {
            console.error('Error stopping sync:', error);
        }
    };
    
    const getStatusColor = (status) => {
        switch (status) {
            case 'publish': return 'bg-green-100 text-green-800';
            case 'draft': return 'bg-gray-100 text-gray-800';
            case 'pending': return 'bg-yellow-100 text-yellow-800';
            case 'private': return 'bg-purple-100 text-purple-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };
    
    const getStockColor = (stockStatus) => {
        switch (stockStatus) {
            case 'instock': return 'bg-green-100 text-green-800';
            case 'outofstock': return 'bg-red-100 text-red-800';
            case 'onbackorder': return 'bg-orange-100 text-orange-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };
    
    if (isLoading) {
        return <div className="p-6 text-center">טוען מוצרים...</div>;
    }
    
    return (
        <div className="p-4 sm:p-6 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center gap-3">
                    <Package className="w-8 h-8 text-blue-600" />
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">מוצרים</h1>
                        <p className="text-sm text-gray-500">
                            {totalCount !== null ? `${totalCount} מוצרים במערכת` : 'טוען...'}
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        onClick={() => setShowImportModal(true)}
                        variant="outline"
                        className="gap-2"
                    >
                        <Package className="w-4 h-4" />
                        ייבא מ-CSV
                    </Button>
                    <Button
                        onClick={handleSync}
                        disabled={isSyncing}
                        variant="outline"
                        className="gap-2"
                    >
                        <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                        {isSyncing ? 'מסנכרן...' : 'סנכרן מ-API'}
                    </Button>
                    <Button
                        onClick={() => {
                            setEditingProduct(null);
                            setShowProductModal(true);
                        }}
                        className="bg-blue-600 hover:bg-blue-700 gap-2"
                    >
                        <Plus className="w-4 h-4" />
                        מוצר חדש
                    </Button>
                </div>
            </div>
            
            <Card>
                <CardContent className="p-4">
                    <div className="space-y-3">
                        <div className="relative">
                            <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                            <Input
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="חיפוש לפי שם או מקט..."
                                className="pr-10"
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <label className="text-sm text-gray-600">מוצרים בעמוד:</label>
                                <select
                                    value={itemsPerPage}
                                    onChange={(e) => {
                                        setItemsPerPage(Number(e.target.value));
                                        setCurrentPage(1);
                                    }}
                                    className="border rounded px-2 py-1 text-sm"
                                >
                                    <option value={50}>50</option>
                                    <option value={100}>100</option>
                                    <option value={200}>200</option>
                                </select>
                            </div>
                            <span className="text-sm text-gray-500">
                                עמוד {currentPage}
                            </span>
                        </div>
                    </div>
                </CardContent>
            </Card>
            
            {syncProgress && (
                <Card className="border-blue-500 bg-blue-50">
                    <CardContent className="p-6 space-y-4">
                        <div className="flex justify-between items-center">
                            <div>
                                <h3 className="font-semibold text-lg">מסנכרן מוצרים...</h3>
                                <p className="text-sm text-gray-600">
                                    עמוד {syncProgress.page} • {syncProgress.total} מוצרים עובדו
                                </p>
                            </div>
                            <Button 
                                onClick={handleStopSync} 
                                variant="destructive" 
                                size="sm"
                                disabled={syncProgress.status !== 'running'}
                            >
                                <StopCircle className="w-4 h-4 ml-2" />
                                עצור
                            </Button>
                        </div>
                        
                        <div className="space-y-2">
                            <Progress value={100} className="h-2 animate-pulse" />
                            <div className="grid grid-cols-3 gap-4 text-center text-sm">
                                <div>
                                    <div className="font-semibold text-green-600">{syncProgress.created}</div>
                                    <div className="text-gray-600">נוצרו</div>
                                </div>
                                <div>
                                    <div className="font-semibold text-blue-600">{syncProgress.updated}</div>
                                    <div className="text-gray-600">עודכנו</div>
                                </div>
                                <div>
                                    <div className="font-semibold text-red-600">{syncProgress.errors}</div>
                                    <div className="text-gray-600">שגיאות</div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}
            
            <div className="grid gap-4">
                {products.map(product => (
                    <Card key={product.id} className="hover:shadow-lg transition-shadow">
                        <CardContent className="p-4">
                            <div className="flex flex-col sm:flex-row gap-4">
                                <div className="flex-shrink-0">
                                    {product.images && product.images[0] ? (
                                        <img 
                                            src={product.images[0].src} 
                                            alt={product.name}
                                            className="w-24 h-24 object-cover rounded-lg"
                                        />
                                    ) : (
                                        <div className="w-24 h-24 bg-gray-100 rounded-lg flex items-center justify-center">
                                            <Package className="w-8 h-8 text-gray-400" />
                                        </div>
                                    )}
                                </div>
                                
                                <div className="flex-1 space-y-2">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <h3 className="font-semibold text-lg">{product.name}</h3>
                                            {product.sku && (
                                                <p className="text-sm text-gray-500">מקט: {product.sku}</p>
                                            )}
                                        </div>
                                        <div className="flex gap-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => {
                                                    setEditingProduct(product);
                                                    setShowProductModal(true);
                                                }}
                                            >
                                                <Edit className="w-4 h-4" />
                                            </Button>
                                            {product.permalink && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => window.open(product.permalink, '_blank')}
                                                >
                                                    <ExternalLink className="w-4 h-4" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    
                                    <div className="flex flex-wrap gap-2">
                                        <Badge className={getStatusColor(product.status)}>
                                            {product.status === 'publish' ? 'מפורסם' : 
                                             product.status === 'draft' ? 'טיוטה' :
                                             product.status === 'pending' ? 'ממתין' : 'פרטי'}
                                        </Badge>
                                        <Badge className={getStockColor(product.stock_status)}>
                                            {product.stock_status === 'instock' ? 'במלאי' :
                                             product.stock_status === 'outofstock' ? 'אזל' : 'בהזמנה'}
                                        </Badge>
                                        {product.on_sale && (
                                            <Badge className="bg-red-100 text-red-800">מבצע</Badge>
                                        )}
                                        {product.featured && (
                                            <Badge className="bg-yellow-100 text-yellow-800">מומלץ</Badge>
                                        )}
                                    </div>
                                    
                                    {product.categories && product.categories.length > 0 && (
                                        <div className="flex flex-wrap gap-1">
                                            {product.categories.map(cat => (
                                                <span key={cat.id} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded">
                                                    {cat.name}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    
                                    <div className="flex items-center justify-between text-sm">
                                        <div className="space-x-4 space-x-reverse">
                                            {product.regular_price && (
                                                <span className={product.on_sale ? 'line-through text-gray-400' : 'font-semibold'}>
                                                    ₪{product.regular_price}
                                                </span>
                                            )}
                                            {product.sale_price && (
                                                <span className="font-semibold text-red-600">
                                                    ₪{product.sale_price}
                                                </span>
                                            )}
                                        </div>
                                        {product.manage_stock && product.stock_quantity !== null && (
                                            <span className="text-gray-600">
                                                מלאי: {product.stock_quantity}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}

                <div className="flex justify-center items-center gap-2 mt-6">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1 || isLoading}
                    >
                        ראשון
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1 || isLoading}
                    >
                        הקודם
                    </Button>
                    <span className="px-4 py-2 text-sm font-medium">
                        עמוד {currentPage}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(prev => prev + 1)}
                        disabled={!hasMore || isLoading}
                    >
                        הבא
                    </Button>
                </div>

                {products.length === 0 && !isLoading && (
                    <Card>
                        <CardContent className="p-12 text-center text-gray-500">
                            <Package className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                            <p>
                                {searchTerm ? 'לא נמצאו מוצרים תואמים' : 'אין מוצרים במערכת'}
                            </p>
                            {!searchTerm && (
                                <div className="mt-4 space-y-2">
                                    <Button onClick={handleSync} variant="outline">
                                        סנכרן מוצרים מ-WooCommerce
                                    </Button>
                                    <p className="text-sm">או</p>
                                    <Button onClick={() => setShowProductModal(true)}>
                                        צור מוצר חדש
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}
            </div>
            
            {showProductModal && (
                <ProductFormModal
                    product={editingProduct}
                    onClose={() => {
                        setShowProductModal(false);
                        setEditingProduct(null);
                    }}
                    onSuccess={() => {
                        loadProducts();
                        setShowProductModal(false);
                        setEditingProduct(null);
                    }}
                />
            )}

            <ImportCsvModal
                isOpen={showImportModal}
                onClose={() => setShowImportModal(false)}
                onSuccess={() => {
                    loadProducts();
                    setShowImportModal(false);
                }}
            />
            </div>
            );
            }