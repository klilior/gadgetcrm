import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tag, Tags } from "lucide-react";
import { serialFulfillment } from "@/functions/serialFulfillment";
import { toast } from "sonner";

/**
 * Small, non-intrusive "mark as serial / not serial" control for an order product line.
 * It does NOT block regular orders — it's a secondary action.
 */
export default function MarkSerialMenu({ sku, orderItemId, currentlySerial, onChanged }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(null); // 'mark' | 'unmark'
  const [busy, setBusy] = useState(false);

  const wantMark = !currentlySerial;

  const run = async (scope) => {
    setBusy(true);
    try {
      const action = wantMark ? "markSerial" : "unmarkSerial";
      const { data } = await serialFulfillment({ action, params: { sku, order_item_id: orderItemId, scope } });
      if (!data?.success) {
        toast.error(data?.error || "הפעולה נכשלה");
      } else {
        toast.success(scope === "always" ? "נשמר גם להזמנות הבאות" : "עודכן להזמנה זו בלבד");
        onChanged?.();
      }
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-[11px] text-gray-500 hover:text-[#7D0F82] hover:bg-purple-50"
        onClick={() => { setMode(wantMark ? "mark" : "unmark"); setOpen(true); }}
      >
        {wantMark ? <Tag className="w-3 h-3 ml-1" /> : <Tags className="w-3 h-3 ml-1" />}
        {wantMark ? "סמן כסריאלי" : "סמן כלא סריאלי"}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mode === "mark" ? "האם לסמן מוצר זה כמוצר סריאלי גם להזמנות הבאות?" : "האם לבטל דרישת סריאלי למוצר זה גם להזמנות הבאות?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {mode === "mark"
                ? "סימון קבוע ישפיע על כל ההזמנות הבאות עם מק\"ט זה (דורש הרשאת מנהל)."
                : "ביטול קבוע ישפיע על כל ההזמנות הבאות. אם הפריט מוגדר בלינט כמלאי סידרתי, יידרש אישור מנהל."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <Button disabled={busy} onClick={() => run("always")} className="bg-[#7D0F82] hover:bg-[#6a0c6f] text-white">
              {mode === "mark" ? "כן, סמן תמיד" : "כן, לא סריאלי"}
            </Button>
            <Button disabled={busy} variant="outline" onClick={() => run("order")}>
              רק להזמנה הזאת
            </Button>
            <AlertDialogCancel disabled={busy}>בטל</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}