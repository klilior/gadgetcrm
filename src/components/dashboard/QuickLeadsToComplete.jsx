import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StickyNote, Phone, Play, CheckCircle, Bell, Edit, Trash2, Clock } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { he } from 'date-fns/locale';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function QuickLeadsToComplete({ 
  leads, 
  onComplete, 
  onProcess, 
  onClose, 
  onSetReminder,
  onDelete
}) {
  const [statusFilter, setStatusFilter] = React.useState('open');
  const [timeFilter, setTimeFilter] = React.useState('all');
  React.useEffect(() => {
    // default to 'all' explicitly (fix live default mismatch)
    setTimeFilter('all');
    setStatusFilter('all');
  }, []);
  // מציגים את הווידג׳ט תמיד – גם כשאין תוצאות – כדי לאפשר שינוי מסננים

  // Apply filters
  const now = new Date();
  let fromDate = null;
  if (timeFilter === 'today') {
    const d = new Date();
    fromDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  } else if (timeFilter === '7d') {
    fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (timeFilter === '30d') {
    fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  const safeLeads = Array.isArray(leads) ? leads : [];
  // Show both quick capture and flagged quick_incomplete
  const filteredLeads = safeLeads.filter(l => {
    const isClosed = l.status === 'Closed';
    const statusOk = statusFilter === 'all' ? true : (statusFilter === 'open' ? !isClosed : isClosed);
    const timeOk = fromDate ? new Date(l.created_date) >= fromDate : true;
    return statusOk && timeOk;
  });

  return (
    <Card className="border-purple-200 bg-purple-50/50">
      <CardHeader className="pb-2">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <CardTitle className="text-purple-800 flex items-center gap-2 text-lg">
            <StickyNote className="w-5 h-5" />
            פתקים מהירים להשלמה
            <Badge className="bg-purple-600 text-white mr-2">{filteredLeads.length}</Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={timeFilter} onValueChange={setTimeFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="טווח זמן" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">היום</SelectItem>
                <SelectItem value="7d">7 ימים</SelectItem>
                <SelectItem value="30d">30 ימים</SelectItem>
                <SelectItem value="all">כל הזמן</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="סטטוס" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">פתוח</SelectItem>
                <SelectItem value="closed">סגור</SelectItem>
                <SelectItem value="all">הכל</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {filteredLeads.length === 0 ? (
          <div className="text-sm text-gray-500">אין פתקים להשלמה בטווח/סטטוס הנבחר — נסה "כל הזמן" ו"הכל".</div>
        ) : (
          <div className="space-y-3">
            {filteredLeads.map(lead => (
              <div 
                key={lead.id} 
                className="bg-white rounded-lg p-4 border border-purple-100 shadow-sm"
              >
                {/* Header row with badges */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-purple-100 text-purple-800 text-xs">פתק מהיר</Badge>
                    <Badge variant="outline" className="text-orange-600 border-orange-300 text-xs">חסר פרטים</Badge>
                  </div>
                  <span className="text-xs text-gray-400">
                    {formatDistanceToNow(new Date(lead.created_date), { addSuffix: true, locale: he })}
                  </span>
                </div>

                {/* Main content */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <a href={`tel:${lead.phone}`} className="font-mono text-lg font-bold text-blue-600 hover:underline flex items-center gap-1">
                        <Phone className="w-4 h-4" />
                        {lead.phone}
                      </a>
                      {lead.customer_name && (
                        <span className="text-gray-700 font-medium">{lead.customer_name}</span>
                      )}
                    </div>
                    <p className="text-gray-600">{lead.topic}</p>
                    {lead.notes && (
                      <p className="text-sm text-gray-500 mt-1 truncate">{lead.notes}</p>
                    )}
                    {lead.sla_due_at && (
                      <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
                        <Clock className="w-3 h-3" />
                        SLA: {format(new Date(lead.sla_due_at), 'HH:mm dd/MM', { locale: he })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Action buttons row */}
                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-100">
                  <Button
                    size="sm"
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                    onClick={() => onComplete?.(lead)}
                  >
                    <Edit className="w-4 h-4 ml-1" />
                    ערוך והשלם
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-blue-600 border-blue-200 hover:bg-blue-50"
                    onClick={() => onProcess?.(lead.id)}
                  >
                    <Play className="w-4 h-4 ml-1" />
                    התחל טיפול
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-green-600 border-green-200 hover:bg-green-50"
                    onClick={() => onClose?.(lead.id)}
                  >
                    <CheckCircle className="w-4 h-4 ml-1" />
                    טופל
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-amber-600 border-amber-200 hover:bg-amber-50"
                    onClick={() => onSetReminder?.(lead)}
                  >
                    <Bell className="w-4 h-4 ml-1" />
                    תזכורת
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600 border-red-200 hover:bg-red-50"
                    onClick={() => onDelete?.(lead.id)}
                  >
                    <Trash2 className="w-4 h-4 ml-1" />
                    מחק
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}