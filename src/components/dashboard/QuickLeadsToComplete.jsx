import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StickyNote, Phone, Play, CheckCircle, Bell, Edit, Trash2, Clock, Truck, User, MapPin, Mail, CalendarDays } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { he } from 'date-fns/locale';
import UPSShipmentForm from '@/components/shipping/UPSShipmentForm';
import CargoShipmentForm from '@/components/shipping/CargoShipmentForm';
import GetPackageShipmentForm from '@/components/shipping/GetPackageShipmentForm';

const REP_COLORS = [
  'bg-purple-100 text-purple-800 border-purple-200',
  'bg-blue-100 text-blue-800 border-blue-200',
  'bg-emerald-100 text-emerald-800 border-emerald-200',
  'bg-amber-100 text-amber-800 border-amber-200',
  'bg-rose-100 text-rose-800 border-rose-200',
  'bg-cyan-100 text-cyan-800 border-cyan-200',
  'bg-indigo-100 text-indigo-800 border-indigo-200',
  'bg-slate-100 text-slate-800 border-slate-200',
];

const getAssigneeName = (lead, employees = []) => {
  const employee = employees.find(e => e.id === lead.assigned_to);
  return lead.assigned_to_name || employee?.employee_name || 'לא משויך';
};

const getAssigneeColor = (lead, employees = []) => {
  const key = lead.assigned_to || lead.assigned_to_name || 'empty';
  const employeeIndex = employees.findIndex(e => e.id === lead.assigned_to || e.employee_name === lead.assigned_to_name);
  const fallbackIndex = String(key).split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return REP_COLORS[(employeeIndex >= 0 ? employeeIndex : fallbackIndex) % REP_COLORS.length];
};

const buildAddress = (lead) => lead.full_address || [lead.street, lead.house].filter(Boolean).join(' ').trim();

const buildShipmentCustomer = (lead) => ({
  name: lead.customer_name || '',
  phone: lead.phone || '',
  email: lead.email || '',
  city: lead.city || '',
  street: lead.street || lead.full_address || '',
  house: lead.house || '',
  zip: lead.zip || '',
  floor: lead.floor || '',
  apartment: lead.apartment || '',
  entrance: lead.entrance || '',
  address: buildAddress(lead),
  notes: [
    lead.topic ? `נושא: ${lead.topic}` : '',
    lead.notes || '',
    lead.floor ? `קומה ${lead.floor}` : '',
    lead.apartment ? `דירה ${lead.apartment}` : '',
    lead.entrance ? `כניסה ${lead.entrance}` : '',
  ].filter(Boolean).join('\n'),
  reference: lead.id,
  customer: null,
});

function DetailRow({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
      <Icon className="w-4 h-4 mt-0.5 text-gray-500 flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-xs text-gray-500">{label}</div>
        <div className="font-medium text-gray-800 break-words">{value}</div>
      </div>
    </div>
  );
}

export default function QuickLeadsToComplete({ 
  leads, 
  employees = [],
  onComplete, 
  onProcess, 
  onClose, 
  onSetReminder,
  onDelete
}) {
  const [statusFilter, setStatusFilter] = React.useState('open');
  const [timeFilter, setTimeFilter] = React.useState('all');
  const [expandedLeadId, setExpandedLeadId] = React.useState(null);
  const [shipmentLead, setShipmentLead] = React.useState(null);
  const [shipmentProvider, setShipmentProvider] = React.useState('ups');

  const now = new Date();
  let fromDate = null;
  if (timeFilter === 'today') fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (timeFilter === '7d') fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (timeFilter === '30d') fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const safeLeads = Array.isArray(leads) ? leads : [];
  const filteredLeads = safeLeads.filter(lead => {
    const isClosed = lead.status === 'Closed';
    const statusOk = statusFilter === 'all' ? true : statusFilter === 'open' ? !isClosed : isClosed;
    const timeOk = fromDate ? new Date(lead.created_date) >= fromDate : true;
    return statusOk && timeOk;
  });
  const closedCount = safeLeads.filter(lead => lead.status === 'Closed').length;
  const openCount = safeLeads.filter(lead => lead.status !== 'Closed').length;

  const openShipmentModal = (lead, provider) => {
    setShipmentLead(lead);
    setShipmentProvider(provider);
  };

  const shipmentCustomer = shipmentLead ? buildShipmentCustomer(shipmentLead) : null;

  return (
    <>
      <Card className="border-purple-200 bg-purple-50/40 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <CardTitle className="text-purple-800 flex items-center gap-2 text-lg">
              <StickyNote className="w-5 h-5" />
              פתקים מהירים
              <Badge className="bg-purple-600 text-white mr-1">{filteredLeads.length}</Badge>
            </CardTitle>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={statusFilter === 'open' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('open')}
                className={statusFilter === 'open' ? 'bg-purple-600 hover:bg-purple-700' : ''}
              >
                פעילים ({openCount})
              </Button>
              <Button
                size="sm"
                variant={statusFilter === 'closed' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('closed')}
                className={statusFilter === 'closed' ? 'bg-slate-700 hover:bg-slate-800' : ''}
              >
                היסטוריה של פתקים שטופלו ({closedCount})
              </Button>
              <Select value={timeFilter} onValueChange={setTimeFilter}>
                <SelectTrigger className="w-32 bg-white">
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
                <SelectTrigger className="w-28 bg-white">
                  <SelectValue placeholder="סטטוס" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">פתוחים</SelectItem>
                  <SelectItem value="closed">טופלו</SelectItem>
                  <SelectItem value="all">הכל</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {filteredLeads.length === 0 ? (
            <div className="rounded-xl border border-dashed border-purple-200 bg-white/70 p-6 text-center text-sm text-gray-500">
              אין פתקים להצגה בטווח/סטטוס הנבחר.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 items-start">
              {filteredLeads.map(lead => {
                const isExpanded = expandedLeadId === lead.id;
                const assigneeName = getAssigneeName(lead, employees);
                const assigneeColor = getAssigneeColor(lead, employees);
                const address = buildAddress(lead);
                const content = lead.topic || lead.notes || 'ללא תוכן';

                return (
                  <div
                    key={lead.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedLeadId(isExpanded ? null : lead.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setExpandedLeadId(isExpanded ? null : lead.id); }}
                    className={`bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden ${isExpanded ? 'border-purple-300 ring-2 ring-purple-100' : 'border-purple-100'}`}
                  >
                    <div className={`px-4 py-2 border-b ${assigneeColor}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <User className="w-4 h-4 flex-shrink-0" />
                          <span className="font-bold truncate">{assigneeName}</span>
                        </div>
                        <Badge variant="outline" className="bg-white/70 text-xs">
                          {lead.status === 'Closed' ? 'טופל' : lead.status === 'InProgress' ? 'בטיפול' : 'פתוח'}
                        </Badge>
                      </div>
                    </div>

                    <div className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-gray-900 truncate">{lead.customer_name || 'לקוח ללא שם'}</div>
                          <a
                            href={`tel:${lead.phone || ''}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono text-blue-700 hover:underline flex items-center gap-1 text-sm mt-1"
                          >
                            <Phone className="w-3.5 h-3.5" />
                            {lead.phone || 'אין טלפון'}
                          </a>
                        </div>
                        <span className="text-[11px] text-gray-400 flex-shrink-0">
                          {lead.created_date ? formatDistanceToNow(new Date(lead.created_date), { addSuffix: true, locale: he }) : ''}
                        </span>
                      </div>

                      <p className={`text-sm text-gray-700 leading-relaxed ${isExpanded ? '' : 'line-clamp-2'}`}>
                        {content}
                      </p>

                      {!isExpanded && lead.notes && lead.topic && (
                        <p className="text-xs text-gray-500 line-clamp-1">{lead.notes}</p>
                      )}

                      {isExpanded && (
                        <div className="space-y-3 pt-2 border-t border-gray-100">
                          <div className="grid grid-cols-1 gap-2">
                            <DetailRow icon={Mail} label="אימייל" value={lead.email} />
                            <DetailRow icon={MapPin} label="כתובת" value={[address, lead.city].filter(Boolean).join(', ')} />
                            <DetailRow icon={StickyNote} label="הערות" value={lead.notes} />
                            <DetailRow icon={Bell} label="תזכורת" value={lead.reminder_at ? format(new Date(lead.reminder_at), 'HH:mm dd/MM/yyyy', { locale: he }) : ''} />
                            <DetailRow icon={Clock} label="SLA" value={lead.sla_due_at ? format(new Date(lead.sla_due_at), 'HH:mm dd/MM/yyyy', { locale: he }) : ''} />
                            <DetailRow icon={CalendarDays} label="נוצר" value={lead.created_date ? format(new Date(lead.created_date), 'HH:mm dd/MM/yyyy', { locale: he }) : ''} />
                          </div>

                          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                              <Truck className="w-4 h-4" />
                              יצירת משלוח מתוך הפתק
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openShipmentModal(lead, 'ups'); }}>UPS</Button>
                              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openShipmentModal(lead, 'cargo'); }}>קארגו</Button>
                              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openShipmentModal(lead, 'getpackage'); }}>GetPackage</Button>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <Button size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={(e) => { e.stopPropagation(); onComplete?.(lead); }}>
                              <Edit className="w-4 h-4 ml-1" /> ערוך
                            </Button>
                            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onProcess?.(lead.id); }}>
                              <Play className="w-4 h-4 ml-1" /> בטיפול
                            </Button>
                            <Button size="sm" variant="outline" className="text-green-700 border-green-200 hover:bg-green-50" onClick={(e) => { e.stopPropagation(); onClose?.(lead.id); }}>
                              <CheckCircle className="w-4 h-4 ml-1" /> טופל
                            </Button>
                            <Button size="sm" variant="outline" className="text-amber-700 border-amber-200 hover:bg-amber-50" onClick={(e) => { e.stopPropagation(); onSetReminder?.(lead); }}>
                              <Bell className="w-4 h-4 ml-1" /> תזכורת
                            </Button>
                            <Button size="sm" variant="outline" className="col-span-2 text-red-700 border-red-200 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); onDelete?.(lead.id); }}>
                              <Trash2 className="w-4 h-4 ml-1" /> מחק
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!shipmentLead} onOpenChange={(open) => !open && setShipmentLead(null)}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5 text-purple-600" />
              יצירת משלוח מתוך פתק מהיר
            </DialogTitle>
          </DialogHeader>

          {shipmentLead && (
            <div className="space-y-4">
              <div className="rounded-xl border bg-slate-50 p-3 text-sm text-slate-700">
                <strong>{shipmentLead.customer_name || 'לקוח ללא שם'}</strong> · {shipmentLead.phone || 'אין טלפון'} · {shipmentLead.topic || shipmentLead.notes || 'ללא תוכן'}
              </div>
              <Tabs value={shipmentProvider} onValueChange={setShipmentProvider} dir="rtl">
                <TabsList className="grid grid-cols-3 w-full">
                  <TabsTrigger value="ups">UPS</TabsTrigger>
                  <TabsTrigger value="cargo">קארגו</TabsTrigger>
                  <TabsTrigger value="getpackage">GetPackage</TabsTrigger>
                </TabsList>
                <TabsContent value="ups"><UPSShipmentForm initialCustomer={shipmentCustomer} /></TabsContent>
                <TabsContent value="cargo"><CargoShipmentForm initialCustomer={shipmentCustomer} /></TabsContent>
                <TabsContent value="getpackage"><GetPackageShipmentForm initialCustomer={shipmentCustomer} /></TabsContent>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}