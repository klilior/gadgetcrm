import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  Phone, Ticket, Users, Package, BarChart3, Wrench,
  Settings, MessageCircle, LogOut, UserPlus,
  ChevronDown, Clock, FileText, Briefcase,
  CreditCard, Trophy, Home, CalendarDays, Receipt, X, Menu
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarHeader, SidebarFooter, SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useUser } from "./components/UserAuth";
import LoginScreen from "./components/LoginScreen";
import { UserProvider } from "./components/UserAuth";
import AddUserModal from "./components/AddUserModal";
import PaymentModal from "./components/payments/PaymentModal";
import QuickLeadButton from "./components/leads/QuickLeadButton";

// Compact menu item component
function MenuItem({ item, isActive, onClick }) {
  const Component = onClick ? 'button' : Link;
  const props = onClick ? { onClick } : { to: item.url };
  
  return (
    <Component
      {...props}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all w-full
        ${isActive 
          ? 'bg-gradient-to-r from-purple-500/20 to-indigo-500/20 text-purple-700 font-medium shadow-sm border border-purple-200/50' 
          : 'text-gray-600 hover:bg-white/40 hover:text-gray-800'
        }`}
    >
      <item.icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-purple-600' : 'text-gray-500'}`} />
      <span className="truncate">{item.title}</span>
    </Component>
  );
}

// Collapsible section component
function MenuSection({ title, icon: Icon, items, isOpen, onToggle, activeUrl, color = "purple" }) {
  const isActive = items.some(item => activeUrl === item.url);
  const colorClasses = {
    purple: { bg: 'from-purple-500/20 to-indigo-500/20', border: 'border-purple-200/50', text: 'text-purple-700', icon: 'text-purple-600' },
    blue: { bg: 'from-blue-500/20 to-cyan-500/20', border: 'border-blue-200/50', text: 'text-blue-700', icon: 'text-blue-600' },
    green: { bg: 'from-green-500/20 to-emerald-500/20', border: 'border-green-200/50', text: 'text-green-700', icon: 'text-green-600' },
    amber: { bg: 'from-amber-500/20 to-orange-500/20', border: 'border-amber-200/50', text: 'text-amber-700', icon: 'text-amber-600' },
    rose: { bg: 'from-rose-500/20 to-pink-500/20', border: 'border-rose-200/50', text: 'text-rose-700', icon: 'text-rose-600' },
    slate: { bg: 'from-slate-500/20 to-gray-500/20', border: 'border-slate-200/50', text: 'text-slate-700', icon: 'text-slate-600' },
  };
  const c = colorClasses[color];

  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className={`flex items-center justify-between w-full px-3 py-2 rounded-xl text-sm transition-all
          ${isActive || isOpen
            ? `bg-gradient-to-r ${c.bg} ${c.text} font-medium border ${c.border}` 
            : 'text-gray-600 hover:bg-white/40'
          }`}
      >
        <div className="flex items-center gap-2.5">
          <Icon className={`w-4 h-4 ${isActive || isOpen ? c.icon : 'text-gray-500'}`} />
          <span>{title}</span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      
      <div className={`overflow-hidden transition-all duration-200 ${isOpen ? 'max-h-96 mt-1' : 'max-h-0'}`}>
        <div className="pr-4 space-y-0.5">
          {items.map(item => (
            <Link
              key={item.url}
              to={item.url}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all
                ${activeUrl === item.url 
                  ? `bg-white/60 ${c.text} font-medium` 
                  : 'text-gray-500 hover:bg-white/30 hover:text-gray-700'
                }`}
            >
              {item.title}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function AppContent({ children, currentPageName }) {
  const { currentUser, activeUsers, logout, switchUser, isLoading } = useUser();
  const location = useLocation();
  const [openSection, setOpenSection] = useState(null);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Force cache-bust on new app version (fixes live showing old bundle)
  useEffect(() => {
    const VERSION = '2026-02-01-roles-2';
    try {
      const stored = localStorage.getItem('app_version');
      if (stored !== VERSION) {
        localStorage.setItem('app_version', VERSION);
        setIsRedirecting(true);
        (async () => {
          try {
            if ('caches' in window) {
              const names = await caches.keys();
              await Promise.all(names.map((n) => caches.delete(n)));
            }
            if ('serviceWorker' in navigator) {
              const regs = await navigator.serviceWorker.getRegistrations();
              await Promise.all(regs.map((r) => r.unregister()));
            }
          } catch (_) {
          } finally {
            const url = new URL(window.location.href);
            url.searchParams.set('v', VERSION);
            window.location.replace(url.toString());
          }
        })();
      }
    } catch (_) {}
  }, []);

  // Redirect logic - check immediately if we need to redirect
  const currentPath = location.pathname;
  const isRoot = currentPath === '/' || currentPath === '';
  const needsRedirect = !isLoading && currentUser && isRoot;

  useEffect(() => {
    if (!currentUser || isLoading) return;
    
    if (isRoot) {
      setIsRedirecting(true);
      const isTechnicianRole = currentUser?.role === "טכנאי";
      const isManagerRole = currentUser?.role === "מנהל" || currentUser?.role === "admin";
      const targetPage = isTechnicianRole ? 'RepairDashboard' : (isManagerRole ? 'ManagerControlCenter' : 'AgentDashboard');
      const targetUrl = createPageUrl(targetPage);
      if (currentPath !== targetUrl) window.location.replace(targetUrl);
    }
  }, [currentUser, isLoading, currentPath, isRoot]);

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

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const appRole = currentUser?.app_role || currentUser?.data?.app_role || currentUser?.role;
  const isManager = appRole === "מנהל" || currentUser?.role === "admin";
  const isShiftManager = appRole === "מנהל משמרת" || isManager || currentUser?.employee_name === "דניאל קריידן";
  const isTechnicianRole = appRole === "טכנאי";
  const isRepresentative = appRole === "נציג";

  // Build menu structure
  const dashboardUrl = isManager ? createPageUrl("ManagerControlCenter") : createPageUrl("AgentDashboard");
  
  const mainItems = isTechnicianRole ? [
    { title: "דשבורד תיקונים", url: createPageUrl("RepairDashboard"), icon: Wrench },
    { title: "דוח התחשבנות", url: createPageUrl("VendorReport"), icon: BarChart3 }
  ] : [
    { title: "דשבורד", url: dashboardUrl, icon: Home },
    { title: "קווים לטיפול", url: createPageUrl("LinesToWorkOn"), icon: Phone },
    { title: "ביצועי נציגים", url: createPageUrl("AgentPerformanceDashboard"), icon: Trophy },
  ];

  const workItems = !isTechnicianRole ? [
    { title: "טיקטים", url: createPageUrl("Tickets"), icon: Ticket },
    { title: "הודעות", url: createPageUrl("MessageCenter"), icon: MessageCircle },
    { title: "לקוחות", url: createPageUrl("Customers"), icon: Users },
    { title: "הזמנות", url: createPageUrl("Orders"), icon: Package },
    { title: "מוצרים", url: createPageUrl("Products"), icon: Briefcase },
    { title: "תיקונים", url: createPageUrl("RepairDashboard"), icon: Wrench },
  ] : [];

  const scheduleItems = !isTechnicianRole ? [
    { title: "העדפות שלי", url: createPageUrl("ShiftPreferences") },
    ...(isShiftManager ? [{ title: "בניית סידור", url: createPageUrl("BuildSchedule") }] : []),
    { title: "הסידור השבועי", url: createPageUrl("WeeklySchedule") },
  ] : [];

  const attendanceItems = !isTechnicianRole ? (isManager ? [
    { title: "דוח נוכחות כללי", url: createPageUrl("AttendanceManagerReport") },
    { title: "בקשות לאישור", url: createPageUrl("ManageAttendance") },
  ] : [
    { title: "שעון נוכחות", url: createPageUrl("AttendanceClock") },
    { title: "הדוח שלי", url: createPageUrl("AttendanceReport") },
  ]) : [];

  const purchasesItems = [];
  if (currentUser && !isTechnicianRole) {
    if (isManager || currentUser?.role === 'admin') {
      purchasesItems.push(
        { title: "תיבת קליטה", url: createPageUrl("IntakeInbox") },
        { title: "העלאה מנייד", url: createPageUrl("MobileInvoiceUpload") },
        { title: "חשבוניות לאימות", url: createPageUrl("InvoicesToReview") },
        { title: "ריכוז חשבוניות", url: createPageUrl("InvoicesOverview") },
        { title: "התראות מחיר", url: createPageUrl("PriceAlerts") },
        { title: "ספקים", url: createPageUrl("SuppliersManagement") },
        { title: "דשבורד רכישות", url: createPageUrl("PurchasesDashboard") },
      );
    } else if (isShiftManager) {
      purchasesItems.push(
        { title: "תיבת קליטה", url: createPageUrl("IntakeInbox") },
        { title: "העלאה מנייד", url: createPageUrl("MobileInvoiceUpload") },
      );
    } else if (isRepresentative) {
      purchasesItems.push({ title: "העלאה מנייד", url: createPageUrl("MobileInvoiceUpload") });
    }
  }

  const salesItems = isManager ? [
    { title: "קבוצות עמלות", url: createPageUrl("CommissionGroupMappings") },
    { title: "ספקי סלולר", url: createPageUrl("CarrierManagement") },
    { title: "מודלי עמלות", url: createPageUrl("CommissionModels") },
    { title: "שיוך לנציגים", url: createPageUrl("AgentCommissionAssignment") },
    { title: "יעדים", url: createPageUrl("GoalsDashboard") },
    { title: "בונוס יעדים", url: createPageUrl("TargetBonusManagement") },
    { title: "בונוס משמרות", url: createPageUrl("ShiftBonusManagement") },
    { title: "חישוב עמלות", url: createPageUrl("CommissionCalculation") },
    { title: "דוח מכירות", url: createPageUrl("SalesDashboard") },
  ] : [];

  const settingsItems = isManager ? [
    { title: "עובדים", url: createPageUrl("ManageEmployees") },
    { title: "ייבוא קווים", url: createPageUrl("RawLinesImport") },
    { title: "מיפוי מק״טים", url: createPageUrl("LineProductMapping") },
    { title: "סנכרון לקוחות", url: createPageUrl("CustomerSync") },
    { title: "ספקי וואטסאפ", url: createPageUrl("WhatsAppProviders") },
    { title: "ספקי משלוחים", url: createPageUrl("ShippingProviders") },
    { title: "הגדרות תשלום", url: createPageUrl("PaymentSettings") },
    { title: "הגדרות נוכחות", url: createPageUrl("AttendanceSettings") },
    { title: "נתוני מכירות", url: createPageUrl("SalesDataAdmin") },
    { title: "סנכרון לינט", url: createPageUrl("SyncManagement") },
    { title: "הגדרות כלליות", url: createPageUrl("Settings") },
    { title: "תפקידי משתמשים", url: createPageUrl("UserRoles") },
  ] : [];

  const toggleSection = (section) => {
    setOpenSection(openSection === section ? null : section);
  };

  // Show loading screen while loading OR while redirecting from root/settings
  if (isLoading || needsRedirect || isRedirecting) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-lg text-gray-600">טוען...</div>
      </div>
    );
  }

  if (!currentUser) return <LoginScreen />;

  const MenuContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-4 border-b border-white/20 flex flex-col items-center">
        <img 
          src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/3afc33c40_23.jpg" 
          alt="Logo" 
          className="w-24 md:w-32"
        />
        <span className="text-purple-600 font-semibold mt-2 text-sm">
          {currentUser?.employee_name}
        </span>
        <Badge className="mt-1 text-xs bg-purple-100 text-purple-700 border-purple-200">
          {currentUser.role}
        </Badge>
      </div>

      {/* Menu */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {/* Main Items */}
        {mainItems.map(item => (
          <MenuItem key={item.url} item={item} isActive={location.pathname === item.url} />
        ))}

        {/* Work Items as simple list */}
        {workItems.length > 0 && (
          <>
            <div className="pt-2 pb-1 px-2">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">עבודה</span>
            </div>
            {workItems.map(item => (
              <MenuItem key={item.url} item={item} isActive={location.pathname === item.url} />
            ))}
          </>
        )}

        {/* Payment Button */}
        {!isTechnicianRole && (
          <button
            onClick={() => setShowPaymentModal(true)}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-sm text-green-700 bg-gradient-to-r from-green-500/15 to-emerald-500/15 hover:from-green-500/25 hover:to-emerald-500/25 transition-all border border-green-200/50 mt-2"
          >
            <CreditCard className="w-4 h-4 text-green-600" />
            <span>💳 תשלום חדש</span>
          </button>
        )}

        {/* Collapsible Sections */}
        {!isTechnicianRole && (
          <div className="pt-3 space-y-1">
            <div className="pb-1 px-2">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">ניהול</span>
            </div>

            {scheduleItems.length > 0 && (
              <MenuSection
                title="סידור עבודה"
                icon={CalendarDays}
                items={scheduleItems}
                isOpen={openSection === 'schedule'}
                onToggle={() => toggleSection('schedule')}
                activeUrl={location.pathname}
                color="green"
              />
            )}

            {attendanceItems.length > 0 && (
              <MenuSection
                title="נוכחות"
                icon={Clock}
                items={attendanceItems}
                isOpen={openSection === 'attendance'}
                onToggle={() => toggleSection('attendance')}
                activeUrl={location.pathname}
                color="amber"
              />
            )}

            {purchasesItems.length > 0 && (
              <MenuSection
                title="חשבוניות ספקים"
                icon={Receipt}
                items={purchasesItems}
                isOpen={openSection === 'purchases'}
                onToggle={() => toggleSection('purchases')}
                activeUrl={location.pathname}
                color="rose"
              />
            )}

            {salesItems.length > 0 && (
              <MenuSection
                title="מכירות ועמלות"
                icon={BarChart3}
                items={salesItems}
                isOpen={openSection === 'sales'}
                onToggle={() => toggleSection('sales')}
                activeUrl={location.pathname}
                color="blue"
              />
            )}

            {settingsItems.length > 0 && (
              <MenuSection
                title="הגדרות"
                icon={Settings}
                items={settingsItems}
                isOpen={openSection === 'settings'}
                onToggle={() => toggleSection('settings')}
                activeUrl={location.pathname}
                color="slate"
              />
            )}
          </div>
        )}
      </div>

      {/* Footer - Active Users */}
      {!isTechnicianRole && !isManager && activeUsers.length > 0 && (
        <div className="border-t border-white/20 p-3">
          <div className="text-[10px] font-semibold text-gray-500 mb-2">במשמרת ({activeUsers.length}/5)</div>
          <div className="flex flex-wrap gap-1">
            {activeUsers.map(user => (
              <button
                key={user.id}
                onClick={() => switchUser(user.id)}
                className={`px-2 py-1 rounded-lg text-xs transition-all ${
                  currentUser.id === user.id 
                    ? 'bg-purple-500 text-white' 
                    : 'bg-white/40 text-gray-600 hover:bg-white/60'
                }`}
              >
                {user.employee_name?.split(' ')[0]}
              </button>
            ))}
          </div>
          {activeUsers.length < 5 && (
            <Button
              onClick={() => setShowAddUserModal(true)}
              size="sm"
              variant="ghost"
              className="w-full mt-2 text-xs h-8"
            >
              <UserPlus className="w-3 h-3 ml-1" />
              הוסף נציג
            </Button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div dir="rtl" className="h-[100dvh] bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 font-sans">
      <style dangerouslySetInnerHTML={{ __html: `
        html, body, #root { height: 100%; }
        .overflow-y-auto { -webkit-overflow-scrolling: touch; }
      `}} />

      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 bg-red-600 text-white text-center py-1.5 text-sm z-[9999]">
          ⚠️ אין חיבור לאינטרנט
        </div>
      )}

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-72 bg-white/95 backdrop-blur-xl shadow-2xl overflow-hidden">
            <button 
              onClick={() => setMobileMenuOpen(false)}
              className="absolute left-3 top-3 p-2 rounded-full hover:bg-gray-100 z-10"
            >
              <X className="w-5 h-5" />
            </button>
            <MenuContent />
          </div>
        </div>
      )}

      <div className="h-full flex">
        {/* Desktop Sidebar */}
        <div className="hidden md:block w-64 h-full bg-white/80 backdrop-blur-xl border-l border-white/30 shadow-xl overflow-hidden">
          <MenuContent />
        </div>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Header */}
          <header className="bg-white/60 backdrop-blur-lg border-b border-white/30 px-4 py-3 flex justify-between items-center flex-shrink-0">
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setMobileMenuOpen(true)}
                className="md:hidden p-2 rounded-xl bg-white/60 hover:bg-white/80"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div>
                <div className="font-semibold text-gray-800 text-sm md:text-base flex items-center gap-2">
                  {currentUser.employee_name}
                  {isManager && (
                    <Badge className="bg-amber-100 text-amber-700 text-[10px] border-amber-200">מנהל</Badge>
                  )}
                </div>
              </div>
            </div>
            <Button
              onClick={logout}
              variant="ghost"
              size="sm"
              className="text-gray-600 hover:text-gray-800 hover:bg-white/60"
            >
              <LogOut className="w-4 h-4 ml-1" />
              <span className="hidden sm:inline">יציאה</span>
            </Button>
          </header>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-3 md:p-4">
            {children}
          </div>
        </main>
      </div>

      {!isTechnicianRole && !isManager && (
        <AddUserModal isOpen={showAddUserModal} onClose={() => setShowAddUserModal(false)} />
      )}

      {showPaymentModal && (
        <PaymentModal isOpen={showPaymentModal} onClose={() => setShowPaymentModal(false)} />
      )}

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