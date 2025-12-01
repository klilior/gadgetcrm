import React, { useState, useEffect } from 'react';
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, User, Tag, X, Filter } from "lucide-react";

export default function TicketFilters({ employees, onFilterChange, initialFilters = {} }) {
    const [searchTerm, setSearchTerm] = useState(initialFilters.searchTerm || "");
    const [assigneeId, setAssigneeId] = useState(initialFilters.assigneeId || "all");
    const [category, setCategory] = useState(initialFilters.category || "all");
    const [channel, setChannel] = useState(initialFilters.channel || "all");
    const [status, setStatus] = useState(initialFilters.status || "all");
    const [tags, setTags] = useState(initialFilters.tags || []);

    useEffect(() => {
        const handler = setTimeout(() => {
            onFilterChange({ searchTerm, assigneeId, category, channel, status, tags });
        }, 300); // Debounce search input

        return () => {
            clearTimeout(handler);
        };
    }, [searchTerm, assigneeId, category, channel, status, tags, onFilterChange]);

    return (
        <div className="p-3 sm:p-4 mb-4 glass-card border-0 rounded-2xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
                {/* Search Input */}
                <div className="relative col-span-1 sm:col-span-2 lg:col-span-1">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <Input
                        placeholder="חיפוש לפי מספר, נושא או לקוח..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="glass-button pr-10 text-sm"
                    />
                </div>

                {/* Assignee Filter */}
                <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <Select value={assigneeId} onValueChange={setAssigneeId}>
                        <SelectTrigger className="glass-button text-sm">
                            <SelectValue placeholder="סנן לפי נציג" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">כל הנציגים</SelectItem>
                            {employees && employees.map(emp => emp && (
                                <SelectItem key={emp.id} value={emp.id}>{emp.employee_name || 'נציג'}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Category Filter */}
                <div className="flex items-center gap-2">
                    <Tag className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <Select value={category} onValueChange={setCategory}>
                        <SelectTrigger className="glass-button text-sm">
                            <SelectValue placeholder="סנן לפי נושא" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">כל הנושאים</SelectItem>
                            <SelectItem value="שירות">שירות</SelectItem>
                            <SelectItem value="מכירות">מכירות</SelectItem>
                            <SelectItem value="תיקון">תיקון</SelectItem>
                            <SelectItem value="תמיכה">תמיכה</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Channel Filter */}
                <div className="flex items-center gap-2">
                    <Select value={channel} onValueChange={setChannel}>
                        <SelectTrigger className="glass-button text-sm">
                            <SelectValue placeholder="ערוץ" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">כל הערוצים</SelectItem>
                            <SelectItem value="whatsapp">וואטסאפ</SelectItem>
                            <SelectItem value="email">מייל</SelectItem>
                            <SelectItem value="phone">טלפון</SelectItem>
                            <SelectItem value="website">אתר</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Status Filter */}
                <div className="flex items-center gap-2">
                    <Select value={status} onValueChange={setStatus}>
                        <SelectTrigger className="glass-button text-sm">
                            <SelectValue placeholder="סטטוס" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">כל הסטטוסים</SelectItem>
                            <SelectItem value="חדש">חדש</SelectItem>
                            <SelectItem value="בטיפול">בטיפול</SelectItem>
                            <SelectItem value="ממתין ללקוח">ממתין ללקוח</SelectItem>
                            <SelectItem value="נסגר">נסגר</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Tag Filter */}
                <div className="flex items-center gap-2">
                    <Tag className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <Select 
                        value="add_tag" 
                        onValueChange={(value) => {
                            if (!tags.includes(value)) {
                                setTags([...tags, value]);
                            }
                        }}
                    >
                        <SelectTrigger className="glass-button text-sm w-32">
                            <SelectValue placeholder="תגיות" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="חידוש חוזה">חידוש חוזה</SelectItem>
                            <SelectItem value="בעיה טכנית">בעיה טכנית</SelectItem>
                            <SelectItem value="משלוח">משלוח</SelectItem>
                            <SelectItem value="כספים">כספים</SelectItem>
                            <SelectItem value="דחוף">דחוף</SelectItem>
                            <SelectItem value="הצעת מחיר">הצעת מחיר</SelectItem>
                            <SelectItem value="פידבק חיובי">פידבק חיובי</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Selected Tags */}
            {tags.length > 0 && (
                <div className="flex flex-wrap gap-2 items-center mt-3 pt-3 border-t border-gray-100">
                    <span className="text-xs text-gray-500 ml-2">תגיות נבחרות:</span>
                    {tags.map(tag => (
                        <Badge key={tag} variant="secondary" className="flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 border-indigo-200">
                            {tag}
                            <X 
                                className="w-3 h-3 cursor-pointer hover:text-red-500" 
                                onClick={() => setTags(tags.filter(t => t !== tag))}
                            />
                        </Badge>
                    ))}
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-6 text-xs text-gray-500 hover:text-red-600"
                        onClick={() => setTags([])}
                    >
                        נקה הכל
                    </Button>
                </div>
            )}
        </div>
    );
}