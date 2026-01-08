import React from 'react';
import { Bell, Phone, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

export default function RemindersAlert({ reminders, onMarkDone, onCall }) {
  if (!reminders || reminders.length === 0) return null;

  const now = new Date();
  const dueReminders = reminders.filter(r => new Date(r.reminder_at) <= now);
  const upcomingReminders = reminders.filter(r => new Date(r.reminder_at) > now);

  return (
    <div className="space-y-3">
      {dueReminders.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 animate-pulse">
          <div className="flex items-center gap-2 mb-3">
            <Bell className="w-5 h-5 text-red-600" />
            <h4 className="font-bold text-red-800">תזכורות שהגיעו ({dueReminders.length})</h4>
          </div>
          <div className="space-y-2">
            {dueReminders.map(lead => (
              <div key={lead.id} className="flex items-center justify-between bg-white rounded-lg p-3">
                <div>
                  <p className="font-medium">{lead.customer_name || lead.phone}</p>
                  <p className="text-sm text-gray-600">{lead.topic}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => onCall?.(lead.phone)}>
                    <Phone className="w-4 h-4" />
                  </Button>
                  <Button size="sm" onClick={() => onMarkDone?.(lead.id)} className="bg-green-600 hover:bg-green-700">
                    בוצע
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {upcomingReminders.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-5 h-5 text-amber-600" />
            <h4 className="font-semibold text-amber-800">תזכורות קרובות ({upcomingReminders.length})</h4>
          </div>
          <div className="space-y-2">
            {upcomingReminders.slice(0, 3).map(lead => (
              <div key={lead.id} className="flex items-center justify-between bg-white rounded-lg p-2 text-sm">
                <div>
                  <span className="font-medium">{lead.customer_name || lead.phone}</span>
                  <span className="text-gray-500 mx-2">•</span>
                  <span className="text-gray-600">{lead.topic}</span>
                </div>
                <span className="text-amber-700 font-medium">
                  {format(new Date(lead.reminder_at), 'HH:mm')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}