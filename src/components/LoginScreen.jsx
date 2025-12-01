import React, { useState } from "react";
import { useUser } from "./UserAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
        <div dir="rtl" className="min-h-screen w-full flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #2d5a87 50%, #3d7ab5 100%)' }}>
            <div className="w-full max-w-md space-y-6">
                
                {/* Active Users in Shift */}
                {activeUsers.length > 0 && (
                    <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-6 border border-white/20 shadow-2xl">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="flex items-center gap-2 text-lg font-bold text-white">
                                <Users className="w-5 h-5 text-cyan-300" />
                                נציגים במשמרת
                            </h3>
                            <Badge className="bg-cyan-500/30 text-cyan-100 border-cyan-400/50 rounded-full px-3">
                                {activeUsers.length}/5
                            </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            {activeUsers.map(user => (
                                <div 
                                    key={user.id} 
                                    className="bg-white/10 hover:bg-white/20 rounded-2xl p-3 cursor-pointer transition-all duration-300 relative group border border-white/10"
                                    onClick={() => handleQuickSwitch(user.id)}
                                >
                                    <button
                                        className="absolute top-2 left-2 w-6 h-6 rounded-full bg-red-500/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            removeUserFromShift(user.id);
                                        }}
                                    >
                                        <X className="w-3 h-3 text-white" />
                                    </button>
                                    
                                    <div className="flex flex-col items-center text-center space-y-2">
                                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white text-lg font-bold shadow-lg">
                                            {user.employee_name?.charAt(0) || 'U'}
                                        </div>
                                        <div>
                                            <p className="font-semibold text-white text-sm">{user.employee_name}</p>
                                            <p className="text-xs text-cyan-200">{user.role}</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Login Form */}
                <div className="bg-white/95 backdrop-blur-lg rounded-3xl p-8 shadow-2xl border border-white/50">
                    <div className="text-center mb-6">
                        <img 
                            src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/3afc33c40_23.jpg" 
                            alt="Logo" 
                            className="w-40 mx-auto mb-4"
                        />
                        <h1 className="text-2xl font-bold text-gray-800 flex items-center justify-center gap-2">
                            {activeUsers.length > 0 ? (
                                <>
                                    <UserPlus className="w-6 h-6 text-blue-600" />
                                    הוסף נציג למשמרת
                                </>
                            ) : (
                                'כניסה למערכת'
                            )}
                        </h1>
                        {activeUsers.length > 0 && (
                            <p className="text-sm text-gray-500 mt-2">
                                הזן פרטי התחברות להוספת נציג נוסף
                            </p>
                        )}
                    </div>

                    <form onSubmit={handleLogin} className="space-y-5">
                        <div className="space-y-2">
                            <Label htmlFor="identifier" className="text-gray-700 font-medium">שם משתמש או אימייל</Label>
                            <Input 
                                id="identifier"
                                value={identifier}
                                onChange={(e) => setIdentifier(e.target.value)}
                                placeholder="לדוגמא: itay_a"
                                required
                                className="h-12 rounded-full border-gray-200 bg-gray-50 focus:bg-white focus:border-blue-400 transition-all px-5"
                                autoFocus
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password" className="text-gray-700 font-medium">סיסמה</Label>
                            <Input 
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="h-12 rounded-full border-gray-200 bg-gray-50 focus:bg-white focus:border-blue-400 transition-all px-5"
                            />
                        </div>
                        
                        {error && (
                            <div className="text-sm text-red-600 bg-red-50 p-3 rounded-2xl text-center border border-red-200">
                                {error}
                            </div>
                        )}
                        
                        <Button 
                            type="submit" 
                            className="w-full h-12 rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-bold text-lg shadow-lg hover:shadow-xl transition-all duration-300" 
                            disabled={isLoggingIn}
                        >
                            {isLoggingIn ? (
                                <>
                                    <Loader2 className="w-5 h-5 ml-2 animate-spin" />
                                    מתחבר...
                                </>
                            ) : (
                                <>
                                    <LogIn className="w-5 h-5 ml-2" />
                                    {activeUsers.length > 0 ? 'הוסף למשמרת' : 'התחבר'}
                                </>
                            )}
                        </Button>
                    </form>
                    
                    <div className="mt-5 p-3 bg-amber-50 rounded-2xl border border-amber-200">
                        <div className="flex items-start gap-2">
                            <Shield className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                            <div className="text-xs text-amber-700">
                                <p className="font-semibold mb-1">הערה למנהלים:</p>
                                <p>מנהלים נכנסים ישירות למערכת ולא במסגרת משמרת.</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Quick Tips */}
                {activeUsers.length === 0 && (
                    <div className="text-center text-sm text-white/80 space-y-1">
                        <p>💡 ניתן להתחבר עד 5 נציגים במשמרת אחת</p>
                        <p>🔄 החלפה מהירה בין נציגים בלחיצה אחת</p>
                    </div>
                )}
            </div>
        </div>
    );
}