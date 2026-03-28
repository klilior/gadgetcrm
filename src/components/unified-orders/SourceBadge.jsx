import React from "react";
import { Badge } from "@/components/ui/badge";

const SOURCE_CONFIG = {
  woocommerce: { label: "אתר", emoji: "🟣", gradient: "bg-gradient-to-r from-purple-500 to-violet-600", text: "text-white", glow: "shadow-purple-200" },
  mirakl: { label: "סופר פארם", emoji: "💊", gradient: "bg-gradient-to-r from-blue-500 to-cyan-500", text: "text-white", glow: "shadow-blue-200" },
  linet: { label: "לינט", emoji: "📋", gradient: "bg-gradient-to-r from-amber-400 to-orange-500", text: "text-white", glow: "shadow-amber-200" },
};

export function getSourceConfig(source) {
  return SOURCE_CONFIG[source] || { label: source, emoji: "⬜", gradient: "bg-gradient-to-r from-gray-400 to-gray-500", text: "text-white", glow: "shadow-gray-200" };
}

export default function SourceBadge({ source }) {
  const cfg = getSourceConfig(source);
  return (
    <Badge className={`${cfg.gradient} ${cfg.text} border-0 font-bold text-xs rounded-full px-3 py-1 shadow-md ${cfg.glow}`}>
      <span className="ml-1">{cfg.emoji}</span>
      {cfg.label}
    </Badge>
  );
}