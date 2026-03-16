import React, { useState, useEffect } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';

function buildContextPrompt(customer, orders, repairs, tickets, devices, invoices) {
  const lines = [];
  lines.push(`שם לקוח: ${customer.full_name}`);
  if (customer.customer_tier) lines.push(`דרגת לקוח: ${customer.customer_tier}`);

  // Recent active orders (processing/on-hold)
  const activeOrders = orders.filter(o => ['processing', 'on-hold', 'pending'].includes(o.status));
  if (activeOrders.length > 0) {
    lines.push(`\nהזמנות פעילות (${activeOrders.length}):`);
    activeOrders.slice(0, 3).forEach(o => {
      const d = o.order_date ? new Date(o.order_date).toLocaleDateString('he-IL') : '';
      lines.push(`- הזמנה #${o.external_order_number || o.id}, סטטוס: ${o.status}, סכום: ₪${o.total || 0}, תאריך: ${d}`);
    });
  }

  // Recently completed orders (last 14 days)
  const twoWeeksAgo = new Date(); twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const recentCompleted = orders.filter(o => {
    if (o.status !== 'completed') return false;
    return o.order_date && new Date(o.order_date) >= twoWeeksAgo;
  });
  if (recentCompleted.length > 0) {
    lines.push(`\nהזמנות שהושלמו לאחרונה (${recentCompleted.length}):`);
    recentCompleted.slice(0, 3).forEach(o => {
      const d = o.order_date ? new Date(o.order_date).toLocaleDateString('he-IL') : '';
      lines.push(`- הזמנה #${o.external_order_number || o.id}, סכום: ₪${o.total || 0}, ${d}`);
    });
  }

  // Open repairs
  const openRepairs = repairs.filter(r => !['תיקון נסגר', 'לא ניתן לתיקון', 'נמסר', 'הושלם', 'בוטל'].includes(r.status));
  if (openRepairs.length > 0) {
    lines.push(`\nתיקונים פתוחים (${openRepairs.length}):`);
    openRepairs.slice(0, 3).forEach(r => {
      lines.push(`- סטטוס: ${r.status}, בעיה: ${r.issue_category || ''} - ${r.issue_description || ''}`);
    });
  }

  // Open tickets
  const openTickets = tickets.filter(t => !['נסגר', 'נסגר ללא מענה', 'בוטל'].includes(t.status));
  if (openTickets.length > 0) {
    lines.push(`\nפניות פתוחות (${openTickets.length}):`);
    openTickets.slice(0, 3).forEach(t => {
      lines.push(`- "${t.subject}", סטטוס: ${t.status}, סוג: ${t.inquiry_type || ''}`);
    });
  }

  // Devices
  if (devices.length > 0) {
    lines.push(`\nמכשירים רשומים:`);
    devices.slice(0, 5).forEach(d => {
      const purchaseInfo = d.purchase_date ? `, רכישה: ${new Date(d.purchase_date).toLocaleDateString('he-IL')}` : '';
      lines.push(`- ${d.manufacturer || ''} ${d.model}${purchaseInfo}`);
    });
  }

  // Recent Linet invoices (last 30 days)
  const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
  const recentInvoices = invoices.filter(i => i.issue_date && new Date(i.issue_date) >= monthAgo);
  if (recentInvoices.length > 0) {
    lines.push(`\nחשבוניות אחרונות (חודש אחרון, ${recentInvoices.length}):`);
    recentInvoices.slice(0, 5).forEach(i => {
      lines.push(`- ${i.product_name || 'מוצר'} (מק״ט: ${i.sku || '-'}), כמות: ${i.quantity || 1}, סכום: ₪${i.total_row_amount || 0}, ${new Date(i.issue_date).toLocaleDateString('he-IL')}`);
    });
  }

  return lines.join('\n');
}

export default function CallContextInsight({ customer, orders, repairs, tickets, devices, invoices }) {
  const [insight, setInsight] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function generate() {
      const context = buildContextPrompt(customer, orders || [], repairs || [], tickets || [], devices || [], invoices || []);
      
      // If there's basically no data, skip
      if (!orders?.length && !repairs?.length && !tickets?.length && !devices?.length && !invoices?.length) {
        setInsight('לקוח חדש - אין היסטוריה קודמת');
        setLoading(false);
        return;
      }

      try {
        const result = await base44.integrations.Core.InvokeLLM({
          prompt: `אתה עוזר לנציג שירות לקוחות. לקוח מתקשר כרגע. תן תקציר קצר מאוד (2-3 משפטים) של מה שכנראה הלקוח צריך, על סמך הפעילות האחרונה שלו. התמקד בדבר הכי רלוונטי - הזמנה פעילה? תיקון? רכישת מכשיר אחרונה? פנייה פתוחה? תן לנציג הכנה מהירה.

נתוני לקוח:
${context}

כתוב בעברית, קצר ותכליתי. אל תחזור על כל הנתונים - רק מה שהנציג צריך לדעת ברגע השיחה.`,
        });
        if (!cancelled) setInsight(result);
      } catch (e) {
        if (!cancelled) setInsight('לא ניתן ליצור תקציר');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    generate();
    return () => { cancelled = true; };
  }, [customer?.id]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 bg-purple-50 p-2.5 rounded-lg text-sm border border-purple-200">
        <Loader2 className="w-4 h-4 text-purple-500 animate-spin flex-shrink-0" />
        <span className="text-purple-600">מנתח הקשר לקוח...</span>
      </div>
    );
  }

  if (!insight) return null;

  return (
    <div className="bg-gradient-to-r from-purple-50 to-indigo-50 p-2.5 rounded-lg text-sm border border-purple-200">
      <div className="flex items-start gap-2">
        <Sparkles className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
        <div>
          <span className="font-semibold text-purple-700 text-xs block mb-0.5">AI הקשר שיחה:</span>
          <p className="text-purple-900 leading-relaxed text-xs">{insight}</p>
        </div>
      </div>
    </div>
  );
}