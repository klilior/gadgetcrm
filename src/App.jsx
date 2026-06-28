import './App.css'
import React, { Suspense } from 'react'
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import SuperPharmOrdersPage from './pages/SuperPharmOrdersPage';
import UnifiedOrders from './pages/UnifiedOrders';
import Shipments from './pages/Shipments';
import MiraklInvoiceBatch from './pages/MiraklInvoiceBatch';
import QuickInvoiceUpload from './pages/QuickInvoiceUpload';
import LinetDebug from './pages/LinetDebug';
import SerialLiveTest from './pages/SerialLiveTest';
import { queryClientInstance } from '@/lib/query-client'
import VisualEditAgent from '@/lib/VisualEditAgent'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LazyFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
    <div className="text-center">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin mx-auto mb-3"></div>
      <p className="text-gray-600 text-sm">טוען...</p>
    </div>
  </div>
);

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>
    <Suspense fallback={<LazyFallback />}>{children}</Suspense>
  </Layout>
  : <Suspense fallback={<LazyFallback />}>{children}</Suspense>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated, navigateToLogin } = useAuth();
  const normalizedPath = window.location.pathname.toLowerCase();
  const isQuickInvoiceUpload = normalizedPath === '/quickinvoiceupload';
  const isSerialLiveTest = normalizedPath === '/seriallivetest';

  if (isQuickInvoiceUpload) {
    return <QuickInvoiceUpload />;
  }

  if (isSerialLiveTest) {
    return <SerialLiveTest />;
  }

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <MainPage />
        </LayoutWrapper>
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="/SuperPharmOrders" element={
        <LayoutWrapper currentPageName="SuperPharmOrders">
          <Suspense fallback={<LazyFallback />}><SuperPharmOrdersPage /></Suspense>
        </LayoutWrapper>
      } />
      <Route path="/UnifiedOrders" element={
        <LayoutWrapper currentPageName="UnifiedOrders">
          <Suspense fallback={<LazyFallback />}><UnifiedOrders /></Suspense>
        </LayoutWrapper>
      } />
      <Route path="/Shipments" element={
        <LayoutWrapper currentPageName="Shipments">
          <Suspense fallback={<LazyFallback />}><Shipments /></Suspense>
        </LayoutWrapper>
      } />
      <Route path="/MiraklInvoiceBatch" element={
        <LayoutWrapper currentPageName="MiraklInvoiceBatch">
          <Suspense fallback={<LazyFallback />}><MiraklInvoiceBatch /></Suspense>
        </LayoutWrapper>
      } />
      <Route path="/QuickInvoiceUpload" element={<QuickInvoiceUpload />} />
      <Route path="/quickinvoiceupload" element={<QuickInvoiceUpload />} />
      <Route path="/LinetDebug" element={<LinetDebug />} />
      <Route path="/linетdebug" element={<LinetDebug />} />
      <Route path="/SerialLiveTest" element={<SerialLiveTest />} />
      <Route path="/seriallivetest" element={<SerialLiveTest />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <NavigationTracker />
          <AuthenticatedApp />
        </Router>
        <Toaster />
        <VisualEditAgent />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App