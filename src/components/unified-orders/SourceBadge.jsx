import React from "react";
import { Badge } from "@/components/ui/badge";

const SOURCE_CONFIG = {
  woocommerce: { label: "אתר", icon: "●", className: "bg-purple-50 text-[#7D0F82] border border-purple-100" },
  mirakl: { label: "Super‑Pharm", icon: "●", className: "bg-blue-50 text-blue-700 border border-blue-100" },
  linet: { label: "ידני", icon: "●", className: "bg-slate-50 text-slate-700 border border-slate-200" },
};

export function getSourceConfig(source) {
  return SOURCE_CONFIG[source] || { label: source, icon: "●", className: "bg-gray-50 text-gray-600 border border-gray-200" };
}

export default function SourceBadge({ source }) {
  const cfg = getSourceConfig(source);
  return (
    <Badge className={`${cfg.className} font-semibold text-xs rounded-full px-2.5 py-1 shadow-none`}>
      <span className="ml-1 text-[10px]">{cfg.icon}</span>
      {cfg.label}
    </Badge>
  );
}