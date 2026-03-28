import React from "react";
import { Badge } from "@/components/ui/badge";

const SOURCE_CONFIG = {
  woocommerce: { label: "אתר", color: "#2196F3", bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-300" },
  mirakl: { label: "סופר פארם", color: "#4CAF50", bg: "bg-green-100", text: "text-green-800", border: "border-green-300" },
  linet: { label: "לינט", color: "#FF9800", bg: "bg-orange-100", text: "text-orange-800", border: "border-orange-300" },
};

export function getSourceConfig(source) {
  return SOURCE_CONFIG[source] || { label: source, color: "#9E9E9E", bg: "bg-gray-100", text: "text-gray-800", border: "border-gray-300" };
}

export default function SourceBadge({ source }) {
  const cfg = getSourceConfig(source);
  return (
    <Badge className={`${cfg.bg} ${cfg.text} ${cfg.border} border font-bold text-xs`}>
      <span className="w-2 h-2 rounded-full mr-1.5 inline-block" style={{ backgroundColor: cfg.color }} />
      {cfg.label}
    </Badge>
  );
}