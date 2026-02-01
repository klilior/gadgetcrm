/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import AgentCommissionAssignment from './pages/AgentCommissionAssignment';
import AgentDashboard from './pages/AgentDashboard';
import AgentPerformanceDashboard from './pages/AgentPerformanceDashboard';
import AttendanceClock from './pages/AttendanceClock';
import AttendanceManagerReport from './pages/AttendanceManagerReport';
import AttendanceReport from './pages/AttendanceReport';
import AttendanceSettings from './pages/AttendanceSettings';
import BuildSchedule from './pages/BuildSchedule';
import CarrierManagement from './pages/CarrierManagement';
import CommissionCalculation from './pages/CommissionCalculation';
import CommissionGroupMappings from './pages/CommissionGroupMappings';
import CommissionModels from './pages/CommissionModels';
import CustomerSync from './pages/CustomerSync';
import Customers from './pages/Customers';
import DebugSchedule from './pages/DebugSchedule';
import GoalsDashboard from './pages/GoalsDashboard';
import Home from './pages/Home';
import IntakeInbox from './pages/IntakeInbox';
import InvoicesOverview from './pages/InvoicesOverview';
import InvoicesToReview from './pages/InvoicesToReview';
import LineContractImport from './pages/LineContractImport';
import LineProductMapping from './pages/LineProductMapping';
import LinesToWorkOn from './pages/LinesToWorkOn';
import ManageAttendance from './pages/ManageAttendance';
import ManageEmployees from './pages/ManageEmployees';
import ManagerControlCenter from './pages/ManagerControlCenter';
import ManagerDashboard from './pages/ManagerDashboard';
import MessageCenter from './pages/MessageCenter';
import MobileInvoiceUpload from './pages/MobileInvoiceUpload';
import Orders from './pages/Orders';
import PaymentReturn from './pages/PaymentReturn';
import PaymentSettings from './pages/PaymentSettings';
import PriceAlerts from './pages/PriceAlerts';
import Products from './pages/Products';
import PurchasesDashboard from './pages/PurchasesDashboard';
import RawLinesImport from './pages/RawLinesImport';
import RepairDashboard from './pages/RepairDashboard';
import SalesDashboard from './pages/SalesDashboard';
import SalesDataAdmin from './pages/SalesDataAdmin';
import Settings from './pages/Settings';
import ShiftBonusManagement from './pages/ShiftBonusManagement';
import ShiftPreferences from './pages/ShiftPreferences';
import Shifts from './pages/Shifts';
import ShippingProviders from './pages/ShippingProviders';
import SupplierProducts from './pages/SupplierProducts';
import SuppliersManagement from './pages/SuppliersManagement';
import SyncManagement from './pages/SyncManagement';
import TargetBonusManagement from './pages/TargetBonusManagement';
import TechnicianReport from './pages/TechnicianReport';
import Tickets from './pages/Tickets';
import TodaysCalls from './pages/TodaysCalls';
import VendorReport from './pages/VendorReport';
import WeeklySchedule from './pages/WeeklySchedule';
import WhatsAppDebug from './pages/WhatsAppDebug';
import WhatsAppProviders from './pages/WhatsAppProviders';
import UserRoles from './pages/UserRoles';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AgentCommissionAssignment": AgentCommissionAssignment,
    "AgentDashboard": AgentDashboard,
    "AgentPerformanceDashboard": AgentPerformanceDashboard,
    "AttendanceClock": AttendanceClock,
    "AttendanceManagerReport": AttendanceManagerReport,
    "AttendanceReport": AttendanceReport,
    "AttendanceSettings": AttendanceSettings,
    "BuildSchedule": BuildSchedule,
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
    "Orders": Orders,
    "PaymentReturn": PaymentReturn,
    "PaymentSettings": PaymentSettings,
    "PriceAlerts": PriceAlerts,
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
    "UserRoles": UserRoles,
}

export const pagesConfig = {
    mainPage: "AgentCommissionAssignment",
    Pages: PAGES,
    Layout: __Layout,
};