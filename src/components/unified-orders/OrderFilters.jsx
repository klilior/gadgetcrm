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
          className="pr-10 text-sm h-9"
        />
      </div>

      <Select value={sourceFilter} onValueChange={setSourceFilter}>
        <SelectTrigger className="w-[140px] h-9 text-sm">
          <SelectValue placeholder="כל המקורות" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">כל המקורות</SelectItem>
          <SelectItem value="woocommerce">🔵 אתר</SelectItem>
          <SelectItem value="mirakl">🟢 סופר פארם</SelectItem>
          <SelectItem value="linet">🟠 לינט</SelectItem>
        </SelectContent>
      </Select>

      <Button
        variant={showClosed ? "default" : "outline"}
        size="sm"
        className="h-9 text-xs"
        onClick={() => setShowClosed(!showClosed)}
      >
        {showClosed ? <Eye className="w-3.5 h-3.5 ml-1" /> : <EyeOff className="w-3.5 h-3.5 ml-1" />}
        {showClosed ? "כולל סגורות" : "ללא סגורות"}
      </Button>

      <Button variant="ghost" size="sm" className="h-9" onClick={onReset}>
        <RotateCcw className="w-3.5 h-3.5 ml-1" />
        איפוס
      </Button>
    </div>
  );
}