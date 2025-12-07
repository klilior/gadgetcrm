import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, ExternalLink, X } from "lucide-react";
import { format } from "date-fns";

/**
 * SalesDrilldown - קומפוננט כללי להצגת פירוט מכירות
 * 
 * Props:
 * - isOpen: Boolean
 * - onClose: Function
 * - title: String - כותרת המודל
 * - filters: Object - פילטרים לשאילתת מכירות
 * - dateFrom/dateTo: String - טווח תאריכים
 * - groupCode: String - DEVICES/LINES/ACCESSORIES_GROUP
 * - mappings: Array - רשימת CommissionGroupMapping לסינון
 */
export default function SalesDrilldown({ 
    isOpen, 
    onClose, 
    title = "פירוט מכירות",
    agentName,
    filters = {},
    dateFrom,
    dateTo,
    groupCode = null,
    mappings = []
}) {
    const [sales, setSales] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [summary, setSummary] = useState({ count: 0, totalQty: 0, totalNet: 0 });

    useEffect(() => {
        if (isOpen) {
            loadSales();
        }
    }, [isOpen, filters, dateFrom, dateTo]);

    // Function to determine commission group for a sale
    const getCommissionGroup = (sale) => {
        const sortedMappings = [...mappings].sort((a, b) => (b.priority || 0) - (a.priority || 0));
        for (const mapping of sortedMappings) {
            if (checkFilters(sale, mapping.filters_json)) {
                return mapping.commission_group_code;
            }
        }
        return null;
    };

    const checkFilters = (sale, filters) => {
        if (!filters) return false;

        if (filters.category_in && filters.category_in.length > 0) {
            if (!filters.category_in.includes(sale.category)) return false;
        }

        if (filters.category && sale.category !== filters.category) {
            return false;
        }

        if (filters.product_name_contains) {
            if (!sale.product_name || !sale.product_name.includes(filters.product_name_contains)) {
                return false;
            }
        }

        return true;
    };

    const loadSales = async () => {
        setIsLoading(true);
        try {
            const query = {
                ...filters,
                issue_date: { $gte: dateFrom, $lte: dateTo }
            };

            if (agentName) {
                query.sales_rep = agentName;
            }

            const data = await base44.entities.SalesTransaction.filter(query, '-issue_date', 2000);
            
            // Filter by commission group if specified
            let filteredData = data;
            if (groupCode && mappings.length > 0) {
                filteredData = data.filter(sale => getCommissionGroup(sale) === groupCode);
            }
            
            // Remove duplicates based on unique ID (each record should have a unique id field)
            const uniqueSales = [];
            const seenIds = new Set();
            
            for (const sale of filteredData) {
                if (!seenIds.has(sale.id)) {
                    seenIds.add(sale.id);
                    uniqueSales.push(sale);
                }
            }
            
            // Calculate summary
            const totalQty = uniqueSales.reduce((sum, s) => sum + Math.abs(s.quantity || 0), 0);
            const totalNet = uniqueSales.reduce((sum, s) => sum + (s.price_ex_vat || 0), 0);

            console.log('🔍 Drilldown Debug:', {
                totalRecords: data.length,
                afterGroupFilter: filteredData.length,
                afterDedup: uniqueSales.length,
                duplicatesRemoved: filteredData.length - uniqueSales.length
            });

            setSales(uniqueSales);
            setSummary({
                count: uniqueSales.length,
                totalQty,
                totalNet
            });
        } catch (error) {
            console.error("Error loading drill-down sales:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const getLinetDocUrl = (sale) => {
        // יצירת URL ללינט - להתאים לפי המבנה של לינט
        if (sale.linet_doc_id) {
            return `https://app.linet.org.il/api/docs/${sale.linet_doc_id}`;
        }
        return null;
    };

    const formatGroupCode = (code) => {
        const labels = {
            'DEVICES': 'מכשירים',
            'LINES': 'קווים',
            'ACCESSORIES_GROUP': 'אביזרים'
        };
        return labels[code] || code;
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-6xl max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader className="border-b pb-4">
                    <div className="flex justify-between items-start">
                        <div>
                            <DialogTitle className="text-xl">{title}</DialogTitle>
                            <div className="text-sm text-gray-600 mt-2 space-x-3 space-x-reverse">
                                {agentName && <span>נציג: <strong>{agentName}</strong></span>}
                                {groupCode && <span>קבוצה: <strong>{formatGroupCode(groupCode)}</strong></span>}
                                <span>תקופה: <strong>{dateFrom}</strong> עד <strong>{dateTo}</strong></span>
                            </div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={onClose}>
                            <X className="w-4 h-4" />
                        </Button>
                    </div>
                </DialogHeader>

                {/* Summary Cards */}
                <div className="grid grid-cols-3 gap-3 py-4">
                    <div className="bg-blue-50 p-3 rounded-lg text-center">
                        <p className="text-xs text-gray-600">שורות</p>
                        <p className="text-2xl font-bold text-blue-600">{summary.count}</p>
                    </div>
                    <div className="bg-green-50 p-3 rounded-lg text-center">
                        <p className="text-xs text-gray-600">כמות כוללת</p>
                        <p className="text-2xl font-bold text-green-600">{summary.totalQty.toLocaleString()}</p>
                    </div>
                    <div className="bg-purple-50 p-3 rounded-lg text-center">
                        <p className="text-xs text-gray-600">נטו כולל</p>
                        <p className="text-2xl font-bold text-purple-600">₪{summary.totalNet.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                    </div>
                </div>

                {/* Sales Table */}
                <div className="flex-1 overflow-y-auto border rounded-lg">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
                        </div>
                    ) : sales.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <p>לא נמצאו רשומות תואמות</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader className="sticky top-0 bg-gray-50 z-10">
                                <TableRow>
                                    <TableHead className="w-24">תאריך</TableHead>
                                    <TableHead className="w-28">מסמך</TableHead>
                                    <TableHead>לקוח</TableHead>
                                    <TableHead>מוצר</TableHead>
                                    <TableHead className="w-32">קטגוריה</TableHead>
                                    <TableHead className="w-24">מק"ט</TableHead>
                                    <TableHead className="text-center w-20">כמות</TableHead>
                                    <TableHead className="text-left w-28">מחיר יח'</TableHead>
                                    <TableHead className="text-left w-28">נטו</TableHead>
                                    <TableHead className="w-20"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sales.map((sale) => {
                                    const linetUrl = getLinetDocUrl(sale);
                                    return (
                                        <TableRow key={sale.id} className="hover:bg-gray-50">
                                            <TableCell className="text-xs">
                                                {sale.issue_date ? format(new Date(sale.issue_date), 'dd/MM') : '-'}
                                            </TableCell>
                                            <TableCell className="text-xs">
                                                <div className="flex flex-col">
                                                    <span className="font-medium">{sale.doc_number || '-'}</span>
                                                    {sale.doc_type?.includes('זיכוי') && (
                                                        <Badge variant="destructive" className="text-xs w-fit">זיכוי</Badge>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs max-w-[150px] truncate" title={sale.customer_name}>
                                                {sale.customer_name || '-'}
                                            </TableCell>
                                            <TableCell className="text-xs max-w-[200px] truncate" title={sale.product_name}>
                                                {sale.product_name || '-'}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="text-xs">
                                                    {sale.category || 'ללא'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-xs text-gray-500">
                                                {sale.sku || '-'}
                                            </TableCell>
                                            <TableCell className="text-center font-bold text-sm">
                                                {sale.quantity || 0}
                                            </TableCell>
                                            <TableCell className="text-left text-xs" dir="ltr">
                                                ₪{(sale.unit_price || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </TableCell>
                                            <TableCell className="text-left font-medium text-sm" dir="ltr">
                                                ₪{(sale.price_ex_vat || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </TableCell>
                                            <TableCell>
                                                {linetUrl && (
                                                    <a 
                                                        href={linetUrl} 
                                                        target="_blank" 
                                                        rel="noopener noreferrer"
                                                        className="text-blue-600 hover:text-blue-800"
                                                        title="פתח בלינט"
                                                    >
                                                        <ExternalLink className="w-4 h-4" />
                                                    </a>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}
                </div>

                {sales.length > 0 && (
                    <div className="border-t pt-3 text-sm text-gray-600 text-center">
                        מציג {sales.length} שורות
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}