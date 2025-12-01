import React, { useState, useEffect } from 'react';
import { AttendanceDevice, OvertimeRule } from '@/entities/all';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Save, Monitor, MapPin } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function AttendanceSettings() {
    const [devices, setDevices] = useState([]);
    const [rules, setRules] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [newDevice, setNewDevice] = useState({
        name: '',
        type: 'browser',
        ip_allowlist: ['0.0.0.0/0'],
        is_active: true
    });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        const [devicesData, rulesData] = await Promise.all([
            AttendanceDevice.list(),
            OvertimeRule.list()
        ]);
        setDevices(devicesData);
        setRules(rulesData);
        setIsLoading(false);
    };

    const handleCreateDevice = async () => {
        if (!newDevice.name) return;
        await AttendanceDevice.create(newDevice);
        setNewDevice({ name: '', type: 'browser', ip_allowlist: ['0.0.0.0/0'], is_active: true });
        loadData();
    };

    const handleDeleteDevice = async (id) => {
        if (window.confirm('האם למחוק מכשיר זה?')) {
            await AttendanceDevice.delete(id);
            loadData();
        }
    };

    const toggleDeviceStatus = async (device) => {
        await AttendanceDevice.update(device.id, { is_active: !device.is_active });
        loadData();
    };

    return (
        <div className="p-6 space-y-6">
            <h1 className="text-3xl font-bold text-gray-900">הגדרות נוכחות</h1>

            <Tabs defaultValue="devices">
                <TabsList>
                    <TabsTrigger value="devices">מכשירים</TabsTrigger>
                    <TabsTrigger value="rules">חוקי שעות נוספות</TabsTrigger>
                </TabsList>

                <TabsContent value="devices" className="space-y-6">
                    <Card className="glass-card border-0">
                        <CardHeader>
                            <CardTitle>הוסף מכשיר חדש</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid md:grid-cols-3 gap-4">
                                <div>
                                    <Label>שם המכשיר</Label>
                                    <Input
                                        value={newDevice.name}
                                        onChange={(e) => setNewDevice({...newDevice, name: e.target.value})}
                                        placeholder="מכשיר 1"
                                        className="glass-button"
                                    />
                                </div>
                                <div>
                                    <Label>כתובות IP מאושרות (מופרד בפסיקים)</Label>
                                    <Input
                                        value={newDevice.ip_allowlist.join(',')}
                                        onChange={(e) => setNewDevice({...newDevice, ip_allowlist: e.target.value.split(',')})}
                                        placeholder="0.0.0.0/0 (הכל), או 192.168.1.100"
                                        className="glass-button"
                                    />
                                </div>
                                <div className="flex items-end">
                                    <Button onClick={handleCreateDevice} className="w-full glass-button bg-blue-600/20">
                                        <Plus className="w-4 h-4 ml-2" />
                                        הוסף
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="grid gap-4">
                        {devices.map(device => (
                            <Card key={device.id} className="glass-card border-0">
                                <CardContent className="p-6">
                                    <div className="flex justify-between items-start">
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-3">
                                                <Monitor className="w-5 h-5 text-blue-600" />
                                                <h3 className="font-bold text-lg">{device.name}</h3>
                                                <Badge className={device.is_active ? 'bg-green-500' : 'bg-gray-500'}>
                                                    {device.is_active ? 'פעיל' : 'לא פעיל'}
                                                </Badge>
                                            </div>
                                            <div className="text-sm text-gray-600">
                                                <strong>כתובות IP:</strong> {device.ip_allowlist?.join(', ') || 'לא הוגדר'}
                                            </div>
                                            {device.geo_center_lat && (
                                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                                    <MapPin className="w-4 h-4" />
                                                    גבול גיאוגרפי: {device.geo_radius_m}מ'
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex gap-2">
                                            <Switch
                                                checked={device.is_active}
                                                onCheckedChange={() => toggleDeviceStatus(device)}
                                            />
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleDeleteDevice(device.id)}
                                                className="text-red-600"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </TabsContent>

                <TabsContent value="rules">
                    <Card className="glass-card border-0">
                        <CardHeader>
                            <CardTitle>חוקי שעות נוספות</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-gray-600">
                                ברירת מחדל: 8 שעות רגילות, שעתיים ראשונות ב-125%, מעל זה 150%
                            </p>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}