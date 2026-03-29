import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, RotateCcw, Eye, EyeOff } from "lucide-react";

export default function OrderFilters({
  searchTerm, setSearchTerm,
  sourceFilter, setSourceFilter,
  statusFilter, setStatusFilter,
  showClosed, setShowClosed,
  onReset
}) {
  return (
    <div className="flex flex-wrap gap-3 items-end">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          placeholder="חיפוש: שם לקוח, מספר הזמנה, טלפון, מוצר..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pr-10 text-sm h-10 rounded-full border-gray-200 focus:border-purple-400 focus:ring-purple-300 bg-white/80 backdrop-blur-sm"
        />
      </div>

      <Select value={sourceFilter} onValueChange={setSourceFilter}>
        <SelectTrigger className="w-[150px] h-10 text-sm rounded-full border-gray-200 bg-white/80 backdrop-blur-sm">
          <SelectValue placeholder="כל המקורות" />
        </SelectTrigger>
        <SelectContent className="rounded-xl">
          <SelectItem value="all">🌐 כל המקורות</SelectItem>
          <SelectItem value="woocommerce">🟣 אתר</SelectItem>
          <SelectItem value="mirakl">💊 סופר פארם</SelectItem>
          <SelectItem value="linet">📋 לינט</SelectItem>
        </SelectContent>
      </Select>

      <Select value={statusFilter || 'all'} onValueChange={(val) => setStatusFilter?.(val)}>
        <SelectTrigger className="w-[180px] h-10 text-sm rounded-full border-gray-200 bg-white/80 backdrop-blur-sm">
          <SelectValue placeholder="כל הסטטוסים" />
        </SelectTrigger>
        <SelectContent className="rounded-xl">
          <SelectItem value="all">📋 כל הסטטוסים</SelectItem>
          <SelectItem value="pending">⏳ ממתינות לטיפול</SelectItem>
        </SelectContent>
      </Select>

      <Button
        variant={showClosed ? "default" : "outline"}
        size="sm"
        className={`h-10 text-xs rounded-full px-4 transition-all ${showClosed ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-200' : 'border-gray-200 hover:border-purple-300 hover:bg-purple-50'}`}
        onClick={() => setShowClosed(!showClosed)}
      >
        {showClosed ? <Eye className="w-3.5 h-3.5 ml-1" /> : <EyeOff className="w-3.5 h-3.5 ml-1" />}
        {showClosed ? "כולל סגורות" : "ללא סגורות"}
      </Button>

      <Button variant="ghost" size="sm" className="h-10 rounded-full px-4 text-gray-500 hover:text-purple-700 hover:bg-purple-50" onClick={onReset}>
        <RotateCcw className="w-3.5 h-3.5 ml-1" />
        איפוס
      </Button>
    </div>
  );
}