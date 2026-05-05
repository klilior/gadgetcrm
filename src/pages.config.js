/**
 * pages.config.js - Page routing configuration (LAZY LOADED)
 * 
 * All page imports use React.lazy() for code splitting.
 * Each page is loaded only when the user navigates to it.
 */
import React from 'react';
import __Layout from './Layout.jsx';

// Helper for lazy imports
const lazy = (importFn) => React.lazy(importFn);

// === Core pages (loaded by most users) ===
const AgentDashboard = lazy(() => import('./pages/AgentDashboard'));
const ManagerControlCenter = lazy(() => import('./pages/ManagerControlCenter'));
const RepairDashboard = lazy(() => import('./pages/RepairDashboard'));
const Home = lazy(() => import('./pages/Home'));

// === Work pages ===
const Tickets = lazy(() => import('./pages/Tickets'));
const MessageCenter = lazy(() => import('./pages/MessageCenter'));
const Customers = lazy(() => import('./pages/Customers'));
// Orders page removed - use UnifiedOrders instead
const Products = lazy(() => import('./pages/Products'));
const CallLog = lazy(() => import('./pages/CallLog'));
const LinesToWorkOn = lazy(() => import('./pages/LinesToWorkOn'));

// === Schedule & Attendance ===
const ShiftPreferences = lazy(() => import('./pages/ShiftPreferences'));
const BuildSchedule = lazy(() => import('./pages/BuildSchedule'));
const WeeklySchedule = lazy(() => import('./pages/WeeklySchedule'));
const AttendanceClock = lazy(() => import('./pages/AttendanceClock'));
const AttendanceReport = lazy(() => import('./pages/AttendanceReport'));
const AttendanceManagerReport = lazy(() => import('./pages/AttendanceManagerReport'));
const ManageAttendance = lazy(() => import('./pages/ManageAttendance'));
const AttendanceSettings = lazy(() => import('./pages/AttendanceSettings'));
const Shifts = lazy(() => import('./pages/Shifts'));

// === Sales & Commissions (admin/manager) ===
const AgentPerformanceDashboard = lazy(() => import('./pages/AgentPerformanceDashboard'));
const AgentCommissionAssignment = lazy(() => import('./pages/AgentCommissionAssignment'));
const CommissionCalculation = lazy(() => import('./pages/CommissionCalculation'));
const CommissionGroupMappings = lazy(() => import('./pages/CommissionGroupMappings'));
const CommissionModels = lazy(() => import('./pages/CommissionModels'));
const SalesDashboard = lazy(() => import('./pages/SalesDashboard'));
const SalesDataAdmin = lazy(() => import('./pages/SalesDataAdmin'));
const GoalsDashboard = lazy(() => import('./pages/GoalsDashboard'));
const TargetBonusManagement = lazy(() => import('./pages/TargetBonusManagement'));
const ShiftBonusManagement = lazy(() => import('./pages/ShiftBonusManagement'));
const CarrierManagement = lazy(() => import('./pages/CarrierManagement'));

// === Invoices & Purchases ===
const IntakeInbox = lazy(() => import('./pages/IntakeInbox'));
const InvoicesOverview = lazy(() => import('./pages/InvoicesOverview'));
const InvoicesToReview = lazy(() => import('./pages/InvoicesToReview'));
const MobileInvoiceUpload = lazy(() => import('./pages/MobileInvoiceUpload'));
const PurchasesDashboard = lazy(() => import('./pages/PurchasesDashboard'));
const SuppliersManagement = lazy(() => import('./pages/SuppliersManagement'));
const PriceAlerts = lazy(() => import('./pages/PriceAlerts'));

// === Admin / Settings ===
const ManageEmployees = lazy(() => import('./pages/ManageEmployees'));
const Settings = lazy(() => import('./pages/Settings'));
const SyncManagement = lazy(() => import('./pages/SyncManagement'));
const CustomerSync = lazy(() => import('./pages/CustomerSync'));
const ShippingProviders = lazy(() => import('./pages/ShippingProviders'));
const PaymentSettings = lazy(() => import('./pages/PaymentSettings'));
const WhatsAppProviders = lazy(() => import('./pages/WhatsAppProviders'));
const RawLinesImport = lazy(() => import('./pages/RawLinesImport'));
const LineProductMapping = lazy(() => import('./pages/LineProductMapping'));
const PriceMonitor = lazy(() => import('./pages/PriceMonitor'));

// === Misc ===
const VendorReport = lazy(() => import('./pages/VendorReport'));
const ManagerDashboard = lazy(() => import('./pages/ManagerDashboard'));
const PaymentReturn = lazy(() => import('./pages/PaymentReturn'));
const LineContractImport = lazy(() => import('./pages/LineContractImport'));
const DebugSchedule = lazy(() => import('./pages/DebugSchedule'));
const TodaysCalls = lazy(() => import('./pages/TodaysCalls'));
const WhatsAppDebug = lazy(() => import('./pages/WhatsAppDebug'));
const SupplierProducts = lazy(() => import('./pages/SupplierProducts'));
const TechnicianReport = lazy(() => import('./pages/TechnicianReport'));
const ShipmentLabelPreview = lazy(() => import('./pages/ShipmentLabelPreview'));
const GetPackageSettings = lazy(() => import('./pages/GetPackageSettings'));

export const PAGES = {
    "AgentCommissionAssignment": AgentCommissionAssignment,
    "AgentDashboard": AgentDashboard,
    "AgentPerformanceDashboard": AgentPerformanceDashboard,
    "AttendanceClock": AttendanceClock,
    "AttendanceManagerReport": AttendanceManagerReport,
    "AttendanceReport": AttendanceReport,
    "AttendanceSettings": AttendanceSettings,
    "BuildSchedule": BuildSchedule,
    "CallLog": CallLog,
    "CarrierManagement": CarrierManagement,
    "CommissionCalculation": CommissionCalculation,
    "CommissionGroupMappings": CommissionGroupMappings,
    "CommissionModels": CommissionModels,
    "CustomerSync": CustomerSync,
    "Customers": Customers,
    "DebugSchedule": DebugSchedule,
    "GoalsDashboard": GoalsDashboard,
    "Home": Home,
    "IntakeInbox": IntakeInbox,
    "InvoicesOverview": InvoicesOverview,
    "InvoicesToReview": InvoicesToReview,
    "LineContractImport": LineContractImport,
    "LineProductMapping": LineProductMapping,
    "LinesToWorkOn": LinesToWorkOn,
    "ManageAttendance": ManageAttendance,
    "ManageEmployees": ManageEmployees,
    "ManagerControlCenter": ManagerControlCenter,
    "ManagerDashboard": ManagerDashboard,
    "MessageCenter": MessageCenter,
    "MobileInvoiceUpload": MobileInvoiceUpload,
    // "Orders" removed - use UnifiedOrders
    "PaymentReturn": PaymentReturn,
    "PaymentSettings": PaymentSettings,
    "PriceAlerts": PriceAlerts,
    "PriceMonitor": PriceMonitor,
    "Products": Products,
    "PurchasesDashboard": PurchasesDashboard,
    "RawLinesImport": RawLinesImport,
    "RepairDashboard": RepairDashboard,
    "SalesDashboard": SalesDashboard,
    "SalesDataAdmin": SalesDataAdmin,
    "Settings": Settings,
    "ShiftBonusManagement": ShiftBonusManagement,
    "ShiftPreferences": ShiftPreferences,
    "Shifts": Shifts,
    "ShippingProviders": ShippingProviders,
    "SupplierProducts": SupplierProducts,
    "SuppliersManagement": SuppliersManagement,
    "SyncManagement": SyncManagement,
    "TargetBonusManagement": TargetBonusManagement,
    "TechnicianReport": TechnicianReport,
    "Tickets": Tickets,
    "TodaysCalls": TodaysCalls,
    "VendorReport": VendorReport,
    "WeeklySchedule": WeeklySchedule,
    "WhatsAppDebug": WhatsAppDebug,
    "WhatsAppProviders": WhatsAppProviders,
    "ShipmentLabelPreview": ShipmentLabelPreview,
    "GetPackageSettings": GetPackageSettings,
}

export const pagesConfig = {
    mainPage: "AgentCommissionAssignment",
    Pages: PAGES,
    Layout: __Layout,
};