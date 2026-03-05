import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Receipt } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

export default function CustomerInvoicesTab({ invoices }) {
    if (!invoices || invoices.length === 0) {
        return (
            <div className="text-center py-10 text-gray-500">
                <Receipt className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <p>אין חשבוניות ללקוח זה</p>
            </div>
        );
    }

    // Group by doc_number
    const grouped = {};
    invoices.forEach(inv => {
        const key = inv.doc_number;
        if (!grouped[key]) {
            grouped[key] = {
                doc_number: inv.doc_number,
                doc_type: inv.doc_type,
                issue_date: inv.issue_date,
                sales_rep: inv.sales_rep,
                customer_name: inv.customer_name,
                lines: [],
                total: 0,
            };
        }
        grouped[key].lines.push(inv);
        grouped[key].total += inv.total_row_amount || 0;
    });

    const invoiceGroups = Object.values(grouped).sort((a, b) => 
        new Date(b.issue_date) - new Date(a.issue_date)
    );

    const totalAmount = invoiceGroups.reduce((sum, g) => sum + g.total, 0);

    return (
        <div className="space-y-4">
            <div className="flex gap-3 flex-wrap">
                <Badge variant="outline" className="bg-indigo-50 border-indigo-200 text-indigo-700 px-3 py-1">
                    <Receipt className="w-3.5 h-3.5 ml-1" />
                    {invoiceGroups.length} חשבוניות
                </Badge>
                <Badge variant="outline" className="bg-green-50 border-green-200 text-green-700 px-3 py-1">
                    סה"כ ₪{Math.round(totalAmount).toLocaleString()}
                </Badge>
            </div>

            {invoiceGroups.map(group => {
                const isCredit = group.doc_type?.includes('זיכוי');
                return (
                    <Card key={group.doc_number} className="hover:shadow-lg transition-shadow">
                        <CardContent className="p-4">
                            <div className="flex justify-between items-start">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className="font-semibold text-lg">חשבונית #{group.doc_number}</p>
                                        <Badge className={isCredit ? 'bg-red-100 text-red-700' : 'bg-indigo-100 text-indigo-700'}>
                                            {group.doc_type || 'חשבונית'}
                                        </Badge>
                                    </div>
                                    <p className="text-sm text-gray-500 mt-1">
                                        {group.issue_date ? format(new Date(group.issue_date), 'dd/MM/yyyy', { locale: he }) : ''}
                                        {group.sales_rep ? ` • ${group.sales_rep}` : ''}
                                    </p>
                                    <div className="mt-3 space-y-1">
                                        {group.lines.map((line, i) => (
                                            <div key={i} className="flex justify-between items-center text-sm">
                                                <div className="flex-1 min-w-0">
                                                    <span className="text-gray-700 truncate block">
                                                        {line.product_name || line.sku}
                                                    </span>
                                                    {line.sku && <span className="text-[10px] text-gray-400">מק"ט: {line.sku}</span>}
                                                </div>
                                                <div className="flex items-center gap-3 text-xs text-gray-600 flex-shrink-0">
                                                    <span>×{line.quantity}</span>
                                                    <span className="font-medium">₪{(line.total_row_amount || 0).toLocaleString()}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="text-left mr-4 flex-shrink-0">
                                    <p className={`text-2xl font-bold ${isCredit ? 'text-red-600' : 'text-green-600'}`}>
                                        ₪{Math.round(group.total).toLocaleString()}
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}