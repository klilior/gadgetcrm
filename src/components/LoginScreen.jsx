import React, { useState } from "react";
import { useUser } from "./UserAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogIn, Loader2, Users, UserPlus, X, Shield } from 'lucide-react';
import { Badge } from "@/components/ui/badge";

export default function LoginScreen() {
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const { login, activeUsers, switchUser, removeUserFromShift } = useUser();

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoggingIn(true);
        const result = await login(identifier, password);
        if (!result.success) {
            setError(result.error);
        } else {
            setIdentifier('');
            setPassword('');
        }
        setIsLoggingIn(false);
    };

    const handleQuickSwitch = (userId) => {
        switchUser(userId);
    };
    
    return (
        <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 p-4">
            <div className="w-full max-w-4xl space-y-6">
                
                {/* Active Users in Shift */}
                {activeUsers.length > 0 && (
                    <Card className="glass-card border-0">
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle className="flex items-center gap-2 text-xl">
                                    <Users className="w-6 h-6 text-purple-600" />
                                    משתמשים פעילים במשמרת
                                </CardTitle>
                                <Badge variant="outline" className="bg-purple-100 text-purple-800 border-purple-300">
                                    {activeUsers.length}/5
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {activeUsers.map(user => (
                                    <Card 
                                        key={user.id} 
                                        className="glass-button hover:shadow-lg transition-all cursor-pointer relative group"
                                        onClick={() => handleQuickSwitch(user.id)}
                                    >
                                        <CardContent className="p-4">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="absolute top-2 left-2 w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    removeUserFromShift(user.id);
                                                }}
                                            >
                                                <X className="w-4 h-4 text-red-500" />
                                            </Button>
                                            
                                            <div className="flex flex-col items-center text-center space-y-2">
                                                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white text-2xl font-bold">
                                                    {user.employee_name?.charAt(0) || 'U'}
                                                </div>
                                                <div>
                                                    <p className="font-bold text-gray-900">{user.employee_name}</p>
                                                    <p className="text-xs text-gray-600">{user.role}</p>
                                                </div>
                                                <Badge variant="outline" className="text-xs">
                                                    לחץ להחלפה
                                                </Badge>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Login Form */}
                <Card className="glass-card border-0">
                    <CardHeader className="text-center">
                        <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/3afc33c40_23.jpg" alt="Logo" className="w-48 mx-auto mb-4"/>
                        <CardTitle className="text-2xl font-bold text-gray-800 flex items-center justify-center gap-2">
                            {activeUsers.length > 0 ? (
                                <>
                                    <UserPlus className="w-6 h-6 text-purple-600" />
                                    הוסף נציג למשמרת
                                </>
                            ) : (
                                'כניסה למערכת'
                            )}
                        </CardTitle>
                        {activeUsers.length > 0 && (
                            <p className="text-sm text-gray-600 mt-2">
                                הזן פרטי התחברות להוספת נציג נוסף למשמרת
                            </p>
                        )}
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleLogin} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="identifier">שם משתמש או אימייל</Label>
                                <Input 
                                    id="identifier"
                                    value={identifier}
                                    onChange={(e) => setIdentifier(e.target.value)}
                                    placeholder="לדוגמא: itay_a או itay@example.com"
                                    required
                                    className="glass-button"
                                    autoFocus
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="password">סיסמה</Label>
                                <Input 
                                    id="password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    className="glass-button"
                                />
                            </div>
                            {error && <p className="text-sm text-red-600 bg-red-100 p-3 rounded-lg text-center">{error}</p>}
                            <Button type="submit" className="w-full glass-button bg-blue-600/20 hover:bg-blue-600/30 font-bold" disabled={isLoggingIn}>
                                {isLoggingIn ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        מתחבר...
                                    </>
                                ) : (
                                    <>
                                        <LogIn className="w-4 h-4 mr-2" />
                                        {activeUsers.length > 0 ? 'הוסף למשמרת' : 'התחבר'}
                                    </>
                                )}
                            </Button>
                        </form>
                        
                        <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
                            <div className="flex items-start gap-2">
                                <Shield className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                                <div className="text-xs text-amber-800">
                                    <p className="font-semibold mb-1">הערה למנהלים:</p>
                                    <p>מנהלים נכנסים ישירות למערכת ולא במסגרת משמרת. הכניסה שלכם לא משפיעה על מערכת המשמרות.</p>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Quick Tips */}
                {activeUsers.length === 0 && (
                    <div className="text-center text-sm text-gray-600 space-y-2">
                        <p>💡 ניתן להתחבר עד 5 נציגים במשמרת אחת</p>
                        <p>🔄 החלפה מהירה בין נציגים בלחיצה אחת</p>
                        <p>👨‍💼 מנהלים נכנסים ללא משמרת</p>
                    </div>
                )}
            </div>
        </div>
    );
}