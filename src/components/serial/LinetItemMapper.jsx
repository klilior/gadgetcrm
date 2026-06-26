import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Check, Loader2 } from "lucide-react";
import { serialFulfillment } from "@/functions/serialFulfillment";
import { toast } from "sonner";

/**
 * Map a source product line to the correct Linet item (Step 6).
 * Search by SKU or name, pick the right item, save the mapping on the order line.
 */
export default function LinetItemMapper({ currentMappedId, onMapped }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    if (!term.trim()) return;
    setLoading(true);
    try {
      const { data } = await serialFulfillment({ action: "searchLinetItems", params: { term: term.trim() } });
      if (data?.success) setResults(data.items || []);
      else toast.error(data?.error || "חיפוש נכשל");
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder={'חיפוש פריט לינט לפי מק"ט או שם...'}
          className="h-9 text-sm"
        />
        <Button onClick={search} disabled={loading} variant="outline" className="h-9">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        </Button>
      </div>

      {results.length > 0 && (
        <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y">
          {results.map((item) => {
            const isMapped = String(currentMappedId) === String(item.id);
            const isSerial = item.stockType === "2";
            return (
              <button
                key={item.id}
                onClick={() => onMapped(item)}
                className={`w-full text-right p-2 text-sm hover:bg-purple-50 flex items-start justify-between gap-2 ${isMapped ? "bg-purple-50" : ""}`}
              >
                <div className="min-w-0">
                  <div className="font-medium text-gray-800 truncate">{item.name}</div>
                  <div className="text-[11px] text-gray-400 font-mono">
                    מק"ט לינט: {item.sku} · {item.category}
                    {isSerial && <span className="text-[#7D0F82] font-semibold"> · מלאי סידרתי</span>}
                  </div>
                </div>
                {isMapped && <Check className="w-4 h-4 text-[#7D0F82] flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}