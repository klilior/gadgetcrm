import React, { useState, useEffect, useCallback } from 'react';
import { Lead, Target, SalesActivity, Employee, Repair, GoalDefinition, GoalProgress, SalesTransaction } from '@/entities/all';
import { useUser } from '../components/UserAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { 
  Trophy, Phone, AlertTriangle, Clock, Users, Filter, Eye, 
  Smartphone, ShoppingBag, Signal, Zap, DollarSign, Wrench,
  RefreshCw, Calendar
} from 'lucide-react';
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth, isWithinInterval, differenceInDays } from 'date-fns';
import { he } from 'date-fns/locale';

import KPIStrip from '../components/dashboard/KPIStrip';
import TargetProgress from '../components/dashboard/TargetProgress';
import LeadsTable from '../components/dashboard/LeadsTable';
import RemindersAlert from '../components/dashboard/RemindersAlert';
import TeamPerformanceTable from '../components/dashboard/TeamPerformanceTable';
import QuickLeadButton from '../components/leads/QuickLeadButton';
import QuickLeadsToComplete from '../components/dashboard/QuickLeadsToComplete';
import EditLeadModal from '../components/leads/EditLeadModal';

// Helper to calculate SLA status
const getSlaStatus = (lead) => {
  if (!lead.sla_due_at || lead.status === 'Closed' || lead.status === 'Deleted') return 'OK';
  const now = new Date();
  const slaDue = new Date(lead.sla_due_at);
  const fifteenMinBefore = new Date(slaDue.getTime() - 15 * 60 * 1000);
  if (now > slaDue) return 'Overdue';
  if (now >= fifteenMinBefore) return 'DueSoon';
  return 'OK';
};

export default function AgentDashboard() {
  const { currentUser } = useUser();
  const [isLoading, setIsLoading] = useState(true);
  const [period, setPeriod] = useState('today'); // today, week, month
  const [focusMode, setFocusMode] = useState(false);
  
  // Data states
  const [leads, setLeads] = useState([]);
  const [myLeads, setMyLeads] = useState([]);
  const [targets, setTargets] = useState({});
  const [actuals, setActuals] = useState({});
  const [kpiData, setKpiData] = useState({});
  const [employees, setEmployees] = useState([]);
  const [teamData, setTeamData] = useState([]);
  const [repairs, setRepairs] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [quickLeads, setQuickLeads] = useState([]);
  const [editingLead, setEditingLead] = useState(null);

  const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'מנהל משמרת';
  const userId = currentUser?.id;

  const loadData = useCallback(async () => {
    if (!currentUser) return;
    setIsLoading(true);

    try {
      const now = new Date();
      let dateStart, dateEnd;

      if (period === 'today') {
        dateStart = startOfDay(now);
        dateEnd = endOfDay(now);
      } else if (period === 'week') {
        dateStart = new Date(now);
        dateStart.setDate(now.getDate() - 7);
        dateEnd = endOfDay(now);
      } else {
        dateStart = startOfMonth(now);
        dateEnd = endOfMonth(now);
      }

      // Load all data in parallel
      const [allLeads, allTargets, allActivities, allEmployees, allRepairs, allGoals, allGoalProgress, allSalesTransactions] = await Promise.all([
        Lead.filter({ status: { $ne: 'Deleted' } }),
        Target.list(),
        SalesActivity.list(),
        Employee.filter({ is_active: true }),
        isManager ? Repair.list() : Promise.resolve([]),
        GoalDefinition.filter({ is_active: true }),
        GoalProgress.list(),
        SalesTransaction.list()
      ]);

      setEmployees(allEmployees || []);

      // Filter leads
      const activeLeads = (allLeads || []).filter(l => l.status !== 'Deleted');
      setLeads(activeLeads);

      // My leads (for rep view)
      const myOpenLeads = activeLeads.filter(l => 
        l.assigned_to === userId && 
        (l.status === 'New' || l.status === 'InProgress')
      );
      setMyLeads(myOpenLeads);

      // Reminders (within next hour or overdue)
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
      const activeReminders = activeLeads.filter(l => 
        l.assigned_to === userId &&
        l.reminder_at && 
        !l.reminder_done &&
        l.status !== 'Closed' &&
        new Date(l.reminder_at) <= oneHourFromNow
      );
      setReminders(activeReminders);

      // Quick incomplete leads
      const quickIncomplete = activeLeads.filter(l => 
        l.quick_incomplete === true &&
        l.status !== 'Closed' &&
        l.status !== 'Deleted' &&
        (isManager || l.assigned_to === userId)
      ).sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
      setQuickLeads(quickIncomplete);

      // Filter activities by period
      const periodActivities = (allActivities || []).filter(a => {
        const actDate = new Date(a.activity_date);
        return isWithinInterval(actDate, { start: dateStart, end: dateEnd });
      });

      // Calculate actuals for current user
      const myActivities = periodActivities.filter(a => a.user_id === userId);
      const myActuals = {
        Devices: myActivities.filter(a => a.metric_type === 'Devices').reduce((s, a) => s + (a.metric_value || 0), 0),
        AccessoriesRevenue: myActivities.filter(a => a.metric_type === 'AccessoriesRevenue').reduce((s, a) => s + (a.metric_value || 0), 0),
        Lines4G: myActivities.filter(a => a.metric_type === 'Lines4G').reduce((s, a) => s + (a.metric_value || 0), 0),
        Lines5G: myActivities.filter(a => a.metric_type === 'Lines5G').reduce((s, a) => s + (a.metric_value || 0), 0),
        TotalSalesRevenue: myActivities.filter(a => a.metric_type === 'TotalSalesRevenue').reduce((s, a) => s + (a.metric_value || 0), 0),
      };
      setActuals(myActuals);

      // Calculate targets for current user - check both Target and GoalDefinition
      const myTargets = (allTargets || []).filter(t => 
        t.user_id === userId &&
        new Date(t.period_start) <= dateEnd &&
        new Date(t.period_end) >= dateStart
      );
      const targetMap = {};
      myTargets.forEach(t => {
        targetMap[t.target_type] = (targetMap[t.target_type] || 0) + t.target_value;
      });

      // Also check GoalDefinition for targets
      const myGoals = (allGoals || []).filter(g => {
        const matchesPeriod = new Date(g.period_start) <= dateEnd && new Date(g.period_end) >= dateStart;
        const matchesUser = g.scope_type === 'TEAM' || g.agent_name === currentUser?.employee_name;
        return matchesPeriod && matchesUser && g.is_active;
      });

      // Map GoalDefinition to Target format
      myGoals.forEach(g => {
        let targetType = null;
        if (g.commission_group_code === 'DEVICES' && g.metric_type === 'UNITS') {
          targetType = 'Devices';
        } else if (g.commission_group_code === 'ACCESSORIES_GROUP' && g.metric_type === 'NET_AMOUNT') {
          targetType = 'AccessoriesRevenue';
        } else if (g.commission_group_code === 'LINES' && g.metric_type === 'LINES_4G_UNITS') {
          targetType = 'Lines4G';
        } else if (g.commission_group_code === 'LINES' && g.metric_type === 'LINES_5G_UNITS') {
          targetType = 'Lines5G';
        } else if (g.commission_group_code === 'LINES' && g.metric_type === 'UNITS') {
          // Total lines - split to Lines4G if no specific type
          targetType = 'Lines4G';
        } else if (g.metric_type === 'NET_AMOUNT') {
          targetType = 'TotalSalesRevenue';
        }
        
        if (targetType && !targetMap[targetType]) {
          targetMap[targetType] = g.target_value;
        }
      });

      setTargets(targetMap);

      // Calculate actuals from SalesTransactions - ALWAYS use them as primary source
      const periodSales = (allSalesTransactions || []).filter(s => {
        const saleDate = new Date(s.issue_date || s.created_date);
        return isWithinInterval(saleDate, { start: dateStart, end: dateEnd });
      });
      
      // Helper to match sales rep names (handle Linet variations)
      const matchSalesRep = (txSalesRep, employeeName) => {
        if (!txSalesRep || !employeeName) return false;
        const normalizedTx = txSalesRep.toLowerCase().trim();
        const normalizedEmp = employeeName.toLowerCase().trim();
        return normalizedTx === normalizedEmp || 
               normalizedTx.includes(normalizedEmp) || 
               normalizedEmp.includes(normalizedTx);
      };
      
      // Helper to identify category type from Linet category field
      const isDeviceCategory = (cat) => {
        if (!cat) return false;
        const lower = cat.toLowerCase();
        return lower.includes('מכשיר') || lower.includes('סמארטפון') || lower.includes('טלפון') || 
               lower.includes('device') || lower.includes('phone') || lower.includes('סלולר');
      };
      
      const isAccessoryCategory = (cat) => {
        if (!cat) return false;
        const lower = cat.toLowerCase();
        return lower.includes('אביזר') || lower.includes('accessory') || lower.includes('כיסוי') || 
               lower.includes('מגן') || lower.includes('מטען') || lower.includes('אוזני');
      };
      
      const isLineCategory = (cat) => {
        if (!cat) return false;
        const lower = cat.toLowerCase();
        return lower.includes('קו') || lower.includes('sim') || lower.includes('line') || 
               lower.includes('חבילה') || lower.includes('מנוי');
      };
      
      const is4GLine = (tx) => {
        const cat = (tx.category || '').toLowerCase();
        const prod = (tx.product_name || '').toLowerCase();
        return (cat.includes('4g') || prod.includes('4g')) && !cat.includes('5g') && !prod.includes('5g');
      };
      
      const is5GLine = (tx) => {
        const cat = (tx.category || '').toLowerCase();
        const prod = (tx.product_name || '').toLowerCase();
        return cat.includes('5g') || prod.includes('5g');
      };
      
      const mySales = periodSales.filter(s => matchSalesRep(s.sales_rep, currentUser?.employee_name));
      
      // Calculate from sales transactions
      const devicesCount = mySales.filter(s => isDeviceCategory(s.category)).reduce((sum, s) => sum + (s.quantity || 1), 0);
      const accessoriesRevenue = mySales.filter(s => isAccessoryCategory(s.category)).reduce((sum, s) => sum + (s.price_ex_vat || 0), 0);
      const lineSales = mySales.filter(s => isLineCategory(s.category));
      const linesCount = lineSales.reduce((sum, s) => sum + (s.quantity || 1), 0);
      const lines4gCount = lineSales.filter(s => is4GLine(s)).reduce((sum, s) => sum + (s.quantity || 1), 0);
      const lines5gCount = lineSales.filter(s => is5GLine(s)).reduce((sum, s) => sum + (s.quantity || 1), 0);
      const totalRevenue = mySales.reduce((sum, s) => sum + (s.price_ex_vat || 0), 0);

      // Use SalesTransaction data primarily, fallback to SalesActivity
      const finalActuals = {
        Devices: devicesCount > 0 ? devicesCount : myActuals.Devices,
        AccessoriesRevenue: accessoriesRevenue > 0 ? accessoriesRevenue : myActuals.AccessoriesRevenue,
        Lines4G: linesCount > 0 ? linesCount : (lines4gCount > 0 ? lines4gCount : myActuals.Lines4G),
        Lines5G: lines5gCount > 0 ? lines5gCount : myActuals.Lines5G,
        TotalSalesRevenue: totalRevenue > 0 ? totalRevenue : myActuals.TotalSalesRevenue,
      };
      setActuals(finalActuals);

      // KPI data
      if (isManager) {
        // Team KPIs
        const teamKpis = {
          devices: periodActivities.filter(a => a.metric_type === 'Devices').reduce((s, a) => s + (a.metric_value || 0), 0),
          accessories: periodActivities.filter(a => a.metric_type === 'AccessoriesRevenue').reduce((s, a) => s + (a.metric_value || 0), 0),
          lines4g: periodActivities.filter(a => a.metric_type === 'Lines4G').reduce((s, a) => s + (a.metric_value || 0), 0),
          lines5g: periodActivities.filter(a => a.metric_type === 'Lines5G').reduce((s, a) => s + (a.metric_value || 0), 0),
          total: periodActivities.filter(a => a.metric_type === 'TotalSalesRevenue').reduce((s, a) => s + (a.metric_value || 0), 0),
          openLeads: activeLeads.filter(l => l.status === 'New' || l.status === 'InProgress').length,
          overdueLeads: activeLeads.filter(l => getSlaStatus(l) === 'Overdue').length,
        };
        setKpiData(teamKpis);

        // Team performance data
        const teamPerf = allEmployees
          .filter(e => e.role === 'נציג' || e.role === 'מנהל משמרת')
          .map(emp => {
            // Get sales from SalesTransactions for this employee
            const empSales = periodSales.filter(s => matchSalesRep(s.sales_rep, emp.employee_name));
            
            const empActivities = periodActivities.filter(a => a.user_id === emp.id);
            const empTargets = (allTargets || []).filter(t => 
              t.user_id === emp.id &&
              new Date(t.period_start) <= dateEnd &&
              new Date(t.period_end) >= dateStart
            );
            
            // Calculate from SalesTransactions first - use category-based detection
            const empDevices = empSales.filter(s => isDeviceCategory(s.category)).reduce((sum, s) => sum + (s.quantity || 1), 0);
            const empAccessories = empSales.filter(s => isAccessoryCategory(s.category)).reduce((sum, s) => sum + (s.price_ex_vat || 0), 0);
            const empLineSales = empSales.filter(s => isLineCategory(s.category));
            const empLines = empLineSales.reduce((sum, s) => sum + (s.quantity || 1), 0);
            const empLines4g = empLineSales.filter(s => is4GLine(s)).reduce((sum, s) => sum + (s.quantity || 1), 0);
            const empLines5g = empLineSales.filter(s => is5GLine(s)).reduce((sum, s) => sum + (s.quantity || 1), 0);
            const empTotal = empSales.reduce((sum, s) => sum + (s.price_ex_vat || 0), 0);
            
            // Fallback to SalesActivity if no SalesTransactions
            const empActuals = {
              Devices: empDevices > 0 ? empDevices : empActivities.filter(a => a.metric_type === 'Devices').reduce((s, a) => s + (a.metric_value || 0), 0),
              AccessoriesRevenue: empAccessories > 0 ? empAccessories : empActivities.filter(a => a.metric_type === 'AccessoriesRevenue').reduce((s, a) => s + (a.metric_value || 0), 0),
              Lines4G: empLines > 0 ? empLines : (empLines4g > 0 ? empLines4g : empActivities.filter(a => a.metric_type === 'Lines4G').reduce((s, a) => s + (a.metric_value || 0), 0)),
              Lines5G: empLines5g > 0 ? empLines5g : empActivities.filter(a => a.metric_type === 'Lines5G').reduce((s, a) => s + (a.metric_value || 0), 0),
              TotalSalesRevenue: empTotal > 0 ? empTotal : empActivities.filter(a => a.metric_type === 'TotalSalesRevenue').reduce((s, a) => s + (a.metric_value || 0), 0),
            };

            const empTargetMap = {};
            empTargets.forEach(t => {
              empTargetMap[t.target_type] = (empTargetMap[t.target_type] || 0) + t.target_value;
            });

            // Also check GoalDefinition for this employee
            const empGoals = (allGoals || []).filter(g => {
              const matchesPeriod = new Date(g.period_start) <= dateEnd && new Date(g.period_end) >= dateStart;
              const matchesUser = g.scope_type === 'TEAM' || g.agent_name === emp.employee_name;
              return matchesPeriod && matchesUser && g.is_active;
            });

            empGoals.forEach(g => {
              let targetType = null;
              if (g.commission_group_code === 'DEVICES' && g.metric_type === 'UNITS') {
                targetType = 'Devices';
              } else if (g.commission_group_code === 'ACCESSORIES_GROUP' && g.metric_type === 'NET_AMOUNT') {
                targetType = 'AccessoriesRevenue';
              } else if (g.commission_group_code === 'LINES' && g.metric_type === 'LINES_4G_UNITS') {
                targetType = 'Lines4G';
              } else if (g.commission_group_code === 'LINES' && g.metric_type === 'LINES_5G_UNITS') {
                targetType = 'Lines5G';
              } else if (g.commission_group_code === 'LINES' && g.metric_type === 'UNITS') {
                targetType = 'Lines4G';
              } else if (g.metric_type === 'NET_AMOUNT') {
                targetType = 'TotalSalesRevenue';
              }
              
              if (targetType && !empTargetMap[targetType]) {
                empTargetMap[targetType] = g.target_value;
              }
            });

            const empLeads = activeLeads.filter(l => l.assigned_to === emp.id);

            return {
              userId: emp.id,
              userName: emp.employee_name,
              actuals: empActuals,
              targets: empTargetMap,
              openLeads: empLeads.filter(l => l.status === 'New' || l.status === 'InProgress').length,
              overdueLeads: empLeads.filter(l => getSlaStatus(l) === 'Overdue').length,
            };
          });
        setTeamData(teamPerf);

        // Repairs data
        const repairsList = allRepairs || [];
        setRepairs(repairsList);
      } else {
        // Rep KPIs
        setKpiData({
          devices: myActuals.Devices,
          accessories: myActuals.AccessoriesRevenue,
          lines4g: myActuals.Lines4G,
          lines5g: myActuals.Lines5G,
          total: myActuals.TotalSalesRevenue,
        });
      }

    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [currentUser, period, isManager, userId]);

  useEffect(() => {
    loadData();
    // Auto-refresh every 60 seconds
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleStatusChange = async (leadId, newStatus) => {
    try {
      const lead = leads.find(l => l.id === leadId);
      const updateData = { status: newStatus };
      if (newStatus === 'Deleted') {
        updateData.deleted_at = new Date().toISOString();
      }
      // Mark as complete if moving to InProgress
      if (newStatus === 'InProgress' && lead?.quick_incomplete) {
        updateData.quick_incomplete = false;
        updateData.capture_type = 'Full';
      }
      await Lead.update(leadId, updateData);
      loadData();
    } catch (error) {
      console.error('Error updating lead status:', error);
    }
  };

  const handleMarkReminderDone = async (leadId) => {
    try {
      const lead = leads.find(l => l.id === leadId);
      const updateData = { reminder_done: true };
      // Mark as complete if setting reminder done
      if (lead?.quick_incomplete) {
        updateData.quick_incomplete = false;
        updateData.capture_type = 'Full';
      }
      await Lead.update(leadId, updateData);
      loadData();
    } catch (error) {
      console.error('Error marking reminder done:', error);
    }
  };

  const handleOpenEdit = (lead) => {
    setEditingLead(lead);
  };

  const handleSetReminder = (lead) => {
    setEditingLead(lead);
  };

  const handleAssignChange = async (leadId, newAssigneeId) => {
    try {
      const emp = employees.find(e => e.id === newAssigneeId);
      await Lead.update(leadId, { 
        assigned_to: newAssigneeId,
        assigned_to_name: emp?.employee_name || ''
      });
      loadData();
    } catch (error) {
      console.error('Error reassigning lead:', error);
    }
  };

  const handleCall = (phone) => {
    window.location.href = `tel:${phone}`;
  };

  // Calculate overdue repairs
  const overdueRepairs = repairs.filter(r => {
    if (!r.created_date || r.status === 'תיקון נסגר') return false;
    const daysOpen = differenceInDays(new Date(), new Date(r.created_date));
    const slaDays = r.sla_days || 14;
    return daysOpen > slaDays;
  });

  const dueSoonRepairs = repairs.filter(r => {
    if (!r.created_date || r.status === 'תיקון נסגר') return false;
    const daysOpen = differenceInDays(new Date(), new Date(r.created_date));
    const slaDays = r.sla_days || 14;
    return daysOpen >= slaDays * 0.8 && daysOpen <= slaDays;
  });

  // Filtered leads for focus mode
  const overdueLeads = leads.filter(l => getSlaStatus(l) === 'Overdue');
  const displayLeads = focusMode 
    ? overdueLeads 
    : (isManager ? leads.filter(l => l.status !== 'Closed') : myLeads);

  const periodLabels = {
    today: 'היום',
    week: 'השבוע',
    month: 'החודש'
  };

  if (isLoading && leads.length === 0) {
    return (
      <div className="p-6 space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-gray-200 rounded"></div>
          <div className="flex gap-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-24 flex-1 bg-gray-200 rounded-xl"></div>
            ))}
          </div>
          <div className="h-64 bg-gray-200 rounded-xl"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <Trophy className="w-8 h-8 text-purple-600" />
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
              {isManager ? 'דשבורד מנהל משמרת' : 'הדשבורד שלי'}
            </h1>
            <p className="text-sm text-gray-500">
              {format(new Date(), 'EEEE, d בMMMM yyyy', { locale: he })}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-32">
              <Calendar className="w-4 h-4 ml-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">היום</SelectItem>
              <SelectItem value="week">השבוע</SelectItem>
              <SelectItem value="month">החודש</SelectItem>
            </SelectContent>
          </Select>

          {isManager && (
            <Button
              variant={focusMode ? 'default' : 'outline'}
              onClick={() => setFocusMode(!focusMode)}
              className={focusMode ? 'bg-red-600 hover:bg-red-700' : ''}
            >
              <Eye className="w-4 h-4 ml-2" />
              {focusMode ? 'מצב Focus פעיל' : 'מצב Focus'}
            </Button>
          )}

          <Button variant="outline" onClick={loadData} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <KPIStrip data={kpiData} showTeamStats={isManager} />

      {/* Quick Leads to Complete */}
      {quickLeads.length > 0 && (
        <QuickLeadsToComplete
          leads={quickLeads}
          onComplete={handleOpenEdit}
          onProcess={(id) => handleStatusChange(id, 'InProgress')}
          onClose={(id) => handleStatusChange(id, 'Closed')}
          onSetReminder={handleSetReminder}
          onDelete={(id) => handleStatusChange(id, 'Deleted')}
        />
      )}

      {/* Reminders Alert */}
      {reminders.length > 0 && (
        <RemindersAlert 
          reminders={reminders} 
          onMarkDone={handleMarkReminderDone}
          onCall={handleCall}
        />
      )}

      {/* Main Content */}
      {isManager ? (
        // Manager View
        <div className="space-y-6">
          {/* Focus Mode Alerts */}
          {focusMode && (
            <div className="space-y-4">
              {overdueLeads.length > 0 && (
                <Card className="border-red-200 bg-red-50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-red-800 flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5" />
                      לידים בחריגת SLA ({overdueLeads.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <LeadsTable
                      leads={overdueLeads}
                      onStatusChange={handleStatusChange}
                      onMarkReminderDone={handleMarkReminderDone}
                      onAssignChange={handleAssignChange}
                      employees={employees}
                      showAssignee={true}
                      isManager={true}
                    />
                  </CardContent>
                </Card>
              )}

              {overdueRepairs.length > 0 && (
                <Card className="border-red-200 bg-red-50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-red-800 flex items-center gap-2">
                      <Wrench className="w-5 h-5" />
                      תיקונים בחריגה ({overdueRepairs.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {overdueRepairs.slice(0, 5).map(r => (
                        <div key={r.id} className="bg-white rounded-lg p-3 flex justify-between items-center">
                          <div>
                            <p className="font-medium">{r.repair_id}</p>
                            <p className="text-sm text-gray-600">{r.customer?.full_name || 'לקוח'} - {r.device?.model || 'מכשיר'}</p>
                          </div>
                          <Badge className="bg-red-500 text-white">
                            {differenceInDays(new Date(), new Date(r.created_date))} ימים
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {!focusMode && (
            <>
              {/* Team Performance */}
              <TeamPerformanceTable teamData={teamData} />

              {/* Team Leads */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Phone className="w-5 h-5 text-purple-600" />
                    לידים צוותיים
                    <Badge variant="outline" className="mr-2">{displayLeads.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <LeadsTable
                    leads={displayLeads}
                    onStatusChange={handleStatusChange}
                    onMarkReminderDone={handleMarkReminderDone}
                    onAssignChange={handleAssignChange}
                    onEdit={handleOpenEdit}
                    onDelete={(id) => handleStatusChange(id, 'Deleted')}
                    employees={employees}
                    showAssignee={true}
                    isManager={true}
                  />
                </CardContent>
              </Card>

              {/* Repairs Alerts */}
              {(overdueRepairs.length > 0 || dueSoonRepairs.length > 0) && (
                <div className="grid md:grid-cols-2 gap-4">
                  {overdueRepairs.length > 0 && (
                    <Card className="border-red-200">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-red-700 text-lg flex items-center gap-2">
                          <AlertTriangle className="w-5 h-5" />
                          תיקונים חורגים ({overdueRepairs.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {overdueRepairs.map(r => (
                            <div key={r.id} className="bg-red-50 rounded p-2 text-sm flex justify-between">
                              <span>{r.repair_id}</span>
                              <span className="text-red-600 font-medium">
                                {differenceInDays(new Date(), new Date(r.created_date))} ימים
                              </span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {dueSoonRepairs.length > 0 && (
                    <Card className="border-orange-200">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-orange-700 text-lg flex items-center gap-2">
                          <Clock className="w-5 h-5" />
                          תיקונים מתקרבים לחריגה ({dueSoonRepairs.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {dueSoonRepairs.map(r => (
                            <div key={r.id} className="bg-orange-50 rounded p-2 text-sm flex justify-between">
                              <span>{r.repair_id}</span>
                              <span className="text-orange-600 font-medium">
                                {differenceInDays(new Date(), new Date(r.created_date))} ימים
                              </span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        // Rep View
        <div className="space-y-6">
          {/* Target Progress */}
          <TargetProgress 
            targets={targets} 
            actuals={actuals} 
            period={periodLabels[period]}
          />

          {/* My Leads */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="w-5 h-5 text-purple-600" />
                הלידים שלי
                <Badge variant="outline" className="mr-2">{myLeads.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LeadsTable
                leads={myLeads}
                onStatusChange={handleStatusChange}
                onMarkReminderDone={handleMarkReminderDone}
                onEdit={handleOpenEdit}
                employees={employees}
                showAssignee={false}
                isManager={false}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Quick Lead FAB */}
      <QuickLeadButton />

      {/* Edit Lead Modal */}
      {editingLead && (
        <EditLeadModal
          isOpen={!!editingLead}
          onClose={() => setEditingLead(null)}
          lead={editingLead}
          onLeadUpdated={loadData}
        />
      )}
    </div>
  );
}