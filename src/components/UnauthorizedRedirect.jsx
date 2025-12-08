import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

/**
 * Component to redirect unauthorized users to appropriate dashboard
 * Usage: Add <UnauthorizedRedirect /> at the top of restricted pages
 */
export default function UnauthorizedRedirect({ currentUser }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!currentUser) return;

    const isManager = currentUser.role === "מנהל";
    const isTechnician = currentUser.role === "טכנאי";

    // אם לא מנהל ולא טכנאי -> נציג או מנהל משמרת
    if (!isManager && !isTechnician) {
      // הפנה לדשבורד האישי
      const targetUrl = createPageUrl("AgentDashboard");
      window.location.href = targetUrl;
    } else if (isTechnician) {
      // טכנאי -> דשבורד תיקונים
      const targetUrl = createPageUrl("RepairDashboard");
      window.location.href = targetUrl;
    }
  }, [currentUser, navigate]);

  return null;
}