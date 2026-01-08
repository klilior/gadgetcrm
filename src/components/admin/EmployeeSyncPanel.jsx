import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, PlayCircle } from 'lucide-react';
import { syncEmployeeIds } from '@/functions/syncEmployeeIds';

const ENTITIES = [
  { value: 'all', label: 'הכל' },
  { value: 'users', label: 'משתמשים (User)' },
  { value: 'salesTransactions', label: 'מכירות (SalesTransaction)' },
  { value: 'salesActivities', label: 'פעילות מכירות (SalesActivity)' },
  { value: 'targets', label: 'יעדים (Target)' },
];

export default function EmployeeSyncPanel() {
  const [entity, setEntity] = useState('all');
  const [limit, setLimit] = useState(500);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const run = async (dry) => {
    try {
      setLoading(true);
      setResult(null);
      const { data } = await syncEmployeeIds({ dry_run: dry, limit: Number(limit), entity });
      setResult(data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-amber-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          סנכרון שכבת עובדים
          <Badge variant="outline" className="text-amber-700 border-amber-300">employee_id</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>ישות</Label>
            <Select value={entity} onValueChange={setEntity}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITIES.map(e => (
                  <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Limit</Label>
            <Input type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} />
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={() => run(true)} variant="outline" disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            הרצה יבשה (Dry-Run)
          </Button>
          <Button onClick={() => run(false)} disabled={loading} className="gap-2 bg-amber-600 hover:bg-amber-700">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            עדכון נתונים (Run)
          </Button>
        </div>

        <Separator />

        {result && (
          <div className="space-y-2">
            <div className="text-sm text-gray-600">תוצאה</div>
            <pre className="bg-gray-50 border rounded p-3 text-xs overflow-auto max-h-80">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}