import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { TrendingUp, CalendarDays, Smartphone, ShoppingBag, Radio, Target } from 'lucide-react';

const formatMoney = (value) => `₪${Number(value || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatUnits = (value) => Number(value || 0).toLocaleString();

function TargetRow({ label, actual, target, isAmount }) {
  if (!target || target <= 0) return null;
  const percent = Math.round((Number(actual || 0) / Number(target || 1)) * 100);
  const color = percent >= 100 ? 'text-emerald-700 bg-emerald-100' : percent >= 60 ? 'text-amber-700 bg-amber-100' : 'text-rose-700 bg-rose-100';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold text-slate-800">
          {isAmount ? formatMoney(actual) : formatUnits(actual)} / {isAmount ? formatMoney(target) : formatUnits(target)}
          <Badge className={`mr-2 border-0 ${color}`}>{percent}%</Badge>
        </span>
      </div>
      <Progress value={Math.min(percent, 100)} className="h-2" />
    </div>
  );
}

function SummaryCard({ title, subtitle, data, icon: Icon, gradient }) {
  const lines4g = data?.Lines4G || 0;
  const lines5g = data?.Lines5G || 0;

  return (
    <Card className={`border-0 shadow-xl overflow-hidden ${gradient}`}>
      <CardContent className="p-5 text-white">
        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <p className="text-white/75 text-sm">{title}</p>
            <p className="text-white/70 text-xs mt-1">{subtitle}</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-white/18 flex items-center justify-center">
            <Icon className="w-6 h-6" />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded-2xl bg-white/14 p-3">
            <Radio className="w-4 h-4 mb-2 text-white/80" />
            <div className="text-3xl font-black">{formatUnits(lines4g)}</div>
            <div className="text-[11px] text-white/70">קווי 4G</div>
          </div>
          <div className="rounded-2xl bg-white/14 p-3">
            <Radio className="w-4 h-4 mb-2 text-white/80" />
            <div className="text-3xl font-black">{formatUnits(lines5g)}</div>
            <div className="text-[11px] text-white/70">קווי 5G</div>
          </div>
          <div className="rounded-2xl bg-white/14 p-3">
            <ShoppingBag className="w-4 h-4 mb-2 text-white/80" />
            <div className="text-3xl font-black">{formatMoney(data?.AccessoriesRevenue)}</div>
            <div className="text-[11px] text-white/70">אביזרים נטו</div>
          </div>
          <div className="rounded-2xl bg-white/14 p-3">
            <Smartphone className="w-4 h-4 mb-2 text-white/80" />
            <div className="text-3xl font-black">{formatUnits(data?.Devices)}</div>
            <div className="text-[11px] text-white/70">מכשירים</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PersonalSalesPulse({ data }) {
  const month = data?.month || {};
  const today = data?.today || {};
  const targets = data?.targets || {};
  const hasTargets = Object.values(targets).some(v => Number(v || 0) > 0);
  const monthLines = (month.Lines4G || 0) + (month.Lines5G || 0);
  const targetLines4G = targets.Lines4G || 0;
  const targetLines5G = targets.Lines5G || 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SummaryCard
          title="הביצוע שלי החודש"
          subtitle="מכירות נטו עד עכשיו"
          data={month}
          icon={TrendingUp}
          gradient="bg-gradient-to-br from-indigo-700 via-purple-700 to-fuchsia-700"
        />
        <SummaryCard
          title="הביצוע שלי היום"
          subtitle="תמונה עדכנית להיום"
          data={today}
          icon={CalendarDays}
          gradient="bg-gradient-to-br from-emerald-700 via-teal-700 to-cyan-700"
        />
      </div>

      <Card className="border-0 shadow-lg bg-white">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-purple-600" />
              <h3 className="font-bold text-slate-900">התקדמות מול יעד אישי החודש</h3>
            </div>
            {!hasTargets && <Badge variant="outline" className="text-slate-500">לא הוגדר יעד</Badge>}
          </div>

          {hasTargets ? (
            <div className="grid md:grid-cols-4 gap-4">
              <TargetRow label="מכשירים" actual={month.Devices} target={targets.Devices} />
              <TargetRow label="אביזרים" actual={month.AccessoriesRevenue} target={targets.AccessoriesRevenue} isAmount />
              <TargetRow label="קווי 4G" actual={month.Lines4G} target={targetLines4G} />
              <TargetRow label="קווי 5G" actual={month.Lines5G} target={targetLines5G} />
            </div>
          ) : (
            <p className="text-sm text-slate-500">ברגע שיוזן יעד לנציג, יוצג כאן אחוז ביצוע מהיעד.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}