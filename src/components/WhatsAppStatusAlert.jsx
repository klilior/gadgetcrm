import React, { useState, useEffect } from "react";
import { Settings } from "@/entities/all";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Settings as SettingsIcon, CheckCircle } from "lucide-react";

export default function WhatsAppStatusAlert() {
    const [currentNumber, setCurrentNumber] = useState("");
    const [newNumber, setNewNumber] = useState("");
    const [isEditing, setIsEditing] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        loadCurrentNumber();
    }, []);

    const loadCurrentNumber = async () => {
        try {
            const settings = await Settings.filter({ setting_name: 'WHATSAPP_PUBLIC_NUMBER' });
            if (settings.length > 0) {
                setCurrentNumber(settings[0].setting_value);
                setNewNumber(settings[0].setting_value);
            }
        } catch (error) {
            console.error("Error loading WhatsApp number:", error);
        }
    };

    const updateNumber = async () => {
        setIsLoading(true);
        try {
            const existingSettings = await Settings.filter({ setting_name: 'WHATSAPP_PUBLIC_NUMBER' });
            
            if (existingSettings.length > 0) {
                await Settings.update(existingSettings[0].id, { setting_value: newNumber });
            } else {
                await Settings.create({
                    setting_name: 'WHATSAPP_PUBLIC_NUMBER',
                    setting_value: newNumber,
                    notes: 'מספר הוואטסאפ הציבורי לשליחת הודעות אוטומטיות'
                });
            }
            
            setCurrentNumber(newNumber);
            setIsEditing(false);
            
            // הצג הודעת הצלחה
            alert(`מספר הוואטסאפ עודכן ל-${newNumber}. חשוב לוודא שהמספר פעיל בbot.it!`);
        } catch (error) {
            console.error("Error updating WhatsApp number:", error);
            alert("שגיאה בעדכון המספר. נסה שוב.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Alert className="mb-4 bg-yellow-50 border-yellow-200">
            <AlertTriangle className="w-4 h-4 text-yellow-600" />
            <AlertDescription>
                <div className="space-y-3">
                    <p className="font-medium text-yellow-800">
                        הגדרת מספר וואטסאפ לשליחת הודעות אוטומטיות
                    </p>
                    
                    {isEditing ? (
                        <div className="flex flex-col sm:flex-row gap-3">
                            <Input
                                value={newNumber}
                                onChange={(e) => setNewNumber(e.target.value)}
                                placeholder="972XXXXXXXXX"
                                className="flex-1"
                                dir="ltr"
                            />
                            <div className="flex gap-2">
                                <Button 
                                    onClick={updateNumber} 
                                    disabled={isLoading || !newNumber}
                                    size="sm"
                                    className="bg-green-600 hover:bg-green-700"
                                >
                                    {isLoading ? "שומר..." : "שמור"}
                                </Button>
                                <Button 
                                    onClick={() => {setIsEditing(false); setNewNumber(currentNumber);}} 
                                    variant="outline" 
                                    size="sm"
                                >
                                    ביטול
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                            <div>
                                <p className="text-sm text-yellow-700">
                                    מספר נוכחי: <span className="font-mono bg-yellow-100 px-2 py-1 rounded">{currentNumber || "לא הוגדר"}</span>
                                </p>
                                <p className="text-xs text-yellow-600 mt-1">
                                    ודא שהמספר פעיל ב-bot.it לפני שליחת הודעות
                                </p>
                            </div>
                            <Button 
                                onClick={() => setIsEditing(true)} 
                                variant="outline" 
                                size="sm"
                                className="border-yellow-300 hover:bg-yellow-100"
                            >
                                <SettingsIcon className="w-4 h-4 mr-2" />
                                עדכן מספר
                            </Button>
                        </div>
                    )}
                </div>
            </AlertDescription>
        </Alert>
    );
}