import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  Phone, Ticket, Users, Package, BarChart3, Wrench,
  Settings, MessageCircle, LogOut, UserPlus,
  ChevronDown, Clock, FileText, Briefcase,
  CreditCard, Trophy, Home, CalendarDays, Receipt, X, Menu, Truck
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
import { EmployeeProvider } from "./components/EmployeeProvider";
import AddUserModal from "./components/AddUserModal";
import PaymentModal from "./components/payments/PaymentModal";
import QuickLeadButton from "./components/leads/QuickLeadButton";
import IncomingCallPopup from "./components/calls/IncomingCallPopup";

// NOTE: This is a pre-Stage-6ב backup. The live Layout.jsx adds one manager-only
// nav item ("השלמת תיקונים ריקים" -> BackfillEmptyRepairs) after the VendorReport item.
// Restore this file to revert that navigation change.

// Compact menu item component
const MenuItem = React.memo(function MenuItem({ item, isActive, onClick }) {
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
});

// See live Layout.jsx for the full implementation. This backup captures the
// mainItems block prior to adding the BackfillEmptyRepairs manager link:
//   ...(isManager ? [{ title: "דוח התחשבנות מעבדה", url: createPageUrl("VendorReport"), icon: FileText }] : []),