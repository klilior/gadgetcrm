import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const ROLES = ["נציג", "מנהל משמרת", "מנהל", "טכנאי"];

export default function UserRoles() {
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const user = await base44.auth.me();
        setMe(user);
        const isManager = user?.role === "admin" || user?.app_role === "מנהל" || user?.data?.app_role === "מנהל";
        if (!isManager) { setLoading(false); return; }
        const res = await base44.functions.invoke('listUsers');
        const list = res.data?.users || res.data || [];
        setUsers(list);
      } finally { setLoading(false); }
    })();
  }, []);

  const updateRole = async (userId, newRole) => {
    setSaving((s) => ({ ...s, [userId]: true }));
    try {
      await base44.functions.invoke('updateUserRole', { userId, app_role: newRole });
      setUsers((prev) => prev.map(u => u.id === userId ? { ...u, app_role: newRole, data: { ...(u.data||{}), app_role: newRole } } : u));
    } finally {
      setSaving((s) => ({ ...s, [userId]: false }));
    }
  };

  if (loading) return <div className="p-6">טוען...</div>;
  const canManage = me?.role === "admin" || me?.app_role === "מנהל" || me?.data?.app_role === "מנהל";
  if (!canManage) return <div className="p-6 text-red-600">אין לך הרשאה לצפות בדף זה</div>;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            ניהול תפקידי משתמשים
            <Badge variant="outline">{users.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {users.map((u) => (
              <div key={u.id} className="bg-white rounded-lg p-3 border flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{u.full_name || u.email}</div>
                  <div className="text-xs text-gray-500 truncate">{u.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-gray-100 text-gray-700">{u.role}</Badge>
                  <Select
                    value={(u.app_role) || u?.data?.app_role || ""}
                    onValueChange={(val) => updateRole(u.id, val)}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="בחר תפקיד" />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map(r => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button disabled size="sm" className="hidden">
                    {saving[u.id] ? "שומר..." : "שמור"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}