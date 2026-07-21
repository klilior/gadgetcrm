import React from "react";
import LinkLinetItem from "@/components/serials/LinkLinetItem";
import SerialPicker from "@/components/serials/SerialPicker";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2 } from "lucide-react";

/**
 * PickingSerialInline — the serial-handling step embedded inside a picking list row.
 * Renders the right stage for the line: link to Linet → pick/scan serial → invoiced chip.
 */
export default function PickingSerialInline({ line, onUpdated }) {
  const isInvoiced = line.serial_status === "invoiced" || line.linet_invoice_id;
  const assigned = line.assigned_serials || [];

  if (isInvoiced) {
    return (
      <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2 mt-2">
        <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
        <span className="text-xs text-green-800 font-mono flex-1 min-w-0 truncate">{assigned.join(", ")}</span>
        <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px] flex-shrink-0">חשבונית הופקה ✓</Badge>
      </div>
    );
  }

  if (!line.mapped_linet_item_id) {
    return (
      <div className="mt-2">
        <LinkLinetItem line={line} onLinked={(updates) => onUpdated({ ...line, ...updates })} />
      </div>
    );
  }

  return (
    <div className="mt-2">
      <SerialPicker line={line} onUpdated={onUpdated} />
    </div>
  );
}