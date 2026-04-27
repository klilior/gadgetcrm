import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Truck, Settings, Zap, Loader2, Check, X, Save } from "lucide-react";
import { ShippingProvider } from "@/entities/all";
import { cargoApi } from "@/functions/cargoApi";
import { toast } from "sonner";

export default function CargoSettingsCard({ provider, onUpdate }) {
  const config = provider?.config || {};
  
  const [apiToken, setApiToken] = useState(config.api_token || '');
  const [customerCode, setCustomerCode] = useState(config.customer_code || '7625');
  const [senderStreet, setSenderStreet] = useState(config.sender_street || 'שדרות משה דיין 3');
  const [senderCity, setSenderCity] = useState(config.sender_city || 'יהוד');
  const [senderPhone, setSenderPhone] = useState(config.sender_phone || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [isEditing, setIsEditing] = useState(!provider);

  const handleSave = async () => {
    if (!apiToken) {
      toast.error('נא להזין API Token');
      return;
    }
    if (!senderPhone) {
      toast.error('נא להזין טלפון שולח');
      return;
    }
    
    setIsSaving(true);
    try {
      const newConfig = {
        api_token: apiToken,
        customer_code: customerCode,
        sender_street: senderStreet,
        sender_city: senderCity,
        sender_phone: senderPhone,
      };

      if (provider) {
        await ShippingProvider.update(provider.id, {
          config: newConfig,
          api_url: 'https://api-v2.cargo.co.il/api/',
        });
      } else {
        await ShippingProvider.create({
          name: 'קארגו',
          provider_type: 'cargo',
          is_active: true,
          config: newConfig,
          api_url: 'https://api-v2.cargo.co.il/api/',
          supported_carriers: ['cargo'],
        });
      }
      
      toast.success('הגדרות קארגו נשמרו בהצלחה!');
      setIsEditing(false);
      if (onUpdate) onUpdate();
    } catch (e) {
      toast.error('שגיאה בשמירה: ' + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!apiToken) {
      toast.error('נא להזין API Token לבדיקה');
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await cargoApi({ action: 'test_connection', api_token: apiToken });
      const data = res.data || res;
      setTestResult(data);
      if (data.success) {
        toast.success('החיבור תקין!');
      } else {
        toast.error(data.error || 'החיבור נכשל');
      }
    } catch (e) {
      setTestResult({ success: false, error: e.message });
      toast.error('שגיאה: ' + e.message);
    } finally {
      setIsTesting(false);
    }
  };

  const handleToggleActive = async () => {
    if (!provider) return;
    try {
      await ShippingProvider.update(provider.id, { is_active: !provider.is_active });
      toast.success(provider.is_active ? 'קארגו כובה' : 'קארגו הופעל');
      if (onUpdate) onUpdate();
    } catch (e) {
      toast.error('שגיאה: ' + e.message);
    }
  };

  return (
    <Card className="glass-card border-0 overflow-hidden">
      <div className="bg-gradient-to-r from-blue-500 to-indigo-600 p-4 text-white flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/20 rounded-xl">
            <Truck className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold">קארגו (Cargo)</h3>
            <p className="text-blue-100 text-sm">cargo.co.il — שילוח ולוגיסטיקה</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {provider && (
            <>
              <Badge className={provider.is_active ? 'bg-green-400/30 text-green-100' : 'bg-gray-400/30 text-gray-200'}>
                {provider.is_active ? 'פעיל' : 'כבוי'}
              </Badge>
              <Switch checked={provider.is_active} onCheckedChange={handleToggleActive} />
            </>
          )}
        </div>
      </div>
      
      <CardContent className="p-5 space-y-4">
        {!isEditing && provider ? (
          // Read-only view
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-500">API Token:</span>
                <span className="mr-2 font-mono">{'•'.repeat(12)}{apiToken.slice(-4)}</span>
              </div>
              <div>
                <span className="text-gray-500">קוד לקוח:</span>
                <span className="mr-2 font-mono">{customerCode}</span>
              </div>
              <div>
                <span className="text-gray-500">כתובת שולח:</span>
                <span className="mr-2">{senderStreet}, {senderCity}</span>
              </div>
              <div>
                <span className="text-gray-500">טלפון שולח:</span>
                <span className="mr-2 font-mono">{senderPhone}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setIsEditing(true)}>
                <Settings className="w-4 h-4 ml-1" />
                ערוך הגדרות
              </Button>
              <Button variant="outline" size="sm" className="rounded-xl" onClick={handleTest} disabled={isTesting}>
                {isTesting ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Zap className="w-4 h-4 ml-1" />}
                בדוק חיבור
              </Button>
            </div>
          </div>
        ) : (
          // Edit view
          <div className="space-y-3">
            <div>
              <Label>API Token *</Label>
              <Input
                type="password"
                value={apiToken}
                onChange={e => setApiToken(e.target.value)}
                placeholder="הכנס את הטוקן מקארגו"
                className="font-mono"
              />
            </div>
            <div>
              <Label>קוד לקוח</Label>
              <Input value={customerCode} onChange={e => setCustomerCode(e.target.value)} placeholder="7625" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>רחוב שולח</Label>
                <Input value={senderStreet} onChange={e => setSenderStreet(e.target.value)} placeholder="שדרות משה דיין 3" />
              </div>
              <div>
                <Label>עיר שולח</Label>
                <Input value={senderCity} onChange={e => setSenderCity(e.target.value)} placeholder="יהוד" />
              </div>
            </div>
            <div>
              <Label>טלפון שולח *</Label>
              <Input value={senderPhone} onChange={e => setSenderPhone(e.target.value)} placeholder="03-1234567" />
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 hover:bg-blue-700 rounded-xl">
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Save className="w-4 h-4 ml-1" />}
                {isSaving ? 'שומר...' : 'שמור'}
              </Button>
              <Button variant="outline" size="sm" className="rounded-xl" onClick={handleTest} disabled={isTesting}>
                {isTesting ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Zap className="w-4 h-4 ml-1" />}
                בדוק חיבור
              </Button>
              {provider && (
                <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>ביטול</Button>
              )}
            </div>
          </div>
        )}

        {testResult && (
          <div className={`rounded-xl p-3 text-sm border ${testResult.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
            {testResult.success ? (
              <div className="flex items-center gap-2"><Check className="w-4 h-4" /> {testResult.message}</div>
            ) : (
              <div className="flex items-center gap-2"><X className="w-4 h-4" /> {testResult.error}</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}