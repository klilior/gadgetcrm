import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from "@/api/base44Client";
import { Lead, Target, SalesActivity, Employee, Repair, Client, GoalDefinition, GoalProgress, SalesTransaction, LinetUsersMap } from '@/entities/all';
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
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

import KPIStrip from '../components/dashboard/KPIStrip';
import SalesVsTarget from '../components/dashboard/SalesVsTarget';
import LeadsTable from '../components/dashboard/LeadsTable';
import RemindersAlert from '../components/dashboard/RemindersAlert';
import TeamPerformanceTable from '../components/dashboard/TeamPerformanceTable';
import QuickLeadsToComplete from '../components/dashboard/QuickLeadsToComplete';
import EditLeadModal from '../components/leads/EditLeadModal';
import UndeliveredOrdersWidget from '../components/dashboard/UndeliveredOrdersWidget';
import { 
  buildEmployeeMap, 
  groupSalesByEmployee,
  calculateSalesSummarySigned,
  filterGoalsByEmployee,
  filterTargetsByEmployee,
  mapGoalsToTargets,
  mapTargetsToMap
} from '../components/utils/employeeMapping';

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
  const [period, setPeriod] = useState('month'); // today, week, month (ברירת מחדל לנציג: החודש)
  const [focusMode, setFocusMode] = useState(false);
  const [leadFilter, setLeadFilter] = useState('open');
  
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

  // Determine role: prefer app_role (set by UserAuth from Employee.role), then currentUser.role
  const appRole = currentUser?.app_role || currentUser?.role || currentUser?.data?.app_role;
  // isManager includes both מנהל and מנהל משמרת for dashboard capabilities
  const isManager = appRole === 'מנהל' || appRole === 'מנהל משמרת' || currentUser?.role === 'admin';
  // isFullManager is only for full managers (not shift managers) - used for specific admin features
  const isFullManager = appRole === 'מנהל' || currentUser?.role === 'admin';
  
  // Debug log for role resolution
  console.log('[AgentDashboard] Role check:', { appRole, role: currentUser?.role, isManager, isFullManager, userName: currentUser?.employee_name });
  const userId = currentUser?.id;
  const currentEmployeeId = employees.find(e => e.employee_name === currentUser?.employee_name)?.id || userId;

  const loadData = useCallback(async () => {
    if (!currentUser) return;
    const start = Date.now();
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

      // Format dates for server-side filtering
      const dateFromStr = format(dateStart, 'yyyy-MM-dd');
      const dateToStr = format(dateEnd, 'yyyy-MM-dd');

      // Load all data in parallel — with DATE FILTERS on large entities
      const [allLeads, allTargets, allActivities, allEmployees, allRepairs, allGoals, allGoalProgress, allSalesTransactions, allLinetUsersMap] = await Promise.all([
        Lead.filter({ status: { $ne: 'Deleted' } }),
        Target.filter({ period_start: { $lte: dateToStr }, period_end: { $gte: dateFromStr } }).catch(() => []),
        SalesActivity.filter({ activity_date: { $gte: dateFromStr, $lte: dateToStr } }).catch(() => []),
        Employee.filter({ is_active: true }),
        isManager ? Repair.filter({ status: { $nin: ['תיקון נסגר', 'Closed'] } }, '-updated_date', 100) : Promise.resolve([]),
        GoalDefinition.filter({ is_active: true }),
        GoalProgress.filter({ period_start: { $lte: dateToStr }, period_end: { $gte: dateFromStr } }).catch(() => []),
        SalesTransaction.filter({ issue_date: { $gte: dateFromStr, $lte: dateToStr } }, '-issue_date', 5000).catch(() => []),
        LinetUsersMap.list()
      ]);
      console.log(`⏱️ [AgentDashboard] Data fetched in ${Date.now() - start}ms — Sales: ${allSalesTransactions.length}, Activities: ${allActivities.length}`);

      // Fire calculateGoalProgress in background (non-blocking)
      base44.functions.invoke('calculateGoalProgress', { calculate_all: true }).catch(() => {});
      
      // Build employee map with all aliases for matching
      const employeeMap = buildEmployeeMap(allEmployees || [], allLinetUsersMap || []);

      setEmployees(allEmployees || []);

      // Filter leads
      const activeLeads = (allLeads || []).filter(l => l.status !== 'Deleted');
      setLeads(activeLeads);

      // Map current user to employee id (fallback to user id)
      const meEmp = (allEmployees || []).find(e => e.employee_name === (currentUser?.employee_name || ''));
      const myEmpId = meEmp?.id || userId;

      // My leads (for rep view) - include legacy notes assigned to userId
      const myOpenLeads = activeLeads.filter(l => 
        (l.assigned_to === myEmpId || l.assigned_to === userId) && 
        (l.status === 'New' || l.status === 'InProgress')
      );
      setMyLeads(myOpenLeads);

      // Reminders (within next hour or overdue)
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
      const activeReminders = activeLeads.filter(l => 
        (l.assigned_to === myEmpId || l.assigned_to === userId) &&
        l.reminder_at && 
        !l.reminder_done &&
        l.status !== 'Closed' &&
        new Date(l.reminder_at) <= oneHourFromNow
      );
      setReminders(activeReminders);

      // Quick notes candidates: include capture_type="Quick" OR quick_incomplete flag; let widget filter status
      // For managers (including shift managers), show ALL quick notes
      // For regular reps, show only their own
      const quickIncomplete = activeLeads.filter(l => {
        // Must be quick note
        const isQuickNote = l.capture_type === 'Quick' || l.quick_incomplete === true;
        if (!isQuickNote) return false;
        
        // Must not be deleted
        if (l.status === 'Deleted') return false;
        
        // Filter out test/demo leads
        if (l.customer_name?.includes('בדיקת פתק') || 
            l.customer_name?.includes('בדיקת מערכת') ||
            l.topic?.includes('בדיקת מערכת')) return false;
        
        // Managers see all, reps see only their own
        if (isManager) return true;
        return l.assigned_to === myEmpId || l.assigned_to === userId;
      }).sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
      
      console.log('[AgentDashboard] Quick notes found:', quickIncomplete.length, 'isManager:', isManager);

      // Include legacy notes even if not marked quick_incomplete
      const norm = (s) => (s || '').toString().toLowerCase();
      const matchLegacy = (l) => {
        const t = norm(l.topic);
        const n = norm(l.notes);
        // Legacy 1: contains both "בייסיק" and "a17" (any order)
        const legacyA17 = (t.includes('בייסיק') || n.includes('בייסיק')) && (t.includes('a17') || n.includes('a17'));
        // Legacy 2: contains "כבל" and "אייפון" and either "ישן" or " 4"
        const legacyCable = (t.includes('כבל') || n.includes('כבל')) && (t.includes('אייפון') || n.includes('אייפון')) && (t.includes('ישן') || n.includes('ישן') || t.includes(' 4') || n.includes(' 4'));
        return legacyA17 || legacyCable;
      };
      const legacyNotes = activeLeads.filter(l => l.status !== 'Deleted' && matchLegacy(l));

      // Merge and deduplicate
      const mergedQuick = [...quickIncomplete, ...legacyNotes].reduce((acc, item) => {
        if (!acc.some(x => x.id === item.id)) acc.push(item);
        return acc;
      }, []);
      setQuickLeads(mergedQuick);

      // Activities already filtered server-side by date
      const periodActivities = allActivities || [];

      // Fallback actuals from SalesActivity for the current user
      const myActivities = (periodActivities || []).filter(a => a.user_id === userId);
      const myActualsFromActivities = {
        Devices: myActivities.filter(a => a.metric_type === 'Devices').reduce((s, a) => s + (a.metric_value || 0), 0),
        AccessoriesRevenue: myActivities.filter(a => a.metric_type === 'AccessoriesRevenue').reduce((s, a) => s + (a.metric_value || 0), 0),
        Lines4G: myActivities.filter(a => a.metric_type === 'Lines4G').reduce((s, a) => s + (a.metric_value || 0), 0),
        Lines5G: myActivities.filter(a => a.metric_type === 'Lines5G').reduce((s, a) => s + (a.metric_value || 0), 0),
        TotalSalesRevenue: myActivities.filter(a => a.metric_type === 'TotalSalesRevenue').reduce((s, a) => s + (a.metric_value || 0), 0),
      };

      // Goals and targets already filtered server-side by date
      const periodGoals = allGoals || [];
      const periodTargets = allTargets || [];

      // ========== Current user's targets (from GoalDefinition + Target) ==========
      const myGoals = filterGoalsByEmployee(periodGoals, employeeMap, userId);
      const myTargetsRaw = filterTargetsByEmployee(periodTargets, userId);

      // יעד לנציג לפי GoalDefinition (מועדף), עם נפילה אחורה ל-Target entity
      const computedTargets = { Devices: 0, AccessoriesRevenue: 0, Lines: 0 };
      (myGoals || []).forEach(g => {
        const code = g.commission_group_code;
        const metric = g.metric_type;
        const val = g.target_value || 0;
        if (code === 'DEVICES' && metric === 'UNITS') computedTargets.Devices += val;
        if (code === 'ACCESSORIES_GROUP' && metric === 'NET_AMOUNT') computedTargets.AccessoriesRevenue += val;
        if (code === 'LINES' && (metric === 'UNITS' || metric === 'LINES_4G_UNITS' || metric === 'LINES_5G_UNITS')) computedTargets.Lines += val;
      });

      if (computedTargets.Devices === 0 && computedTargets.AccessoriesRevenue === 0 && computedTargets.Lines === 0) {
        const myTargetsMap = mapTargetsToMap(myTargetsRaw);
        computedTargets.Devices = myTargetsMap.Devices || 0;
        computedTargets.AccessoriesRevenue = myTargetsMap.AccessoriesRevenue || 0;
        computedTargets.Lines = myTargetsMap.Lines || 0;
      }

      setTargets(computedTargets);

      // SalesTransactions already filtered server-side by date
      const periodSales = allSalesTransactions || [];
      // שיוך חד-חד ערכי של עסקאות לנציגים
      const salesByEmployee = groupSalesByEmployee(periodSales, employeeMap);
      
      // Helper to match sales rep names (handle Linet variations)
      // Linet uses first name only (e.g., "דניאל", "גיא") while Employee has full name (e.g., "דניאל קריידן", "גיא פאר")
      const matchSalesRep = (txSalesRep, employeeName) => {
        if (!txSalesRep || !employeeName) return false;
        const normalizedTx = txSalesRep.trim();
        const normalizedEmp = employeeName.trim();
        const empFirstName = normalizedEmp.split(' ')[0];
        // Check: exact match, first name match, or contains
        return normalizedTx === normalizedEmp || 
               normalizedTx === empFirstName ||
               normalizedEmp.startsWith(normalizedTx + ' ') ||
               normalizedTx.includes(normalizedEmp) || 
               normalizedEmp.includes(normalizedTx);
      };
      
      // Helper to identify category type from Linet category field
      const isDeviceCategory = (cat, productName) => {
        if (!cat && !productName) return false;
        const catLower = (cat || '').toLowerCase();
        const prodLower = (productName || '').toLowerCase();
        // Match "טלפונים סלולרים" category from Linet
        return catLower.includes('טלפון') || catLower.includes('סמארטפון') ||
               catLower === 'טלפונים סלולרים' || 
               prodLower.includes('galaxy') || prodLower.includes('iphone') || 
               prodLower.includes('סמסונג') || prodLower.includes('אייפון');
      };
      
      const isAccessoryCategory = (cat) => {
        if (!cat) return false;
        const lower = cat.toLowerCase();
        // Match "אביזרים סלולריים" category from Linet
        return lower.includes('אביזר') || lower === 'אביזרים סלולריים';
      };
      
      const isLineCategory = (cat, productName) => {
        if (!cat && !productName) return false;
        const catLower = (cat || '').toLowerCase();
        const prodLower = (productName || '').toLowerCase();
        return catLower.includes('קו') || catLower.includes('sim') || catLower.includes('line') || 
               catLower.includes('חבילה') || catLower.includes('מנוי') ||
               prodLower.includes('sim') || prodLower.includes('קו') || prodLower.includes('חבילה');
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
      
      const mySales = salesByEmployee[userId] || [];
      
      // חישוב מכירות חתומות (כולל זיכויים) אחרי שיוך ייחודי
      const mySummary = calculateSalesSummarySigned(mySales);
      
      // העדפה לעסקאות בפועל אם קיימות בכלל (גם אם התוצאה 0 נטו), אחרת מגיבוי SalesActivity
      const hasMyTx = (mySales || []).length > 0;
      const finalActuals = {
        Devices: hasMyTx ? mySummary.Devices : myActualsFromActivities.Devices,
        AccessoriesRevenue: hasMyTx ? mySummary.AccessoriesRevenue : myActualsFromActivities.AccessoriesRevenue,
        Lines4G: hasMyTx ? mySummary.Lines4G : myActualsFromActivities.Lines4G,
        Lines5G: hasMyTx ? mySummary.Lines5G : myActualsFromActivities.Lines5G,
        TotalSalesRevenue: hasMyTx ? mySummary.TotalSalesRevenue : myActualsFromActivities.TotalSalesRevenue,
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
            const empSales = salesByEmployee[emp.id] || [];
            
            const empActivities = periodActivities.filter(a => a.user_id === emp.id);
            const empTargets = (allTargets || []).filter(t => 
              t.user_id === emp.id &&
              new Date(t.period_start) <= dateEnd &&
              new Date(t.period_end) >= dateStart
            );
            
            const hasEmpTx = (empSales || []).length > 0;
            const empSummary = calculateSalesSummarySigned(empSales);

            // Fallback ל‑SalesActivity רק אם אין בכלל עסקאות בחתך התקופה
            const empActuals = {
              Devices: hasEmpTx ? empSummary.Devices : empActivities.filter(a => a.metric_type === 'Devices').reduce((s, a) => s + (a.metric_value || 0), 0),
              AccessoriesRevenue: hasEmpTx ? empSummary.AccessoriesRevenue : empActivities.filter(a => a.metric_type === 'AccessoriesRevenue').reduce((s, a) => s + (a.metric_value || 0), 0),
              Lines4G: hasEmpTx ? empSummary.Lines4G : empActivities.filter(a => a.metric_type === 'Lines4G').reduce((s, a) => s + (a.metric_value || 0), 0),
              Lines5G: hasEmpTx ? empSummary.Lines5G : empActivities.filter(a => a.metric_type === 'Lines5G').reduce((s, a) => s + (a.metric_value || 0), 0),
              TotalSalesRevenue: hasEmpTx ? empSummary.TotalSalesRevenue : empActivities.filter(a => a.metric_type === 'TotalSalesRevenue').reduce((s, a) => s + (a.metric_value || 0), 0),
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

        // Repairs data - set immediately without enrichment, enrich in background
        const repairsList = allRepairs || [];
        setRepairs(repairsList);
      } else {
        // Rep KPIs - use finalActuals (from SalesTransaction)
        setKpiData({
          devices: finalActuals.Devices,
          accessories: finalActuals.AccessoriesRevenue,
          lines4g: finalActuals.Lines4G,
          lines5g: finalActuals.Lines5G,
          total: finalActuals.TotalSalesRevenue,
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
    // Auto-refresh every 3 minutes (was 60s — reduced API load)
    const interval = setInterval(loadData, 180000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleStatusChange = async (leadId, newStatus) => {
    try {
      const lead = leads.find(l => l.id === leadId);
      const updateData = { status: newStatus };
      if (newStatus === 'Deleted') {
        updateData.deleted_at = new Date().toISOString();
      }
      if (newStatus === 'InProgress' && lead?.quick_incomplete) {
        updateData.quick_incomplete = false;
        updateData.capture_type = 'Full';
      }
      if (newStatus === 'Closed' && lead?.quick_incomplete) {
        updateData.quick_incomplete = false;
        updateData.capture_type = 'Full';
      }
      await Lead.update(leadId, updateData);
      // Optimistic update — update local state instead of full reload
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, ...updateData } : l));
      setMyLeads(prev => prev.filter(l => {
        if (l.id !== leadId) return true;
        return updateData.status === 'New' || updateData.status === 'InProgress';
      }));
      setQuickLeads(prev => prev.filter(l => l.id !== leadId || updateData.status !== 'Deleted'));
    } catch (error) {
      console.error('❌ Error updating lead status:', error);
    }
  };

  const handleMarkReminderDone = async (leadId) => {
    try {
      const lead = leads.find(l => l.id === leadId);
      const updateData = { reminder_done: true };
      if (lead?.quick_incomplete) {
        updateData.quick_incomplete = false;
        updateData.capture_type = 'Full';
      }
      await Lead.update(leadId, updateData);
      // Optimistic update
      setReminders(prev => prev.filter(l => l.id !== leadId));
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, ...updateData } : l));
    } catch (error) {
      console.error('❌ Error marking reminder done:', error);
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
      const updateData = { assigned_to: newAssigneeId, assigned_to_name: emp?.employee_name || '' };
      await Lead.update(leadId, updateData);
      // Optimistic update
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, ...updateData } : l));
    } catch (error) {
      console.error('❌ Error reassigning lead:', error);
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
  let baseLeads;
  if (isManager) {
    if (leadFilter === 'closed') baseLeads = leads.filter(l => l.status === 'Closed');
    else if (leadFilter === 'all') baseLeads = leads;
    else baseLeads = leads.filter(l => l.status !== 'Closed');
  } else {
    if (leadFilter === 'closed') baseLeads = leads.filter(l => l.assigned_to === currentEmployeeId && l.status === 'Closed');
    else if (leadFilter === 'all') baseLeads = leads.filter(l => l.assigned_to === currentEmployeeId && l.status !== 'Deleted');
    else baseLeads = myLeads;
  }
  const displayLeads = focusMode ? overdueLeads : baseLeads;

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

          <Select value={leadFilter} onValueChange={setLeadFilter}>
            <SelectTrigger className="w-36">
              <Filter className="w-4 h-4 ml-2" />
              <SelectValue placeholder="סינון לידים" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">הכל</SelectItem>
              <SelectItem value="open">פתוחים בלבד</SelectItem>
              <SelectItem value="closed">סגורים</SelectItem>
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
      <QuickLeadsToComplete
        leads={quickLeads}
        onComplete={handleOpenEdit}
        onProcess={(id) => handleStatusChange(id, 'InProgress')}
        onClose={(id) => handleStatusChange(id, 'Closed')}
        onSetReminder={handleSetReminder}
        onDelete={(id) => handleStatusChange(id, 'Deleted')}
      />

      {/* Reminders Alert */}
      {reminders.length > 0 && (
        <RemindersAlert 
          reminders={reminders} 
          onMarkDone={handleMarkReminderDone}
          onCall={handleCall}
        />
      )}

      {/* Undelivered Orders Widget */}
      <UndeliveredOrdersWidget 
        currentUser={currentUser}
        isManager={isManager}
        employees={employees}
        compact={false}
        onRefresh={loadData}
      />

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
                          <div className="space-y-0.5">
                            <div className="font-medium">{r.customer?.full_name || 'לקוח לא ידוע'}</div>
                            <div className="text-xs text-gray-500">כניסה: {format(new Date(r.created_date), 'dd/MM/yyyy')} · עדכון: {format(new Date(r.updated_date), 'dd/MM/yyyy')}</div>
                            <div className="text-xs">סוג: <Link className="text-purple-600 hover:text-purple-700 underline" to={createPageUrl(`RepairDashboard?repairId=${r.id}`)}>{r.repair_type || 'לא צוין'}</Link></div>
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
                              <div className="space-y-0.5">
                                <div className="font-medium">{r.customer?.full_name || 'לקוח לא ידוע'}</div>
                                <div className="text-xs text-gray-600">כניסה: {format(new Date(r.created_date), 'dd/MM/yyyy')} · עדכון: {format(new Date(r.updated_date), 'dd/MM/yyyy')}</div>
                                <div className="text-xs">סוג: <Link className="text-purple-600 hover:text-purple-700 underline" to={createPageUrl(`RepairDashboard?repairId=${r.id}`)}>{r.repair_type || 'לא צוין'}</Link></div>
                              </div>
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
                              <div className="space-y-0.5">
                                <div className="font-medium">{r.customer?.full_name || 'לקוח לא ידוע'}</div>
                                <div className="text-xs text-gray-600">כניסה: {format(new Date(r.created_date), 'dd/MM/yyyy')} · עדכון: {format(new Date(r.updated_date), 'dd/MM/yyyy')}</div>
                                <div className="text-xs">סוג: <Link className="text-purple-600 hover:text-purple-700 underline" to={createPageUrl(`RepairDashboard?repairId=${r.id}`)}>{r.repair_type || 'לא צוין'}</Link></div>
                              </div>
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
          {/* Sales vs Target - Rep Widget */}
          <SalesVsTarget
            targets={targets}
            actuals={{
              Devices: actuals?.Devices || 0,
              AccessoriesRevenue: actuals?.AccessoriesRevenue || 0,
              Lines: (actuals?.Lines4G || 0) + (actuals?.Lines5G || 0),
            }}
            periodLabel={periodLabels[period]}
          />

          {/* My Leads */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="w-5 h-5 text-purple-600" />
                הלידים שלי
                <Badge variant="outline" className="mr-2">
                  {leadFilter === 'all' 
                    ? leads.filter(l => (l.assigned_to === currentEmployeeId || l.assigned_to === userId) && l.status !== 'Deleted').length 
                    : myLeads.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LeadsTable
                leads={leadFilter === 'all'
                  ? leads.filter(l => (l.assigned_to === currentEmployeeId || l.assigned_to === userId) && l.status !== 'Deleted')
                  : (leadFilter === 'closed'
                      ? leads.filter(l => (l.assigned_to === currentEmployeeId || l.assigned_to === userId) && l.status === 'Closed')
                      : myLeads)
                }
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