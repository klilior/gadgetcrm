import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, ScanLine, Check, X, RefreshCw } from "lucide-react";
import { serialFulfillment } from "@/functions/serialFulfillment";
import { toast } from "sonner";

/**
 * Pick / scan serials for a line that requires them (Step 7).
 * - Lists available serials from Linet
 * - Manual scan/type with verification
 * - Enforces quantity match and no duplicates
 */
export default function SerialPicker({ linetItemId, requiredCount, value = [], onChange }) {
  const [available, setAvailable] = useState([]);
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState("");
  const [verifying, setVerifying] = useState(false);

  const loadAvailable = async () => {
    if (!linetItemId) return;
    setLoading(true);
    try {
      const { data } = await serialFulfillment({ action: "getAvailableSerials", params: { linet_item_id: linetItemId } });
      if (data?.success) setAvailable(data.serials || []);
    } catch (e) {
      toast.error("שגיאה בטעינת סריאליים: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAvailable(); }, [linetItemId]);

  const toggle = (idcode) => {
    const code = String(idcode);
    if (value.includes(code)) {
      onChange(value.filter((v) => v !== code));
    } else {
      if (value.length >= requiredCount) {
        toast.error(`נדרשים ${requiredCount} סריאליים בלבד`);
        return;
      }
      onChange([...value, code]);
    }
  };

  const addManual = async () => {
    const code = manual.trim();
    if (!code) return;
    if (value.includes(code)) { toast.error("הסריאלי כבר נבחר"); return; }
    if (value.length >= requiredCount) { toast.error(`נדרשים ${requiredCount} סריאליים בלבד`); return; }
    setVerifying(true);
    try {
      const { data } = await serialFulfillment({ action: "verifySerial", params: { linet_item_id: linetItemId, serial: code } });
      if (data?.success && data.valid) {
        onChange([...value, code]);
        setManual("");
        toast.success("סריאלי אומת מול לינט");
      } else {
        toast.error("הסריאלי לא נמצא כזמין במלאי עבור פריט זה");
      }
    } catch (e) {
      toast.error("שגיאה באימות: " + e.message);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-600">
          נבחרו {value.length} מתוך {requiredCount}
        </span>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={loadAvailable} disabled={loading}>
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          <span className="mr-1">רענן</span>
        </Button>
      </div>

      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((s) => (
            <Badge key={s} className="bg-[#7D0F82] text-white gap-1 font-mono text-[11px]">
              {s}
              <button onClick={() => onChange(value.filter((v) => v !== s))}><X className="w-3 h-3" /></button>
            </Badge>
          ))}
        </div>
      )}

      {/* Manual scan/type */}
      <div className="flex gap-2">
        <Input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addManual()}
          placeholder="סרוק או הקלד מספר סידורי..."
          className="h-9 text-sm font-mono"
        />
        <Button onClick={addManual} disabled={verifying} variant="outline" className="h-9">
          {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
          <span className="mr-1">אמת</span>
        </Button>
      </div>

      {/* Available list */}
      <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto divide-y">
        {available.length === 0 && !loading && (
          <p className="text-xs text-gray-400 p-3 text-center">אין סריאליים זמינים במלאי לפריט זה</p>
        )}
        {available.map((s) => {
          const code = String(s.idcode);
          const selected = value.includes(code);
          return (
            <button
              key={code}
              onClick={() => toggle(code)}
              className={`w-full text-right p-2 text-sm flex items-center justify-between gap-2 hover:bg-purple-50 ${selected ? "bg-purple-50" : ""}`}
            >
              <div>
                <span className="font-mono text-gray-800">{code}</span>
                {s.created && <span className="text-[11px] text-gray-400 mr-2">נקלט: {String(s.created).split(" ")[0]}</span>}
              </div>
              {selected && <Check className="w-4 h-4 text-[#7D0F82]" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}