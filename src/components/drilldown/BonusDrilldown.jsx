import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Target, Calendar } from "lucide-react";
import { format } from "date-fns";

/**
 * BonusDrilldown - פירוט בונוסים (BonusEntry)
 */
export default function BonusDrilldown({ 
    isOpen, 
    onClose, 
    agentName,
    bonuses = [],
    bonusType = null // 'TARGET' | 'SHIFT' | null (all)
}) {
    const filteredBonuses = bonusType 
        ? bonuses.filter(b => b.bonus_type === bonusType)
        : bonuses;

    const totalAmount = filteredBonuses.reduce((sum, b) => sum + (b.bonus_amount || 0), 0);

    const typeLabel = bonusType === 'TARGET' ? 'בונוס יעדים' : bonusType === 'SHIFT' ? 'בונוס משמרות' : 'כל הבונוסים';

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader className="border-b pb-4">
                    <div className="flex justify-between items-start">
                        <div>
                            <DialogTitle className="text-xl">פירוט {typeLabel} - {agentName}</DialogTitle>
                            <div className="text-sm text-gray-600 mt-2">
                                סה"כ: <strong>₪{totalAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
                            </div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={onClose}>
                            <X className="w-4 h-4" />
                        </Button>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto">
                    {filteredBonuses.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <p>לא נמצאו בונוסים</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredBonuses.map((bonus, idx) => (
                                <div 
                                    key={idx}
                                    className={`p-4 rounded-lg border ${
                                        bonus.bonus_type === 'TARGET' 
                                            ? 'bg-amber-50 border-amber-200' 
                                            : 'bg-blue-50 border-blue-200'
                                    }`}
                                >
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="flex items-center gap-2">
                                            {bonus.bonus_type === 'TARGET' ? (
                                                <Target className="w-5 h-5 text-amber-600" />
                                            ) : (
                                                <Calendar className="w-5 h-5 text-blue-600" />
                                            )}
                                            <div>
                                                <p className="font-bold text-lg">
                                                    {bonus.bonus_type === 'TARGET' ? 'בונוס יעד' : 'בונוס משמרות'}
                                                </p>
                                                {bonus.goal_name && (
                                                    <p className="text-sm text-gray-700 font-medium">{bonus.goal_name}</p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-2xl font-bold text-purple-600">
                                                ₪{(bonus.bonus_amount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 text-sm">
                                        <div>
                                            <span className="text-gray-600">תקופה:</span>
                                            <p className="font-medium">
                                                {bonus.period_start ? format(new Date(bonus.period_start), 'dd/MM/yyyy') : '-'} 
                                                {' - '}
                                                {bonus.period_end ? format(new Date(bonus.period_end), 'dd/MM/yyyy') : '-'}
                                            </p>
                                        </div>
                                        
                                        {bonus.meta_json && (
                                            <>
                                                {bonus.meta_json.current_value && (
                                                    <div>
                                                        <span className="text-gray-600">ערך נוכחי:</span>
                                                        <p className="font-medium">{bonus.meta_json.current_value}</p>
                                                    </div>
                                                )}
                                                {bonus.meta_json.target_value && (
                                                    <div>
                                                        <span className="text-gray-600">יעד:</span>
                                                        <p className="font-medium">{bonus.meta_json.target_value}</p>
                                                    </div>
                                                )}
                                                {bonus.meta_json.progress_percent !== undefined && (
                                                    <div>
                                                        <span className="text-gray-600">התקדמות:</span>
                                                        <p className="font-medium">{bonus.meta_json.progress_percent.toFixed(0)}%</p>
                                                    </div>
                                                )}
                                                {bonus.meta_json.shifts_count && (
                                                    <div>
                                                        <span className="text-gray-600">משמרות:</span>
                                                        <p className="font-medium">
                                                            {bonus.meta_json.shifts_count} × ₪{bonus.meta_json.bonus_per_shift || 0}
                                                        </p>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}