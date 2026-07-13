import React, { useMemo, useState } from 'react';
import { HandCoins, TrendingUp, Wrench, PackageMinus, Banknote, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, parseISO, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { he } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const StatCard = ({ title, value, icon: Icon, color, subtitle, highlight }) => (
  <div className={`bg-white/80 backdrop-blur-sm border shadow-sm p-4 sm:p-5 rounded-2xl flex-1 min-w-[140px] ${highlight ? 'border-purple-300 ring-2 ring-purple-100' : 'border-white/40'}`}>
    <div className="flex justify-between items-center">
      <h3 className="text-xs sm:text-sm font-medium text-gray-500">{title}</h3>
      <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${color}`} />
    </div>
    <p className="text-xl sm:text-2xl font-bold mt-1.5 text-gray-900">{value}</p>
    {subtitle && <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>}
  </div>
);

export default function VendorStatsCards({ repairs, labCredits, labPayments }) {
  // Current month as YYYY-MM
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));

  const prevMonth = () => {
    const d = parseISO(selectedMonth + '-01');
    d.setMonth(d.getMonth() - 1);
    setSelectedMonth(format(d, 'yyyy-MM'));
  };
  const nextMonth = () => {
    const d = parseISO(selectedMonth + '-01');
    d.setMonth(d.getMonth() + 1);
    setSelectedMonth(format(d, 'yyyy-MM'));
  };

  // All-time debt calculation (always uses ALL data, no filter)
  const allTimeDebt = useMemo(() => {
    let totalLabDebt = 0, totalCredits = 0, totalPaid = 0;
    repairs.forEach(r => {
      const fp = r.final_price || 0;
      const pc = r.part_cost || 0;
      const gross = fp - pc;
      totalLabDebt += (gross / 2) + pc;
    });
    labCredits.forEach(c => { totalCredits += c.amount || 0; });
    labPayments.forEach(p => { totalPaid += p.amount || 0; });
    return { totalLabDebt, totalCredits, totalPaid, netOwed: totalLabDebt - totalCredits - totalPaid };
  }, [repairs, labCredits, labPayments]);

  // Month-filtered stats
  const monthStats = useMemo(() => {
    const monthStart = startOfMonth(parseISO(selectedMonth + '-01'));
    const monthEnd = endOfMonth(monthStart);
    const interval = { start: monthStart, end: monthEnd };

    const monthRepairs = repairs.filter(r => {
      const d = parseISO(r.updated_date);
      return isWithinInterval(d, interval);
    });

    let totalRevenue = 0, totalPartCost = 0, totalLabDebt = 0;
    monthRepairs.forEach(r => {
      const fp = r.final_price || 0;
      const pc = r.part_cost || 0;
      const gross = fp - pc;
      totalRevenue += fp;
      totalPartCost += pc;
      totalLabDebt += (gross / 2) + pc;
    });

    const netProfit = totalRevenue - totalLabDebt;

    return { totalRevenue, totalPartCost, totalLabDebt, netProfit, count: monthRepairs.length };
  }, [repairs, selectedMonth]);

  const monthLabel = format(parseISO(selectedMonth + '-01'), 'MMMM yyyy', { locale: he });

  return (
    <div className="space-y-4">
      {/* Row 1: All-time debt summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          title="יתרת חוב למעבדה"
          value={`₪${allTimeDebt.netOwed.toLocaleString(undefined, { maximumFractionDigits: 1 })}`}
          icon={HandCoins}
          color="text-purple-600"
          subtitle={`חוב ₪${allTimeDebt.totalLabDebt.toLocaleString(undefined, { maximumFractionDigits: 1 })} − זיכויים ₪${allTimeDebt.totalCredits.toLocaleString()} − שולם ₪${allTimeDebt.totalPaid.toLocaleString()}`}
          highlight
        />
        <StatCard
          title="חוב תיקונים (כל הזמנים)"
          value={`₪${allTimeDebt.totalLabDebt.toLocaleString(undefined, { maximumFractionDigits: 1 })}`}
          icon={HandCoins}
          color="text-orange-500"
          subtitle={`${repairs.length} תיקונים`}
        />
        <StatCard
          title="זיכויים (מוצרים)"
          value={`-₪${allTimeDebt.totalCredits.toLocaleString()}`}
          icon={PackageMinus}
          color="text-red-500"
          subtitle={`${labCredits.length} פריטים`}
        />
        <StatCard
          title="תשלומים ששולמו"
          value={`-₪${allTimeDebt.totalPaid.toLocaleString()}`}
          icon={Banknote}
          color="text-green-600"
          subtitle={`${labPayments.length} תשלומים`}
        />
      </div>

      {/* Month selector */}
      <div className="flex items-center gap-2 bg-white/60 backdrop-blur-sm rounded-xl px-3 py-2 border border-white/40 w-fit">
        <Calendar className="w-4 h-4 text-gray-500" />
        <span className="text-sm font-medium text-gray-600">סינון חודשי:</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={prevMonth}>
          <ChevronRight className="w-4 h-4" />
        </Button>
        <Badge variant="secondary" className="text-sm px-3 py-1 min-w-[120px] text-center justify-center">
          {monthLabel}
        </Badge>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={nextMonth}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
      </div>

      {/* Row 2: Monthly filtered stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          title="סה״כ הכנסות תיקונים"
          value={`₪${monthStats.totalRevenue.toLocaleString()}`}
          icon={TrendingUp}
          color="text-blue-500"
          subtitle={`${monthStats.count} תיקונים`}
        />
        <StatCard
          title="סה״כ עלות חלקים"
          value={`₪${monthStats.totalPartCost.toLocaleString()}`}
          icon={Wrench}
          color="text-orange-500"
        />
        <StatCard
          title="חוב למעבדה (חודשי)"
          value={`₪${monthStats.totalLabDebt.toLocaleString(undefined, { maximumFractionDigits: 1 })}`}
          icon={HandCoins}
          color="text-orange-600"
        />
        <StatCard
          title="רווח נקי (לחנות)"
          value={`₪${monthStats.netProfit.toLocaleString(undefined, { maximumFractionDigits: 1 })}`}
          icon={TrendingUp}
          color="text-green-700"
        />
      </div>
    </div>
  );
}