import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, RotateCcw, Eye, EyeOff, RefreshCw, ShieldAlert, CheckCircle2 } from "lucide-react";

export default function OrderFilters({
  searchTerm, setSearchTerm,
  sourceFilter, setSourceFilter,
  statusFilter, setStatusFilter,
  showBlocked, setShowBlocked,
  readyOnly, setReadyOnly,
  onReset,
  onRefresh,
  isRefreshing
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="חיפוש לפי מספר הזמנה, לקוח, טלפון, מוצר או מעקב"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pr-10 text-sm h-11 rounded-xl border-gray-200 focus:border-[#7D0F82] focus:ring-[#7D0F82]/20 bg-white"
          />
        </div>

        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-full lg:w-[160px] h-11 text-sm rounded-xl border-gray-200 bg-white">
            <SelectValue placeholder="מקור" />
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            <SelectItem value="all">הכל</SelectItem>
            <SelectItem value="woocommerce">אתר</SelectItem>
            <SelectItem value="mirakl">Super‑Pharm</SelectItem>
            <SelectItem value="linet">ידני</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter || 'all'} onValueChange={(val) => setStatusFilter?.(val)}>
          <SelectTrigger className="w-full lg:w-[170px] h-11 text-sm rounded-xl border-gray-200 bg-white">
            <SelectValue placeholder="סטטוס" />
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            <SelectItem value="all">כל ההזמנות (כולל שטופלו)</SelectItem>
            <SelectItem value="pending">ממתינות לטיפול</SelectItem>
            <SelectItem value="serial">חסר סריאלי</SelectItem>
            <SelectItem value="ready">מוכנות למשלוח</SelectItem>
          </SelectContent>
        </Select>

        <Button onClick={onRefresh} disabled={isRefreshing} variant="outline" size="sm" className="h-11 rounded-xl px-4 border-gray-200 bg-white">
          <RefreshCw className={`w-3.5 h-3.5 ml-1 ${isRefreshing ? 'animate-spin' : ''}`} />
          רענון
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Button variant={showBlocked ? "default" : "outline"} size="sm" className={`h-9 rounded-xl px-3 text-xs ${showBlocked ? 'bg-red-600 hover:bg-red-700 text-white' : 'border-gray-200 bg-white text-gray-600'}`} onClick={() => setShowBlocked(!showBlocked)}>
          <ShieldAlert className="w-3.5 h-3.5 ml-1" />
          רק חסומות
        </Button>
        <Button variant={readyOnly ? "default" : "outline"} size="sm" className={`h-9 rounded-xl px-3 text-xs ${readyOnly ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'border-gray-200 bg-white text-gray-600'}`} onClick={() => setReadyOnly(!readyOnly)}>
          <CheckCircle2 className="w-3.5 h-3.5 ml-1" />
          מוכן לפעולה
        </Button>
        <Button variant={statusFilter === 'pending' ? "default" : "outline"} size="sm" className={`h-9 rounded-xl px-3 text-xs ${statusFilter === 'pending' ? 'bg-[#7D0F82] hover:bg-[#6a0c6f] text-white' : 'border-gray-200 bg-white text-gray-600'}`} onClick={() => setStatusFilter?.(statusFilter === 'pending' ? 'all' : 'pending')}>
          {statusFilter === 'pending' ? <EyeOff className="w-3.5 h-3.5 ml-1" /> : <Eye className="w-3.5 h-3.5 ml-1" />}
          {statusFilter === 'pending' ? "ממתינות לטיפול בלבד" : "הצג ממתינות לטיפול"}
        </Button>
        <Button variant="ghost" size="sm" className="h-9 rounded-xl px-3 text-xs text-gray-500 hover:text-[#7D0F82] hover:bg-purple-50" onClick={onReset}>
          <RotateCcw className="w-3.5 h-3.5 ml-1" />
          איפוס
        </Button>
      </div>
    </div>
  );
}