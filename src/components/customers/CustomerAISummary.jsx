import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Brain, RefreshCw, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export default function CustomerAISummary({ customer, orders, repairs, tickets, devices }) {
    const [summary, setSummary] = useState(customer?.ai_summary || null);
    const [isGenerating, setIsGenerating] = useState(false);

    const generateSummary = async () => {
        setIsGenerating(true);
        try {
            const prompt = `אתה מנתח לקוחות מומחה של חנות טכנולוגיה (גאדג'ט טים). נתח את הלקוח הבא ותן סיכום קצר וממוקד:

**פרטי לקוח:**
- שם: ${customer.full_name}
- טלפון: ${customer.phone || 'לא זמין'}
- עיר: ${customer.city || 'לא זמין'}
- לקוח מאז: ${customer.created_date ? new Date(customer.created_date).toLocaleDateString('he-IL') : 'לא ידוע'}
- ציון נוכחי: ${customer.customer_score || 0}/100, דרגה: ${customer.customer_tier || 'חדש'}

**הזמנות (${orders?.length || 0}):**
${orders?.slice(0, 10).map(o => `- #${o.external_order_number}: ₪${o.total} (${o.status}) - ${o.order_date?.split('T')[0] || ''}`).join('\n') || 'אין'}

**תיקונים (${repairs?.length || 0}):**
${repairs?.slice(0, 10).map(r => `- #${r.repair_id}: ${r.issue_category} - ${r.status} (${r.created_date?.split('T')[0] || ''})`).join('\n') || 'אין'}

**פניות שירות (${tickets?.length || 0}):**
${tickets?.slice(0, 5).map(t => `- ${t.subject} (${t.status})`).join('\n') || 'אין'}

**מכשירים (${devices?.length || 0}):**
${devices?.slice(0, 5).map(d => `- ${d.manufacturer || ''} ${d.model}`).join('\n') || 'אין'}

תן סיכום קצר (3-5 שורות) בפורמט:
1. **סוג לקוח** - VIP/חוזר/חד-פעמי + סיבה
2. **דפוס** - מה קונה, תדירות, מותגים
3. **המלצה** - פעולה אחת ספציפית לשיפור הקשר/מכירה`;

            const result = await base44.integrations.Core.InvokeLLM({ prompt });
            setSummary(result);

            // Save to customer
            await base44.entities.Client.update(customer.id, {
                ai_summary: result,
                ai_summary_date: new Date().toISOString()
            });
        } catch (err) {
            console.error('AI summary error:', err);
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <Card className="border-purple-200 bg-gradient-to-br from-purple-50/50 to-indigo-50/50">
            <CardHeader className="pb-3">
                <div className="flex justify-between items-center">
                    <CardTitle className="flex items-center gap-2 text-purple-800">
                        <Brain className="w-5 h-5" />
                        ניתוח AI
                    </CardTitle>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={generateSummary}
                        disabled={isGenerating}
                        className="gap-1 text-purple-700 border-purple-300 hover:bg-purple-100"
                    >
                        {isGenerating ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                            <Sparkles className="w-3 h-3" />
                        )}
                        {summary ? 'רענן' : 'צור ניתוח'}
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                {isGenerating ? (
                    <div className="flex items-center gap-3 py-4">
                        <RefreshCw className="w-5 h-5 text-purple-500 animate-spin" />
                        <span className="text-purple-700">מנתח את הלקוח...</span>
                    </div>
                ) : summary ? (
                    <div className="prose prose-sm prose-purple max-w-none text-gray-700">
                        <ReactMarkdown>{summary}</ReactMarkdown>
                        {customer?.ai_summary_date && (
                            <p className="text-[10px] text-gray-400 mt-2">
                                עודכן: {new Date(customer.ai_summary_date).toLocaleDateString('he-IL')}
                            </p>
                        )}
                    </div>
                ) : (
                    <p className="text-sm text-gray-500 py-2">
                        לחץ "צור ניתוח" לקבלת תובנות AI על הלקוח
                    </p>
                )}
            </CardContent>
        </Card>
    );
}