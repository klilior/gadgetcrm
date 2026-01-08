import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Phone, Clock, AlertTriangle, CheckCircle, Bell, Play, X } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { he } from 'date-fns/locale';

const getSlaStatus = (lead) => {
  if (!lead.sla_due_at || lead.status === 'Closed' || lead.status === 'Deleted') {
    return 'OK';
  }
  const now = new Date();
  const slaDue = new Date(lead.sla_due_at);
  const fifteenMinBefore = new Date(slaDue.getTime() - 15 * 60 * 1000);

  if (now > slaDue) return 'Overdue';
  if (now >= fifteenMinBefore) return 'DueSoon';
  return 'OK';
};

const SlaBadge = ({ status }) => {
  if (status === 'Overdue') {
    return (
      <Badge className="bg-red-500 text-white animate-pulse">
        <AlertTriangle className="w-3 h-3 mr-1" />
        חריגה
      </Badge>
    );
  }
  if (status === 'DueSoon') {
    return (
      <Badge className="bg-orange-500 text-white">
        <Clock className="w-3 h-3 mr-1" />
        מתקרב
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-green-600 border-green-300">
      <CheckCircle className="w-3 h-3 mr-1" />
      תקין
    </Badge>
  );
};

const StatusBadge = ({ status }) => {
  const configs = {
    New: { label: 'חדש', className: 'bg-blue-100 text-blue-800' },
    InProgress: { label: 'בטיפול', className: 'bg-yellow-100 text-yellow-800' },
    Closed: { label: 'נסגר', className: 'bg-green-100 text-green-800' },
    Deleted: { label: 'נמחק', className: 'bg-gray-100 text-gray-800' },
  };
  const config = configs[status] || configs.New;
  return <Badge className={config.className}>{config.label}</Badge>;
};

export default function LeadsTable({ 
  leads, 
  onStatusChange, 
  onMarkReminderDone,
  onAssignChange,
  employees = [],
  showAssignee = false,
  isManager = false
}) {
  // Sort: Overdue first, then DueSoon, then by created_date desc
  const sortedLeads = [...leads].sort((a, b) => {
    const slaA = getSlaStatus(a);
    const slaB = getSlaStatus(b);
    const order = { Overdue: 0, DueSoon: 1, OK: 2 };
    if (order[slaA] !== order[slaB]) return order[slaA] - order[slaB];
    return new Date(b.created_date) - new Date(a.created_date);
  });

  const isReminderDue = (lead) => {
    if (!lead.reminder_at || lead.reminder_done) return false;
    const now = new Date();
    const reminderTime = new Date(lead.reminder_at);
    return reminderTime <= now;
  };

  const isReminderSoon = (lead) => {
    if (!lead.reminder_at || lead.reminder_done) return false;
    const now = new Date();
    const reminderTime = new Date(lead.reminder_at);
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    return reminderTime > now && reminderTime <= oneHourFromNow;
  };

  if (leads.length === 0) {
    return (
      <div className="text-center py-10 text-gray-500">
        <Phone className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>אין לידים להצגה</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50">
            <TableHead className="w-24">זמן</TableHead>
            <TableHead>טלפון</TableHead>
            <TableHead>לקוח</TableHead>
            <TableHead>נושא</TableHead>
            {showAssignee && <TableHead>נציג</TableHead>}
            <TableHead>סטטוס</TableHead>
            <TableHead>SLA</TableHead>
            <TableHead>תזכורת</TableHead>
            <TableHead className="w-40">פעולות</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedLeads.map((lead, index) => {
            const slaStatus = getSlaStatus(lead);
            const reminderDue = isReminderDue(lead);
            const reminderSoon = isReminderSoon(lead);
            
            return (
              <TableRow 
                key={lead.id} 
                className={`
                  ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}
                  ${slaStatus === 'Overdue' ? 'bg-red-50' : ''}
                  ${reminderDue ? 'bg-amber-50' : ''}
                `}
              >
                <TableCell className="text-sm text-gray-600">
                  {formatDistanceToNow(new Date(lead.created_date), { addSuffix: true, locale: he })}
                </TableCell>
                <TableCell className="font-mono font-medium">
                  <a href={`tel:${lead.phone}`} className="text-blue-600 hover:underline">
                    {lead.phone}
                  </a>
                </TableCell>
                <TableCell>{lead.customer_name || '-'}</TableCell>
                <TableCell className="max-w-[200px] truncate">{lead.topic}</TableCell>
                {showAssignee && (
                  <TableCell>
                    {isManager ? (
                      <Select 
                        value={lead.assigned_to} 
                        onValueChange={(val) => onAssignChange?.(lead.id, val)}
                      >
                        <SelectTrigger className="h-8 w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {employees.map(emp => (
                            <SelectItem key={emp.id} value={emp.id}>
                              {emp.employee_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm">{lead.assigned_to_name}</span>
                    )}
                  </TableCell>
                )}
                <TableCell>
                  <Select 
                    value={lead.status} 
                    onValueChange={(val) => onStatusChange?.(lead.id, val)}
                  >
                    <SelectTrigger className="h-8 w-28 border-0 p-0">
                      <StatusBadge status={lead.status} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="New">חדש</SelectItem>
                      <SelectItem value="InProgress">בטיפול</SelectItem>
                      <SelectItem value="Closed">נסגר</SelectItem>
                      {isManager && <SelectItem value="Deleted">נמחק</SelectItem>}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <SlaBadge status={slaStatus} />
                </TableCell>
                <TableCell>
                  {lead.reminder_at && !lead.reminder_done ? (
                    <div className={`flex items-center gap-1 text-xs ${reminderDue ? 'text-red-600 font-bold animate-pulse' : reminderSoon ? 'text-orange-600' : 'text-gray-600'}`}>
                      <Bell className="w-3 h-3" />
                      {format(new Date(lead.reminder_at), 'HH:mm')}
                    </div>
                  ) : lead.reminder_done ? (
                    <span className="text-xs text-green-600">✓ בוצע</span>
                  ) : (
                    <span className="text-xs text-gray-400">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {lead.status !== 'Closed' && lead.status !== 'Deleted' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => onStatusChange?.(lead.id, 'InProgress')}
                        >
                          <Play className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs text-green-600 hover:bg-green-50"
                          onClick={() => onStatusChange?.(lead.id, 'Closed')}
                        >
                          <CheckCircle className="w-3 h-3" />
                        </Button>
                      </>
                    )}
                    {lead.reminder_at && !lead.reminder_done && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => onMarkReminderDone?.(lead.id)}
                      >
                        <Bell className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}