import React, { useState } from "react";
import { useUser } from "./UserAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogIn, Loader2, X, AlertTriangle } from 'lucide-react';

export default function AddUserModal({ isOpen, onClose }) {
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const { login } = useUser();

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
            onClose();
        }
        setIsLoggingIn(false);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <Card className="glass-card border-0 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <CardTitle className="text-xl font-bold text-gray-800">
                            הוסף נציג למשמרת
                        </CardTitle>
                        <Button variant="ghost" size="icon" onClick={onClose}>
                            <X className="w-5 h-5" />
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="identifier">שם משתמש או אימייל</Label>
                            <Input 
                                id="identifier"
                                value={identifier}
                                onChange={(e) => setIdentifier(e.target.value)}
                                placeholder="לדוגמא: itay_a"
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
                        
                        <div className="bg-amber-50 p-3 rounded-lg border border-amber-200">
                            <div className="flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-amber-800">
                                    מנהלים לא יכולים להתווסף למשמרת. הם נכנסים ישירות למערכת.
                                </p>
                            </div>
                        </div>
                        
                        <Button type="submit" className="w-full glass-button bg-blue-600/20 hover:bg-blue-600/30 font-bold" disabled={isLoggingIn}>
                            {isLoggingIn ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    מתחבר...
                                </>
                            ) : (
                                <>
                                    <LogIn className="w-4 h-4 mr-2" />
                                    הוסף למשמרת
                                </>
                            )}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}