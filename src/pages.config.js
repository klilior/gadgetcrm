import AgentConsole from './pages/AgentConsole';
import Settings from './pages/Settings';
import TodaysCalls from './pages/TodaysCalls';
import Tickets from './pages/Tickets';
import Customers from './pages/Customers';
import Shifts from './pages/Shifts';
import ManagerDashboard from './pages/ManagerDashboard';
import ManageEmployees from './pages/ManageEmployees';
import ShiftPreferences from './pages/ShiftPreferences';
import BuildSchedule from './pages/BuildSchedule';
import WeeklySchedule from './pages/WeeklySchedule';
import RepairDashboard from './pages/RepairDashboard';
import TechnicianReport from './pages/TechnicianReport';
import VendorReport from './pages/VendorReport';
import WhatsAppProviders from './pages/WhatsAppProviders';
import Orders from './pages/Orders';
import AttendanceClock from './pages/AttendanceClock';
import AttendanceSettings from './pages/AttendanceSettings';
import MessageCenter from './pages/MessageCenter';
import AttendanceReport from './pages/AttendanceReport';
import ManageAttendance from './pages/ManageAttendance';
import AttendanceManagerReport from './pages/AttendanceManagerReport';
import PaymentSettings from './pages/PaymentSettings';
import DebugSchedule from './pages/DebugSchedule';
import WhatsAppDebug from './pages/WhatsAppDebug';
import ShippingProviders from './pages/ShippingProviders';
import PaymentReturn from './pages/PaymentReturn';
import Products from './pages/Products';
import SalesDashboard from './pages/SalesDashboard';
import SalesDataAdmin from './pages/SalesDataAdmin';
import Home from './pages/Home';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AgentConsole": AgentConsole,
    "Settings": Settings,
    "TodaysCalls": TodaysCalls,
    "Tickets": Tickets,
    "Customers": Customers,
    "Shifts": Shifts,
    "ManagerDashboard": ManagerDashboard,
    "ManageEmployees": ManageEmployees,
    "ShiftPreferences": ShiftPreferences,
    "BuildSchedule": BuildSchedule,
    "WeeklySchedule": WeeklySchedule,
    "RepairDashboard": RepairDashboard,
    "TechnicianReport": TechnicianReport,
    "VendorReport": VendorReport,
    "WhatsAppProviders": WhatsAppProviders,
    "Orders": Orders,
    "AttendanceClock": AttendanceClock,
    "AttendanceSettings": AttendanceSettings,
    "MessageCenter": MessageCenter,
    "AttendanceReport": AttendanceReport,
    "ManageAttendance": ManageAttendance,
    "AttendanceManagerReport": AttendanceManagerReport,
    "PaymentSettings": PaymentSettings,
    "DebugSchedule": DebugSchedule,
    "WhatsAppDebug": WhatsAppDebug,
    "ShippingProviders": ShippingProviders,
    "PaymentReturn": PaymentReturn,
    "Products": Products,
    "SalesDashboard": SalesDashboard,
    "SalesDataAdmin": SalesDataAdmin,
    "Home": Home,
}

export const pagesConfig = {
    mainPage: "AgentConsole",
    Pages: PAGES,
    Layout: __Layout,
};