import React from "react";
import { Badge } from "@/components/ui/badge";

export default function InvoiceSourceInfo({ intake }) {
  if (!intake) return null;

  const sourceLabel = intake.source === "GMAIL" ? "Gmail" : intake.source || "לא ידוע";

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 space-y-1">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold text-slate-800">מקור המסמך</span>
        <Badge variant="outline" className="bg-white">{sourceLabel}</Badge>
      </div>
      {intake.file_name && <div><span className="font-medium">קובץ:</span> {intake.file_name}</div>}
      {intake.gmail_from && <div><span className="font-medium">מאת:</span> {intake.gmail_from}</div>}
      {intake.gmail_subject && <div><span className="font-medium">נושא:</span> {intake.gmail_subject}</div>}
      {intake.gmail_date && <div><span className="font-medium">תאריך מייל:</span> {new Date(intake.gmail_date).toLocaleString("he-IL")}</div>}
    </div>
  );
}