import React, { useState, useEffect, useCallback } from 'react';
import { AttendanceEvent } from '@/entities/all';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LogIn, LogOut, Clock, MapPin, Wifi, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { useUser } from '../components/UserAuth';
import { clockIn } from '@/functions/clockIn';
import { clockOut } from '@/functions/clockOut';

export default function AttendanceClockPage() {
    const { currentUser } = useUser();
    const [currentStatus, setCurrentStatus] = useState(null);
    const [todayEvents, setTodayEvents] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [currentTime, setCurrentTime] = useState(new Date());
    const [location, setLocation] = useState(null);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const loadTodayStatus = useCallback(async () => {
        if (!currentUser) return;
        
        try {
            const israelTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
            const todayDate = israelTime.toISOString().split('T')[0];
            
            const events = await AttendanceEvent.filter({
                user_id: currentUser.id,
                event_time: { $gte: `${todayDate}T00:00:00`, $lt: `${todayDate}T23:59:59` }
            }, '-event_time');

            setTodayEvents(events);
            
            if (events.length > 0) {
                const lastEvent = events[0];
                setCurrentStatus(lastEvent.event_type === 'in' ? 'in' : 'out');
            } else {
                setCurrentStatus('out');
            }
        } catch (error) {
            console.error('Error loading status:', error);
        }
    }, [currentUser]);

    useEffect(() => {
        if (currentUser) {
            loadTodayStatus();
            requestLocation();
        }
    }, [currentUser, loadTodayStatus]);

    const requestLocation = () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    setLocation({
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    });
                },
                (error) => {
                    console.log('Location error:', error);
                }
            );
        }
    };

    const handleClockIn = async () => {
        setIsLoading(true);
        setError('');
        setMessage('');
        
        try {
            const { data } = await clockIn({
                geo_lat: location?.lat,
                geo_lng: location?.lng
            });
            
            if (data.success) {
                setMessage(data.message);
                loadTodayStatus();
            } else {
                setError(data.error);
            }
        } catch (err) {
            setError('שגיאה בדיווח כניסה');
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleClockOut = async () => {
        setIsLoading(true);
        setError('');
        setMessage('');
        
        try {
            const { data } = await clockOut({
                geo_lat: location?.lat,
                geo_lng: location?.lng
            });
            
            if (data.success) {
                setMessage(data.message);
                loadTodayStatus();
            } else {
                setError(data.error);
            }
        } catch (err) {
            setError('שגיאה בדיווח יציאה');
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    const formatEventTime = (dateStr) => {
        return format(new Date(dateStr), 'HH:mm:ss', { locale: he });
    };

    const getEventTypeLabel = (type) => {
        const labels = {
            'in': 'כניסה',
            'out': 'יציאה',
            'auto_out': 'יציאה אוטומטית',
            'break_in': 'תחילת הפסקה',
            'break_out': 'סיום הפסקה'
        };
        return labels[type] || type;
    };

    return (
        <div className="p-6 space-y-6 max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold text-gray-900">שעון נוכחות</h1>

            <Card className="glass-card border-0 text-center">
                <CardContent className="p-8">
                    <Clock className="w-16 h-16 mx-auto mb-4 text-blue-600" />
                    <div className="text-5xl font-bold text-gray-900 mb-2">
                        {format(currentTime, 'HH:mm:ss')}
                    </div>
                    <div className="text-xl text-gray-600">
                        {format(currentTime, 'EEEE, d MMMM yyyy', { locale: he })}
                    </div>
                    
                    {currentStatus && (
                        <div className="mt-6">
                            <Badge className={`text-lg py-2 px-4 ${currentStatus === 'in' ? 'bg-green-500' : 'bg-gray-500'}`}>
                                {currentStatus === 'in' ? '✓ נמצא בעבודה' : 'לא בעבודה'}
                            </Badge>
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-4">
                <Button 
                    onClick={handleClockIn}
                    disabled={isLoading || currentStatus === 'in'}
                    className="h-32 text-2xl font-bold bg-green-600 hover:bg-green-700 disabled:opacity-50"
                    size="lg"
                >
                    {isLoading ? (
                        <Loader2 className="w-8 h-8 animate-spin" />
                    ) : (
                        <>
                            <LogIn className="w-8 h-8 ml-3" />
                            כניסה
                        </>
                    )}
                </Button>

                <Button 
                    onClick={handleClockOut}
                    disabled={isLoading || currentStatus !== 'in'}
                    className="h-32 text-2xl font-bold bg-red-600 hover:bg-red-700 disabled:opacity-50"
                    size="lg"
                >
                    {isLoading ? (
                        <Loader2 className="w-8 h-8 animate-spin" />
                    ) : (
                        <>
                            <LogOut className="w-8 h-8 ml-3" />
                            יציאה
                        </>
                    )}
                </Button>
            </div>

            {message && (
                <div className="bg-green-100 text-green-800 p-4 rounded-lg text-center font-medium">
                    {message}
                </div>
            )}
            {error && (
                <div className="bg-red-100 text-red-800 p-4 rounded-lg text-center font-medium">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-2 gap-4">
                <Card className="glass-card border-0">
                    <CardContent className="p-4 flex items-center gap-3">
                        <MapPin className="w-5 h-5 text-blue-600" />
                        <div>
                            <div className="text-xs text-gray-600">מיקום</div>
                            <div className="font-semibold">
                                {location ? 'זוהה ✓' : 'לא זמין'}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="glass-card border-0">
                    <CardContent className="p-4 flex items-center gap-3">
                        <Wifi className="w-5 h-5 text-green-600" />
                        <div>
                            <div className="text-xs text-gray-600">חיבור</div>
                            <div className="font-semibold">מחובר ✓</div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle>אירועי היום</CardTitle>
                </CardHeader>
                <CardContent>
                    {todayEvents.length === 0 ? (
                        <p className="text-center text-gray-500 py-8">אין אירועים להיום</p>
                    ) : (
                        <div className="space-y-2">
                            {todayEvents.map((event) => (
                                <div key={event.id} className="flex items-center justify-between p-3 bg-white/50 rounded-lg">
                                    <div className="flex items-center gap-3">
                                        {event.event_type === 'in' ? (
                                            <LogIn className="w-5 h-5 text-green-600" />
                                        ) : (
                                            <LogOut className="w-5 h-5 text-red-600" />
                                        )}
                                        <div>
                                            <div className="font-semibold">{getEventTypeLabel(event.event_type)}</div>
                                            <div className="text-sm text-gray-600">
                                                {formatEventTime(event.event_time)}
                                            </div>
                                        </div>
                                    </div>
                                    <Badge variant="outline">{event.source}</Badge>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}