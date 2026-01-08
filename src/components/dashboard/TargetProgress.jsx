import React from 'react';
import { Progress } from '@/components/ui/progress';

const getProgressColor = (percent) => {
  if (percent >= 100) return 'bg-green-500';
  if (percent >= 61) return 'bg-orange-500';
  return 'bg-red-500';
};

const getProgressBgColor = (percent) => {
  if (percent >= 100) return 'bg-green-100';
  if (percent >= 61) return 'bg-orange-100';
  return 'bg-red-100';
};

const TargetBar = ({ label, actual, target, unit = '' }) => {
  const percent = target > 0 ? Math.round((actual / target) * 100) : 0;
  const colorClass = getProgressColor(percent);
  const bgColorClass = getProgressBgColor(percent);

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center text-sm">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="text-gray-500">
          {unit}{actual.toLocaleString()} / {unit}{target.toLocaleString()}
          <span className={`mr-2 font-bold ${percent >= 100 ? 'text-green-600' : percent >= 61 ? 'text-orange-600' : 'text-red-600'}`}>
            ({percent}%)
          </span>
        </span>
      </div>
      <div className={`h-3 rounded-full ${bgColorClass} overflow-hidden`}>
        <div 
          className={`h-full rounded-full ${colorClass} transition-all duration-500`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
};

export default function TargetProgress({ targets, actuals, period = 'היום' }) {
  const targetTypes = [
    { key: 'Devices', label: 'מכשירים', unit: '' },
    { key: 'AccessoriesRevenue', label: 'אביזרים', unit: '₪' },
    { key: 'Lines4G', label: 'קווים 4G', unit: '' },
    { key: 'Lines5G', label: 'קווים 5G', unit: '' },
    { key: 'TotalSalesRevenue', label: 'סה״כ מכירות', unit: '₪' },
  ];

  const hasAnyData = targetTypes.some(type => 
    (targets?.[type.key] || 0) > 0 || (actuals?.[type.key] || 0) > 0
  );

  if (!hasAnyData) {
    return (
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">יעד מול ביצוע - {period}</h3>
        </div>
        <div className="text-center py-6 text-gray-500">
          <p>לא הוגדרו יעדים לתקופה זו</p>
          <p className="text-sm mt-1">הגדר יעדים במסך "יעדים וביצועים" או "קבוצות מכירה ועמלות"</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">יעד מול ביצוע - {period}</h3>
      </div>
      <div className="space-y-4">
        {targetTypes.map(type => {
          const target = targets?.[type.key] || 0;
          const actual = actuals?.[type.key] || 0;
          if (target === 0 && actual === 0) return null;
          return (
            <TargetBar
              key={type.key}
              label={type.label}
              actual={actual}
              target={target}
              unit={type.unit}
            />
          );
        })}
      </div>
    </div>
  );
}