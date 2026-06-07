import React from "react";
import { CheckCircle, Clock, AlertTriangle } from "lucide-react";

export default function SPProcessTimeline({ events = [] }) {
  if (!events.length) return null;

  const iconByStatus = {
    done: <CheckCircle className="w-4 h-4 text-green-600" />,
    running: <Clock className="w-4 h-4 text-blue-600" />,
    error: <AlertTriangle className="w-4 h-4 text-red-600" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-600" />,
  };

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-right space-y-2">
      <div className="text-xs font-semibold text-slate-600">יומן טיפול בהזמנה</div>
      <div className="space-y-1.5">
        {events.map((event, index) => (
          <div key={`${event.time}-${index}`} className="flex items-start gap-2 text-xs text-slate-700">
            <span className="mt-0.5">{iconByStatus[event.status] || iconByStatus.done}</span>
            <div className="flex-1">
              <div>{event.label}</div>
              {event.details && <div className="text-slate-500 mt-0.5">{event.details}</div>}
            </div>
            <span className="font-mono text-slate-500 whitespace-nowrap">{event.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}