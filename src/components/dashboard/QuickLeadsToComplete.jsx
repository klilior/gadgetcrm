import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StickyNote, Phone, Play, CheckCircle, Bell, Edit } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { he } from 'date-fns/locale';

export default function QuickLeadsToComplete({ 
  leads, 
  onComplete, 
  onProcess, 
  onClose, 
  onSetReminder 
}) {
  if (!leads || leads.length === 0) return null;

  return (
    <Card className="border-purple-200 bg-purple-50/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-purple-800 flex items-center gap-2 text-lg">
          <StickyNote className="w-5 h-5" />
          פתקים מהירים להשלמה
          <Badge className="bg-purple-600 text-white mr-2">{leads.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {leads.map(lead => (
            <div 
              key={lead.id} 
              className="bg-white rounded-lg p-3 border border-purple-100 flex items-center justify-between"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Badge className="bg-purple-100 text-purple-800 text-xs">QUICK</Badge>
                  <Badge variant="outline" className="text-orange-600 border-orange-300 text-xs">חסר פרטים</Badge>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <a href={`tel:${lead.phone}`} className="font-mono text-blue-600 hover:underline">
                    {lead.phone}
                  </a>
                  {lead.customer_name && (
                    <span className="text-gray-700">• {lead.customer_name}</span>
                  )}
                </div>
                <p className="text-sm text-gray-600 truncate">{lead.topic}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {formatDistanceToNow(new Date(lead.created_date), { addSuffix: true, locale: he })}
                </p>
              </div>
              
              <div className="flex gap-1 mr-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2 text-purple-600 hover:bg-purple-50"
                  onClick={() => onComplete?.(lead)}
                  title="השלם עכשיו"
                >
                  <Edit className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2 text-blue-600 hover:bg-blue-50"
                  onClick={() => onProcess?.(lead.id)}
                  title="טפל"
                >
                  <Play className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2 text-green-600 hover:bg-green-50"
                  onClick={() => onClose?.(lead.id)}
                  title="סגור"
                >
                  <CheckCircle className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2 text-amber-600 hover:bg-amber-50"
                  onClick={() => onSetReminder?.(lead)}
                  title="עדכן תזכורת"
                >
                  <Bell className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}