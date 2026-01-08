import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

const getPercentColor = (percent) => {
  if (percent >= 100) return 'text-green-600 bg-green-100';
  if (percent >= 61) return 'text-orange-600 bg-orange-100';
  return 'text-red-600 bg-red-100';
};

const PercentBadge = ({ percent, actual, target }) => {
  const colorClass = getPercentColor(percent);
  // Show actual/target if available
  const hasData = actual !== undefined && target !== undefined;
  
  return (
    <div className="flex flex-col items-center gap-0.5">
      {hasData && target > 0 && (
        <span className="text-xs text-gray-500">{actual}/{target}</span>
      )}
      {hasData && target === 0 && actual > 0 && (
        <span className="text-xs text-blue-600 font-medium">{actual}</span>
      )}
      {target > 0 && (
        <Badge className={`${colorClass} font-bold text-xs`}>
          {percent}%
        </Badge>
      )}
      {(!hasData || (target === 0 && actual === 0)) && (
        <span className="text-gray-400 text-xs">-</span>
      )}
    </div>
  );
};

export default function TeamPerformanceTable({ teamData }) {
  if (!teamData || teamData.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        אין נתוני צוות להצגה
      </div>
    );
  }

  // Calculate team totals
  const totals = teamData.reduce((acc, member) => ({
    devices: acc.devices + (member.actuals?.Devices || 0),
    devicesTarget: acc.devicesTarget + (member.targets?.Devices || 0),
    accessories: acc.accessories + (member.actuals?.AccessoriesRevenue || 0),
    accessoriesTarget: acc.accessoriesTarget + (member.targets?.AccessoriesRevenue || 0),
    lines4g: acc.lines4g + (member.actuals?.Lines4G || 0),
    lines4gTarget: acc.lines4gTarget + (member.targets?.Lines4G || 0),
    lines5g: acc.lines5g + (member.actuals?.Lines5G || 0),
    lines5gTarget: acc.lines5gTarget + (member.targets?.Lines5G || 0),
    total: acc.total + (member.actuals?.TotalSalesRevenue || 0),
    totalTarget: acc.totalTarget + (member.targets?.TotalSalesRevenue || 0),
    openLeads: acc.openLeads + (member.openLeads || 0),
    overdueLeads: acc.overdueLeads + (member.overdueLeads || 0),
  }), {
    devices: 0, devicesTarget: 0,
    accessories: 0, accessoriesTarget: 0,
    lines4g: 0, lines4gTarget: 0,
    lines5g: 0, lines5gTarget: 0,
    total: 0, totalTarget: 0,
    openLeads: 0, overdueLeads: 0
  });

  const calcPercent = (actual, target) => target > 0 ? Math.round((actual / target) * 100) : 0;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-4 border-b bg-gray-50">
        <h3 className="font-semibold text-gray-900">ביצועי צוות</h3>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead>נציג</TableHead>
              <TableHead className="text-center">% מכשירים</TableHead>
              <TableHead className="text-center">% אביזרים</TableHead>
              <TableHead className="text-center">% 4G</TableHead>
              <TableHead className="text-center">% 5G</TableHead>
              <TableHead className="text-center">% סה״כ</TableHead>
              <TableHead className="text-center">לידים פתוחים</TableHead>
              <TableHead className="text-center">חריגי SLA</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teamData.map((member, index) => (
              <TableRow key={member.userId} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                <TableCell className="font-medium">{member.userName}</TableCell>
                <TableCell className="text-center">
                  <PercentBadge percent={calcPercent(member.actuals?.Devices, member.targets?.Devices)} actual={member.actuals?.Devices || 0} target={member.targets?.Devices || 0} />
                </TableCell>
                <TableCell className="text-center">
                  <PercentBadge percent={calcPercent(member.actuals?.AccessoriesRevenue, member.targets?.AccessoriesRevenue)} actual={member.actuals?.AccessoriesRevenue || 0} target={member.targets?.AccessoriesRevenue || 0} />
                </TableCell>
                <TableCell className="text-center">
                  <PercentBadge percent={calcPercent(member.actuals?.Lines4G, member.targets?.Lines4G)} actual={member.actuals?.Lines4G || 0} target={member.targets?.Lines4G || 0} />
                </TableCell>
                <TableCell className="text-center">
                  <PercentBadge percent={calcPercent(member.actuals?.Lines5G, member.targets?.Lines5G)} actual={member.actuals?.Lines5G || 0} target={member.targets?.Lines5G || 0} />
                </TableCell>
                <TableCell className="text-center">
                  <PercentBadge percent={calcPercent(member.actuals?.TotalSalesRevenue, member.targets?.TotalSalesRevenue)} actual={member.actuals?.TotalSalesRevenue || 0} target={member.targets?.TotalSalesRevenue || 0} />
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="outline">{member.openLeads || 0}</Badge>
                </TableCell>
                <TableCell className="text-center">
                  {(member.overdueLeads || 0) > 0 ? (
                    <Badge className="bg-red-500 text-white">{member.overdueLeads}</Badge>
                  ) : (
                    <Badge variant="outline" className="text-green-600">0</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {/* Team Totals Row */}
            <TableRow className="bg-purple-50 font-bold">
              <TableCell>סה״כ צוות</TableCell>
              <TableCell className="text-center">
                <PercentBadge percent={calcPercent(totals.devices, totals.devicesTarget)} actual={totals.devices} target={totals.devicesTarget} />
              </TableCell>
              <TableCell className="text-center">
                <PercentBadge percent={calcPercent(totals.accessories, totals.accessoriesTarget)} actual={totals.accessories} target={totals.accessoriesTarget} />
              </TableCell>
              <TableCell className="text-center">
                <PercentBadge percent={calcPercent(totals.lines4g, totals.lines4gTarget)} actual={totals.lines4g} target={totals.lines4gTarget} />
              </TableCell>
              <TableCell className="text-center">
                <PercentBadge percent={calcPercent(totals.lines5g, totals.lines5gTarget)} actual={totals.lines5g} target={totals.lines5gTarget} />
              </TableCell>
              <TableCell className="text-center">
                <PercentBadge percent={calcPercent(totals.total, totals.totalTarget)} actual={totals.total} target={totals.totalTarget} />
              </TableCell>
              <TableCell className="text-center">
                <Badge variant="outline">{totals.openLeads}</Badge>
              </TableCell>
              <TableCell className="text-center">
                {totals.overdueLeads > 0 ? (
                  <Badge className="bg-red-500 text-white">{totals.overdueLeads}</Badge>
                ) : (
                  <Badge variant="outline" className="text-green-600">0</Badge>
                )}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}