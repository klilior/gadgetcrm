import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  Headphones, Phone, Ticket, Users, Package, BarChart3, Wrench,
  Settings, MessageCircle, Calendar, LogOut, UserPlus, SlidersHorizontal,
  ChevronDown, ChevronRight, UserSquare, Clock, FileText, Shield, Briefcase,
  CreditCard, Trophy // Added CreditCard and Trophy icons
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarHeader, SidebarFooter, SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useUser } from "./components/UserAuth";
import LoginScreen from "./components/LoginScreen";
import { UserProvider } from "./components/UserAuth";
import AddUserModal from "./components/AddUserModal";
import PaymentModal from "./components/payments/PaymentModal"; // Added PaymentModal import
import QuickLeadButton from "./components/leads/QuickLeadButton";

function AppContent({ children, currentPageName }) {
  const { currentUser, activeUsers, logout, switchUser, removeUserFromShift, endShift, isLoading } = useUser();
  const location = useLocation();

  // Redirect to correct home page based on role
  useEffect(() => {
    if (!currentUser || isLoading) return;
    
    const currentPath = location.pathname;
    const isTechnicianRole = currentUser?.role === "טכנאי";
    
    // Only redirect if on root or Settings page (which might be default)
    const isRootOrSettings = currentPath === '/' || currentPath === '' || 
                             currentPath.toLowerCase() === '/settings';
    
    if (isRootOrSettings) {
      const targetPage = isTechnicianRole ? 'RepairDashboard' : 'AgentDashboard';
      const targetUrl = createPageUrl(targetPage);
      
      // Use replace to avoid back button issues
      if (currentPath !== targetUrl) {
        window.location.replace(targetUrl);
      }
    }
  }, [currentUser, isLoading, location.pathname]);
  const [isScheduleMenuOpen, setIsScheduleMenuOpen] = useState(false);
  const [isAttendanceMenuOpen, setIsAttendanceMenuOpen] = useState(false);
  const [isSalesMenuOpen, setIsSalesMenuOpen] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [isPurchasesMenuOpen, setIsPurchasesMenuOpen] = useState(false);
  const [showUserSwitcher, setShowUserSwitcher] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false); // Added showPaymentModal state

  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const isManager = currentUser?.role === "מנהל";
  const isShiftManager = currentUser?.employee_name === "דניאל קריידן" || currentUser?.role === "מנהל משמרת" || isManager;
  const isTechnicianRole = currentUser?.role === "טכנאי";
  const isAgent = currentUser?.role === "נציג";
  const isRepresentative = currentUser?.role === "נציג";

  let navigationItems = [];
  let scheduleMenuItems = [];
  let attendanceMenuItems = [];
  let salesMenuItems = [];
  let settingsMenuItems = [];
  let purchasesMenuItems = [];

  if (isTechnicianRole) {
    navigationItems = [
      { title: "דשבורד תיקונים", url: createPageUrl("RepairDashboard"), icon: Wrench },
      { title: "דוח התחשבנות מעבדה", url: createPageUrl("VendorReport"), icon: BarChart3 }
      ];
      } else if (currentUser) {
      navigationItems = [
        { title: "הדשבורד שלי", url: createPageUrl("AgentDashboard"), icon: Trophy },
        { title: "קווים לטיפול", url: createPageUrl("LinesToWorkOn"), icon: Phone },
        { title: "דוח מכירות (Linet)", url: createPageUrl("SalesDashboard"), icon: BarChart3 },
        { title: "ביצועי נציגים", url: createPageUrl("AgentPerformanceDashboard"), icon: Users },
      { title: "מרכז הודעות", url: createPageUrl("MessageCenter"), icon: MessageCircle },
      { title: "שיחות היום", url: createPageUrl("TodaysCalls"), icon: Phone },
      { title: "הטיקטים שלי", url: createPageUrl("Tickets"), icon: Ticket },
      { title: "לקוחות", url: createPageUrl("Customers"), icon: Users },
      { title: "הזמנות", url: createPageUrl("Orders"), icon: Package },
      { title: "דשבורד תיקונים", url: createPageUrl("RepairDashboard"), icon: Wrench },
    ];

    scheduleMenuItems = [
      { title: "העדפות שלי", url: createPageUrl("ShiftPreferences") },
      ...(isShiftManager ? [{ title: "בניית סידור", url: createPageUrl("BuildSchedule") }] : []),
      { title: "הסידור השבועי", url: createPageUrl("WeeklySchedule") },
      ...(isShiftManager ? [{ title: "🔍 בדיקת סידור", url: createPageUrl("DebugSchedule") }] : []),
    ];

    // תפריט נוכחות - שונה למנהל
    if (isManager) {
      attendanceMenuItems = [
        { title: "דוח נוכחות כללי", url: createPageUrl("AttendanceManagerReport") },
        { title: "בקשות לאישור", url: createPageUrl("ManageAttendance") },
      ];
      } else {
      attendanceMenuItems = [
        { title: "שעון נוכחות", url: createPageUrl("AttendanceClock") },
        { title: "הדוח שלי", url: createPageUrl("AttendanceReport") },
      ];
      }

      if (isManager) {
      salesMenuItems = [
        { title: "קבוצות מכירה ועמלות", url: createPageUrl("CommissionGroupMappings") },
        { title: "ספקי סלולר", url: createPageUrl("CarrierManagement") },
        { title: "מודלי עמלות", url: createPageUrl("CommissionModels") },
        { title: "שיוך עמלות לנציגים", url: createPageUrl("AgentCommissionAssignment") },
        { title: "יעדים וביצועים", url: createPageUrl("GoalsDashboard") },
        { title: "בונוס יעדים", url: createPageUrl("TargetBonusManagement") },
        { title: "בונוס משמרות", url: createPageUrl("ShiftBonusManagement") },
        { title: "חישוב עמלות", url: createPageUrl("CommissionCalculation") },
      ];

      settingsMenuItems = [
      { title: "ניהול עובדים ומשתמשים", url: createPageUrl("ManageEmployees") },
      { title: "📥 ייבוא גולמי - קווים", url: createPageUrl("RawLinesImport") },
      { title: "🔧 מיפוי מק״טי קווים", url: createPageUrl("LineProductMapping") },
      { title: "👥 סנכרון לקוחות מלינט", url: createPageUrl("CustomerSync") },
      { title: "ספקי וואטסאפ", url: createPageUrl("WhatsAppProviders") },
      { title: "🔧 דיבאג וואטסאפ", url: createPageUrl("WhatsAppDebug") },
      { title: "ספקי משלוחים", url: createPageUrl("ShippingProviders") },
      { title: "הגדרות תשלום", url: createPageUrl("PaymentSettings") },
      { title: "הגדרות נוכחות", url: createPageUrl("AttendanceSettings") },
      { title: "ניהול נתוני מכירות", url: createPageUrl("SalesDataAdmin") },
      { title: "🔄 סנכרון לינט", url: createPageUrl("SyncManagement") },
      { title: "הגדרות כלליות", url: createPageUrl("Settings") },
      ];
    }
  }

  // Build purchases menu by roles
  if (currentUser) {
    if (isManager || currentUser?.role === 'admin') {
        purchasesMenuItems = [
          { title: "תיבת קליטה", url: createPageUrl("IntakeInbox") },
          { title: "העלאת חשבונית מהנייד", url: createPageUrl("MobileInvoiceUpload") },
          { title: "חשבוניות לאימות", url: createPageUrl("InvoicesToReview") },
          { title: "התראות מחיר", url: createPageUrl("PriceAlerts") },
          { title: "ניהול ספקים", url: createPageUrl("SuppliersManagement") },
          { title: "דשבורד רכישות", url: createPageUrl("PurchasesDashboard") },
        ];
    } else if (isShiftManager) {
      purchasesMenuItems = [
        { title: "תיבת קליטה", url: createPageUrl("IntakeInbox") },
        { title: "העלאת חשבונית מהנייד", url: createPageUrl("MobileInvoiceUpload") },
      ];
    } else if (isRepresentative) {
      purchasesMenuItems = [
        { title: "העלאת חשבונית מהנייד", url: createPageUrl("MobileInvoiceUpload") },
      ];
    }
  }

  const isSchedulePageActive = scheduleMenuItems.some(item => location.pathname === item.url);
  const isAttendancePageActive = attendanceMenuItems.some(item => location.pathname === item.url);
  const isSalesPageActive = salesMenuItems.some(item => location.pathname === item.url);
  const isSettingsPageActive = settingsMenuItems.some(item => location.pathname === item.url);
  const isPurchasesPageActive = purchasesMenuItems.some(item => location.pathname === item.url);

  // פתח את התפריטים אוטומטית אם הדף הנוכחי הוא בתת-תפריט
  useEffect(() => {
    if (isSchedulePageActive) setIsScheduleMenuOpen(true);
    if (isAttendancePageActive) setIsAttendanceMenuOpen(true);
    if (isSalesPageActive) setIsSalesMenuOpen(true);
    if (isSettingsPageActive) setIsSettingsMenuOpen(true);
    if (isPurchasesPageActive) setIsPurchasesMenuOpen(true);
  }, [isSchedulePageActive, isAttendancePageActive, isSalesPageActive, isSettingsPageActive, isPurchasesPageActive]);

  if (isLoading) {
    return <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 flex items-center justify-center"><div className="text-xl">טוען...</div></div>;
  }

  if (!currentUser) {
    return <LoginScreen />;
  }

  return (
    <div dir="rtl" className="min-h-[100dvh] bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 font-sans">
      <style dangerouslySetInnerHTML={{ __html: `
          .glass-card { background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 24px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1); }
          .glass-button { background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 16px; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
          .glass-button:hover { background: rgba(255, 255, 255, 0.25); transform: translateY(-2px); box-shadow: 0 12px 24px rgba(0, 0, 0, 0.15); }

          @media (max-width: 768px) {
            .mobile-padding { padding-left: 8px !important; padding-right: 8px !important; }
            .mobile-text { font-size: 14px !important; }
            .mobile-title { font-size: 18px !important; }
          }
      `}} />

      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 bg-red-600 text-white text-center py-2 z-[9999]">
          ⚠️ אין חיבור לאינטרנט - חלק מהפעולות עלולות להיכשל
        </div>
      )}

      <SidebarProvider>
        <div className="h-[100dvh] min-h-0 flex w-full">
          <Sidebar side="right" collapsible="icon" className="glass-card border-0 m-2 md:m-4 mr-0 transition-all duration-300">
            <SidebarHeader className="p-3 md:p-6 border-b border-white/20 flex flex-col items-center gap-2 relative">
              <SidebarTrigger className="hidden md:flex absolute left-2 top-2 h-6 w-6 text-gray-400 hover:text-gray-600" />
              <div className="flex flex-col items-center group-data-[state=collapsed]:hidden transition-all duration-300">
                <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/3afc33c40_23.jpg" alt="Logo" className="w-28 md:w-40"/>
                <span className="text-purple-600 font-bold mt-2 text-lg text-center">
                  {currentUser?.employee_name}
                </span>
              </div>
            </SidebarHeader>
            <SidebarContent className="p-2 md:p-4">
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu className="space-y-1 md:space-y-2">
                    {navigationItems.map((item) => (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton asChild className={`glass-button p-3 md:p-4 rounded-2xl transition-all duration-300 ${ location.pathname === item.url ? 'bg-gradient-to-r from-purple-500/30 to-indigo-500/30 border-purple-400 shadow-lg' : 'hover:bg-white/25' }`}>
                          <Link to={item.url} className="flex items-center gap-3 md:gap-4">
                            <item.icon className="w-4 h-4 md:w-5 md:h-5 text-gray-700 flex-shrink-0" />
                            <span className="font-medium text-gray-800 text-sm md:text-base truncate">{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                    {!isTechnicianRole && (
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild className={`glass-button p-3 md:p-4 rounded-2xl transition-all duration-300 ${ location.pathname === createPageUrl("Products") ? 'bg-gradient-to-r from-purple-500/30 to-indigo-500/30 border-purple-400 shadow-lg' : 'hover:bg-white/25' }`}>
                          <Link to={createPageUrl("Products")} className="flex items-center gap-3 md:gap-4">
                            <Briefcase className="w-4 h-4 md:w-5 md:h-5 text-gray-700 flex-shrink-0" />
                            <span className="font-medium text-gray-800 text-sm md:text-base truncate">מוצרים</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )}

                    {!isTechnicianRole && (
                      // New Payment Button
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          onClick={() => setShowPaymentModal(true)}
                          className="glass-button p-3 md:p-4 rounded-2xl transition-all duration-300 hover:bg-gradient-to-r hover:from-green-500/30 hover:to-emerald-500/30 hover:border-green-400 hover:shadow-lg"
                        >
                          <div className="flex items-center gap-3 md:gap-4">
                            <CreditCard className="w-4 h-4 md:w-5 md:h-5 text-green-600 flex-shrink-0" />
                            <span className="font-medium text-gray-800 text-sm md:text-base">💳 תשלום חדש</span>
                          </div>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )}

                    {!isTechnicianRole && (
                      <>
                        {isManager && salesMenuItems.length > 0 && (
                          <SidebarMenuItem>
                            <SidebarMenuButton
                              onClick={() => setIsSalesMenuOpen(!isSalesMenuOpen)}
                              className={`glass-button p-3 md:p-4 rounded-2xl transition-all duration-300 ${
                                isSalesPageActive ? 'bg-gradient-to-r from-blue-500/30 to-indigo-500/30 border-blue-400 shadow-lg' : 'hover:bg-white/25'
                              }`}
                            >
                              <div className="flex items-center gap-3 md:gap-4 w-full">
                                <BarChart3 className="w-4 h-4 md:w-5 md:h-5 text-gray-700 flex-shrink-0" />
                                <span className="font-medium text-gray-800 flex-1 text-sm md:text-base">ניהול מכירות</span>
                                {isSalesMenuOpen ? (
                                  <ChevronDown className="w-3 h-3 md:w-4 md:h-4 text-gray-600 transition-transform" />
                                ) : (
                                  <ChevronRight className="w-3 h-3 md:w-4 md:h-4 text-gray-600 transition-transform" />
                                )}
                              </div>
                            </SidebarMenuButton>

                            <div className={`overflow-hidden transition-all duration-300 ${isSalesMenuOpen ? 'max-h-96 opacity-100 mt-1' : 'max-h-0 opacity-0'}`}>
                              <div className="pr-4 md:pr-6 pt-1 space-y-1">
                                {salesMenuItems.map(child => (
                                  <SidebarMenuButton key={child.title} asChild className={`glass-button w-full justify-start p-2 md:p-3 rounded-xl transition-all duration-300 ${ location.pathname === child.url ? 'bg-blue-500/30 border-blue-400 font-semibold' : 'hover:bg-white/25' }`}>
                                    <Link to={child.url} className="text-xs md:text-sm font-medium text-gray-700">
                                      {child.title}
                                    </Link>
                                  </SidebarMenuButton>
                                ))}
                              </div>
                            </div>
                          </SidebarMenuItem>
                        )}

                        {scheduleMenuItems.length > 0 && (
                          <SidebarMenuItem>
                            <SidebarMenuButton
                              onClick={() => setIsScheduleMenuOpen(!isScheduleMenuOpen)}
                              className={`glass-button p-3 md:p-4 rounded-2xl transition-all duration-300 ${
                                isSchedulePageActive ? 'bg-gradient-to-r from-green-500/30 to-emerald-500/30 border-green-400 shadow-lg' : 'hover:bg-white/25'
                              }`}
                            >
                              <div className="flex items-center gap-3 md:gap-4 w-full">
                                <SlidersHorizontal className="w-4 h-4 md:w-5 md:h-5 text-gray-700 flex-shrink-0" />
                                <span className="font-medium text-gray-800 flex-1 text-sm md:text-base">סידור עבודה</span>
                                {isScheduleMenuOpen ? (
                                  <ChevronDown className="w-3 h-3 md:w-4 md:h-4 text-gray-600 transition-transform" />
                                ) : (
                                  <ChevronRight className="w-3 h-3 md:w-4 md:h-4 text-gray-600 transition-transform" />
                                )}
                              </div>
                            </SidebarMenuButton>

                            <div className={`overflow-hidden transition-all duration-300 ${isScheduleMenuOpen ? 'max-h-48 opacity-100 mt-1' : 'max-h-0 opacity-0'}`}>
                              <div className="pr-4 md:pr-6 pt-1 space-y-1">
                                {scheduleMenuItems.map(child => (
                                  <SidebarMenuButton key={child.title} asChild className={`glass-button w-full justify-start p-2 md:p-3 rounded-xl transition-all duration-300 ${ location.pathname === child.url ? 'bg-green-500/30 border-green-400 font-semibold' : 'hover:bg-white/25' }`}>
                                    <Link to={child.url} className="text-xs md:text-sm font-medium text-gray-700">
                                      {child.title}
                                    </Link>
                                  </SidebarMenuButton>
                                ))}
                              </div>
                            </div>
                          </SidebarMenuItem>
                        )}

                        {purchasesMenuItems.length > 0 && (
                          <SidebarMenuItem>
                            <SidebarMenuButton
                              onClick={() => setIsPurchasesMenuOpen(!isPurchasesMenuOpen)}
                              className={`glass-button p-3 md:p-4 rounded-2xl transition-all duration-300 ${
                                isPurchasesPageActive ? 'bg-gradient-to-r from-fuchsia-500/30 to-rose-500/30 border-fuchsia-400 shadow-lg' : 'hover:bg-white/25'
                              }`}
                            >
                              <div className="flex items-center gap-3 md:gap-4 w-full">
                                <FileText className="w-4 h-4 md:w-5 md:h-5 text-gray-700 flex-shrink-0" />
                                <span className="font-medium text-gray-800 flex-1 text-sm md:text-base">חשבוניות ספקים</span>
                                {isPurchasesMenuOpen ? (
                                  <ChevronDown className="w-3 h-3 md:w-4 md:h-4 text-gray-600 transition-transform" />
                                ) : (
                                  <ChevronRight className="w-3 h-3 md:w-4 md:h-4 text-gray-600 transition-transform" />
                                )}
                              </div>
                            </SidebarMenuButton>
                            <div className={`overflow-hidden transition-all duration-300 ${isPurchasesMenuOpen ? 'max-h-96 opacity-100 mt-1' : 'max-h-0 opacity-0'}`}>
                              <div className="pr-4 md:pr-6 pt-1 space-y-1">
                                {purchasesMenuItems.map(child => (
                                  <SidebarMenuButton key={child.title} asChild className={`glass-button w-full justify-start p-2 md:p-3 rounded-xl transition-all duration-300 ${ location.pathname === child.url ? 'bg-fuchsia-500/30 border-fuchsia-400 font-semibold' : 'hover:bg-white/25' }`}>
                                    <Link to={child.url} className="text-xs md:text-sm font-medium text-gray-700">
                                      {child.title}
                                    </Link>
                                  </SidebarMenuButton>
                                ))}
                              </div>
                            </div>
                          </SidebarMenuItem>
                        )}

                        {attendanceMenuItems.length > 0 && (
                          <SidebarMenuItem>
                            <SidebarMenuButton
                              onClick={() => setIsAttendanceMenuOpen(!isAttendanceMenuOpen)}
                              className={`glass-button p-3 md:p-4 rounded-2xl transition-all duration-300 ${
                                isAttendancePageActive ? 'bg-gradient-to-r from-amber-500/30 to-orange-500/30 border-amber-400 shadow-lg' : 'hover:bg-white/25'
                              }`}
                            >
                              <div className="flex items-center gap-3 md:gap-4 w-full">
                                <Clock className="w-4 h-4 md:w-5 md:h-5 text-gray-700 flex-shrink-0" />
                                <span className="font-medium text-gray-800 flex-1 text-sm md:text-base">נוכחות</span>
                                {isAttendanceMenuOpen ? (
                                  <ChevronDown className="w-3 h-3 md:w-4 md:h-4 text-gray-600 transition-transform" />
                                ) : (
                                  <ChevronRight className="w-3 h-3 md:w-4 md:h-4 text-gray-600 transition-transform" />
                                )}
                              </div>
                            </SidebarMenuButton>

                            <div className={`overflow-hidden transition-all duration-300 ${isAttendanceMenuOpen ? 'max-h-64 opacity-100 mt-1' : 'max-h-0 opacity-0'}`}>
                              <div className="pr-4 md:pr-6 pt-1 space-y-1">
                                {attendanceMenuItems.map(child => (
                                  <SidebarMenuButton key={child.title} asChild className={`glass-button w-full justify-start p-2 md:p-3 rounded-xl transition-all duration-300 ${ location.pathname === child.url ? 'bg-amber-500/30 border-amber-400 font-semibold' : 'hover:bg-white/25' }`}>
                                    <Link to={child.url} className="text-xs md:text-sm font-medium text-gray-700">
                                      {child.title}
                                    </Link>
                                  </SidebarMenuButton>
                                ))}
                              </div>
                            </div>
                          </SidebarMenuItem>
                        )}
                      </>
                    )}

                    {isManager && settingsMenuItems.length > 0 && (
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          onClick={() => setIsSettingsMenuOpen(!isSettingsMenuOpen)}
                          className={`glass-button p-3 md:p-4 rounded-2xl transition-all duration-300 ${
                            isSettingsPageActive ? 'bg-gradient-to-r from-gray-500/30 to-slate-500/30 border-gray-400 shadow-lg' : 'hover:bg-white/25'
                          }`}
                        >
                          <div className="flex items-center gap-3 md:gap-4 w-full">
                            <Settings className="w-4 h-4 md:w-5 md:h-5 text-gray-700 flex-shrink-0" />
                            <span className="font-medium text-gray-800 flex-1 text-sm md:text-base">הגדרות וניהול</span>
                            {isSettingsMenuOpen ? (
                              <ChevronDown className="w-3 h-3 md:w-4 md:h-4 text-gray-600 transition-transform" />
                            ) : (
                              <ChevronRight className="w-3 h-3 md:w-4 md:h-4 text-gray-600 transition-transform" />
                            )}
                          </div>
                        </SidebarMenuButton>

                        <div className={`overflow-hidden transition-all duration-300 ${isSettingsMenuOpen ? 'max-h-96 opacity-100 mt-1' : 'max-h-0 opacity-0'}`}>
                          <div className="pr-4 md:pr-6 pt-1 space-y-1 overflow-y-auto max-h-80">
                            {settingsMenuItems.map(child => (
                              <SidebarMenuButton key={child.title} asChild className={`glass-button w-full justify-start p-2 md:p-3 rounded-xl transition-all duration-300 ${ location.pathname === child.url ? 'bg-gray-500/30 border-gray-400 font-semibold' : 'hover:bg-white/25' }`}>
                                <Link to={child.url} className="text-xs md:text-sm font-medium text-gray-700">
                                  {child.title}
                                </Link>
                              </SidebarMenuButton>
                            ))}
                          </div>
                        </div>
                      </SidebarMenuItem>
                    )}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>

            {!isTechnicianRole && !isManager && (
              <SidebarFooter className="border-t border-white/20 p-3 md:p-6">
                {activeUsers.length > 0 && (
                  <div className="space-y-2 mb-4">
                    <div className="text-xs font-semibold text-gray-600 mb-2">נציגים במשמרת ({activeUsers.length}/5):</div>
                    {activeUsers.map(user => (
                      <div
                        key={user.id}
                        className={`glass-button p-2 rounded-lg cursor-pointer hover:bg-white/30 transition-all ${currentUser.id === user.id ? 'bg-blue-500/20 border-blue-400' : ''}`}
                        onClick={() => switchUser(user.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-xs">{user.employee_name}</p>
                            <p className="text-xs text-gray-600">{user.role}</p>
                          </div>
                          {currentUser.id === user.id && (
                            <Badge className="bg-blue-500 text-white text-xs">פעיל</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {activeUsers.length < 5 && (
                  <Button
                    onClick={() => setShowAddUserModal(true)}
                    className="w-full glass-button bg-purple-500/20 hover:bg-purple-500/30 mb-2"
                    size="sm"
                  >
                    <UserPlus className="w-4 h-4 ml-2" />
                    הוסף נציג למשמרת
                  </Button>
                )}
              </SidebarFooter>
            )}
          </Sidebar>

          <main className="flex-1 flex flex-col min-w-0 min-h-0">
            <header className="glass-card m-2 md:m-4 p-3 md:p-4 flex justify-between items-center">
               <div className="flex items-center gap-2 md:gap-4 min-w-0">
                  <SidebarTrigger className="glass-button p-2 rounded-xl md:hidden flex-shrink-0" />
                   <div className="min-w-0">
                       <div className="font-bold text-gray-900 text-base md:text-lg truncate flex items-center gap-2">
                         {currentUser.employee_name}
                         {isManager && (
                           <Badge className="bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs">
                             מנהל
                           </Badge>
                         )}
                         {isTechnicianRole && (
                           <Badge className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-xs">
                             טכנאי
                           </Badge>
                         )}
                         {!isTechnicianRole && !isManager && activeUsers.length > 1 && (
                           <Badge variant="outline" className="bg-purple-100 text-purple-800 border-purple-300 text-xs">
                             {activeUsers.length} במשמרת
                           </Badge>
                         )}
                       </div>
                       <div className="text-xs md:text-sm text-gray-600">תפקיד: {currentUser.role}</div>
                   </div>
               </div>
                <div className="flex gap-2">
                  {!isTechnicianRole && !isManager && activeUsers.length < 5 && (
                    <Button
                      onClick={() => setShowAddUserModal(true)}
                      variant="outline"
                      size="sm"
                      className="glass-button hidden md:flex"
                    >
                      <UserPlus className="w-4 h-4 ml-2" />
                      הוסף נציג
                    </Button>
                  )}
                  <Button
                    onClick={logout}
                    variant="outline"
                    size="sm"
                    className="glass-button flex-shrink-0"
                  >
                      <LogOut className="w-3 h-3 md:w-4 md:h-4 ml-1 md:ml-2" />
                      <span>יציאה</span>
                  </Button>
                </div>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto p-2 md:p-4 pt-0">
              {children}
            </div>
          </main>
        </div>
      </SidebarProvider>

      {!isTechnicianRole && !isManager && <AddUserModal isOpen={showAddUserModal} onClose={() => setShowAddUserModal(false)} />}

      {showPaymentModal && (
        <PaymentModal
          isOpen={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
        />
      )}

      {/* Quick Lead FAB - visible for all non-technician users */}
      {!isTechnicianRole && <QuickLeadButton />}
      </div>
  );
}

export default function Layout({ children, currentPageName }) {
  return (
    <UserProvider>
      <AppContent children={children} currentPageName={currentPageName} />
    </UserProvider>
  );
}