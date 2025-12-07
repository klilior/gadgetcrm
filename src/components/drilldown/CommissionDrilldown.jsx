import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, ExternalLink, X } from "lucide-react";
import { format } from "date-fns";

/**
 * CommissionDrilldown - פירוט עמלות בסיס (CommissionEntry)
 */
export default function CommissionDrilldown({ 
    isOpen, 
    onClose, 
    agentName,
    dateFrom,
    dateTo
}) {
    const [entries, setEntries] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [summary, setSummary] = useState({ count: 0, totalCommission: 0 });

    useEffect(() => {
        if (isOpen && agentName) {
            loadEntries();
        }
    }, [isOpen, agentName, dateFrom, dateTo]);

    const loadEntries = async () => {
        setIsLoading(true);
        try {
            const data = await base44.entities.CommissionEntry.filter({
                agent_name: agentName,
                issue_date: { $gte: dateFrom, $lte: dateTo }
            }, '-issue_date', 2000);

            const totalCommission = data.reduce((sum, e) => sum + (e.commission_amount || 0), 0);

            setEntries(data);
            setSummary({
                count: data.length,
                totalCommission
            });
        } catch (error) {
            console.error("Error loading commission entries:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const getLinetDocUrl = (entry) => {
        // נסה למצוא את המסמך המקורי
        if (entry.sale_details?.linet_doc_id) {
            return `https://app.linet.org.il/api/docs/${entry.sale_details.linet_doc_id}`;
        }
        return null;
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-6xl max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader className="border-b pb-4">
                    <div className="flex justify-between items-start">
                        <div>
                            <DialogTitle className="text-xl">פירוט עמלות בסיס - {agentName}</DialogTitle>
                            <div className="text-sm text-gray-600 mt-2">
                                תקופה: <strong>{dateFrom}</strong> עד <strong>{dateTo}</strong>
                            </div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={onClose}>
                            <X className="w-4 h-4" />
                        </Button>
                    </div>
                </DialogHeader>

                {/* Summary */}
                <div className="grid grid-cols-2 gap-3 py-4">
                    <div className="bg-blue-50 p-3 rounded-lg text-center">
                        <p className="text-xs text-gray-600">רשומות</p>
                        <p className="text-2xl font-bold text-blue-600">{summary.count}</p>
                    </div>
                    <div className="bg-green-50 p-3 rounded-lg text-center">
                        <p className="text-xs text-gray-600">סה"כ עמלה</p>
                        <p className="text-2xl font-bold text-green-600">₪{summary.totalCommission.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                    </div>
                </div>

                {/* Entries Table */}
                <div className="flex-1 overflow-y-auto border rounded-lg">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
                        </div>
                    ) : entries.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <p>לא נמצאו רשומות עמלה</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader className="sticky top-0 bg-gray-50 z-10">
                                <TableRow>
                                    <TableHead className="w-24">תאריך</TableHead>
                                    <TableHead>חוק עמלה</TableHead>
                                    <TableHead className="w-32">סוג</TableHead>
                                    <TableHead>מוצר</TableHead>
                                    <TableHead>קטגוריה</TableHead>
                                    <TableHead className="text-center w-20">כמות בסיס</TableHead>
                                    <TableHead className="text-left w-28">נטו בסיס</TableHead>
                                    <TableHead className="text-left w-28 font-bold">עמלה</TableHead>
                                    <TableHead className="w-20"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {entries.map((entry) => {
                                    const linetUrl = getLinetDocUrl(entry);
                                    return (
                                        <TableRow key={entry.id} className="hover:bg-gray-50">
                                            <TableCell className="text-xs">
                                                {entry.issue_date ? format(new Date(entry.issue_date), 'dd/MM') : '-'}
                                            </TableCell>
                                            <TableCell className="text-xs font-medium">
                                                {entry.rule_name || '-'}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="text-xs">
                                                    {entry.rule_type || '-'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-xs max-w-[200px] truncate" title={entry.sale_details?.product_name}>
                                                {entry.sale_details?.product_name || '-'}
                                            </TableCell>
                                            <TableCell className="text-xs">
                                                {entry.sale_details?.category || '-'}
                                            </TableCell>
                                            <TableCell className="text-center text-sm">
                                                {entry.base_quantity || '-'}
                                            </TableCell>
                                            <TableCell className="text-left text-xs" dir="ltr">
                                                {entry.base_net_amount ? `₪${entry.base_net_amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-'}
                                            </TableCell>
                                            <TableCell className="text-left font-bold text-sm text-green-600" dir="ltr">
                                                ₪{(entry.commission_amount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
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
            </DialogContent>
        </Dialog>
    );
}