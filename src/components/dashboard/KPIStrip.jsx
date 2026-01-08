import React from 'react';
import { Smartphone, ShoppingBag, Signal, Zap, DollarSign } from 'lucide-react';

const KPICard = ({ title, value, icon: Icon, prefix = '', suffix = '' }) => (
  <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex-1 min-w-[140px]">
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{title}</span>
      <Icon className="w-4 h-4 text-gray-400" />
    </div>
    <p className="text-2xl font-bold text-gray-900">
      {prefix}{typeof value === 'number' ? value.toLocaleString() : value}{suffix}
    </p>
  </div>
);

export default function KPIStrip({ data, showTeamStats = false }) {
  const kpis = [
    { key: 'devices', title: 'מכשירים', icon: Smartphone, value: data?.devices || 0 },
    { key: 'accessories', title: 'אביזרים', icon: ShoppingBag, value: data?.accessories || 0, prefix: '₪' },
    { key: 'lines4g', title: 'קווים 4G', icon: Signal, value: data?.lines4g || 0 },
    { key: 'lines5g', title: 'קווים 5G', icon: Zap, value: data?.lines5g || 0 },
    { key: 'total', title: 'סה״כ מכירות', icon: DollarSign, value: data?.total || 0, prefix: '₪' },
  ];

  if (showTeamStats) {
    kpis.push(
      { key: 'openLeads', title: 'לידים פתוחים', icon: Signal, value: data?.openLeads || 0 },
      { key: 'overdueLeads', title: 'חריגי SLA', icon: Zap, value: data?.overdueLeads || 0 }
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {kpis.map(kpi => (
        <KPICard
          key={kpi.key}
          title={kpi.title}
          value={kpi.value}
          icon={kpi.icon}
          prefix={kpi.prefix}
          suffix={kpi.suffix}
        />
      ))}
    </div>
  );
}