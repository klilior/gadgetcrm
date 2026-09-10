import React, { createContext, useContext, useState, useEffect } from "react";
import { Employee } from "@/entities/all";
import { base44 } from "@/api/base44Client";

const UserContext = createContext();

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
};

// Helper function for retrying API calls
const retryApiCall = async (fn, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      console.log(`⚠️ Attempt ${i + 1} failed:`, error.message);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

const SESSION_TIMEOUT_MS = 90 * 60 * 1000; // 90 minutes in milliseconds
const WHATSAPP_SESSION_STORAGE_KEY = "whatsappSessionTokens";

const readWhatsappSessionTokens = () => {
  try {
    return JSON.parse(sessionStorage.getItem(WHATSAPP_SESSION_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
};

const saveWhatsappSessionToken = (userId, token) => {
  if (!userId || !token) return;
  const tokens = readWhatsappSessionTokens();
  tokens[userId] = token;
  sessionStorage.setItem(WHATSAPP_SESSION_STORAGE_KEY, JSON.stringify(tokens));
};

const removeWhatsappSessionToken = (userId) => {
  const tokens = readWhatsappSessionTokens();
  delete tokens[userId];
  sessionStorage.setItem(WHATSAPP_SESSION_STORAGE_KEY, JSON.stringify(tokens));
};

export function UserProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [activeUsers, setActiveUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Check if session has expired
  const isSessionExpired = () => {
    const lastActivity = localStorage.getItem("lastActivityTime");
    if (!lastActivity) return true;
    return Date.now() - parseInt(lastActivity) > SESSION_TIMEOUT_MS;
  };

  // Update last activity time
  const updateLastActivity = () => {
    localStorage.setItem("lastActivityTime", Date.now().toString());
  };

  // Clear session on expiry
  const clearExpiredSession = () => {
    localStorage.removeItem("currentUserId");
    localStorage.removeItem("activeShiftUsers");
    localStorage.removeItem("managerId");
    localStorage.removeItem("lastActivityTime");
    sessionStorage.removeItem(WHATSAPP_SESSION_STORAGE_KEY);
    setCurrentUser(null);
    setActiveUsers([]);
  };

  useEffect(() => {
    const initializeSystem = async () => {
      // Check if session expired due to inactivity
      if (isSessionExpired()) {
        console.log('⏰ Session expired due to 90 minutes inactivity');
        clearExpiredSession();
        setIsLoading(false);
        return;
      }

      const savedActiveUsers = localStorage.getItem("activeShiftUsers");
      const savedCurrentUserId = localStorage.getItem("currentUserId");
      const savedManagerId = localStorage.getItem("managerId");
      
      if (savedManagerId) {
        try {
          const managers = await retryApiCall(() => 
            Employee.filter({ id: savedManagerId })
          );
          if (managers.length > 0 && managers[0].role === 'מנהל') {
            setCurrentUser(managers[0]);
            updateLastActivity();
            setIsLoading(false);
            return;
          }
        } catch (error) {
          console.error("Error loading manager:", error);
        }
        localStorage.removeItem("managerId");
      }
      
      if (savedActiveUsers) {
        const users = JSON.parse(savedActiveUsers);
        setActiveUsers(users);
        
        if (savedCurrentUserId) {
          const user = users.find(u => u.id === savedCurrentUserId);
          setCurrentUser(user || users[0]);
        } else if (users.length > 0) {
          setCurrentUser(users[0]);
        }
        updateLastActivity();
      } else {
        // No local shift session -> use Base44 auth and app_role if available
        try {
          const isAuth = await base44.auth.isAuthenticated();
          console.log('[UserAuth] isAuthenticated:', isAuth);
          if (isAuth) {
            const me = await base44.auth.me();
            console.log('[UserAuth] me() returned:', { id: me?.id, email: me?.email, role: me?.role, data: me?.data });
            
            let emp = null;
            try {
              console.log('[UserAuth] Looking for Employee with email:', me.email);
              const emps = await retryApiCall(() => Employee.filter({ email: me.email }));
              console.log('[UserAuth] Employee.filter result:', emps?.length, 'records');
              emp = (emps || [])[0] || null;
              if (emp) {
                console.log('[UserAuth] Found Employee:', { id: emp.id, name: emp.employee_name, role: emp.role });
              }
            } catch (empErr) {
              console.error('[UserAuth] Employee.filter error:', empErr);
            }
            
            // Priority: 1) Employee.role (most accurate)  2) User.data.app_role  3) fallback 'נציג'
            const roleFromEmployee = emp?.role;
            const roleFromUserData = me?.data?.app_role || me?.app_role;
            const finalRole = roleFromEmployee || roleFromUserData || 'נציג';
            
            console.log('[UserAuth] Role resolution:', { roleFromEmployee, roleFromUserData, finalRole });
            
            const derived = emp ? {
              ...emp,
              app_role: finalRole,
              role: finalRole,
            } : {
              id: me.id,
              employee_name: me.full_name || me.email,
              role: finalRole,
              app_role: finalRole,
              email: me.email,
              is_active: true,
            };
            console.log('[UserAuth] Final currentUser:', { id: derived.id, name: derived.employee_name, role: derived.role, app_role: derived.app_role });
            setCurrentUser(derived);
            updateLastActivity();
          }
        } catch (e) {
          console.error('[UserAuth] Auth check failed:', e);
        }
      }
      setIsLoading(false);
    };
    
    initializeSystem();
  }, []);

  // Track user activity and check for session expiry
  useEffect(() => {
    if (!currentUser) return;

    // Update activity on user interactions
    const handleActivity = () => {
      updateLastActivity();
    };

    // Check for session expiry periodically (every 5 minutes)
    const checkInterval = setInterval(() => {
      if (isSessionExpired()) {
        console.log('⏰ Session expired - logging out');
        clearExpiredSession();
      }
    }, 5 * 60 * 1000);

    // Listen for user activity
    window.addEventListener('click', handleActivity);
    window.addEventListener('keypress', handleActivity);
    window.addEventListener('scroll', handleActivity);
    window.addEventListener('mousemove', handleActivity);

    return () => {
      clearInterval(checkInterval);
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('keypress', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      window.removeEventListener('mousemove', handleActivity);
    };
  }, [currentUser]);

  const login = async (identifier, password) => {
    try {
      const trimmedIdentifier = identifier.trim();

      const response = await retryApiCall(() =>
        base44.functions.invoke('issue-whatsapp-session', {
          identifier: trimmedIdentifier,
          password
        })
      );
      const authData = response?.data || response;
      const user = authData?.employee;

      if (!user?.id || !authData?.session_token) {
        return { success: false, error: "שגיאת מערכת בהתחברות" };
      }

      saveWhatsappSessionToken(user.id, authData.session_token);

      if (user.role === 'מנהל') {
        setCurrentUser(user);
        setActiveUsers([]);
        localStorage.setItem("managerId", user.id);
        localStorage.removeItem("activeShiftUsers");
        localStorage.removeItem("currentUserId");
        updateLastActivity();
        return { success: true };
      }

      const existingUserIndex = activeUsers.findIndex(u => u.id === user.id);
      let updatedActiveUsers;

      if (existingUserIndex >= 0) {
        updatedActiveUsers = activeUsers.map(u => u.id === user.id ? user : u);
      } else {
        if (activeUsers.length >= 5) {
          removeWhatsappSessionToken(user.id);
          return { success: false, error: "הגעת למקסימום משתמשים במשמרת (5)" };
        }
        updatedActiveUsers = [...activeUsers, user];
      }

      setActiveUsers(updatedActiveUsers);
      setCurrentUser(user);
      localStorage.setItem("activeShiftUsers", JSON.stringify(updatedActiveUsers));
      localStorage.setItem("currentUserId", user.id);
      localStorage.removeItem("managerId");
      updateLastActivity();

      return { success: true };
    } catch (error) {
      console.error("Login error:", error);
      const serverMessage = error?.response?.data?.error || error?.data?.error;
      return {
        success: false,
        error: serverMessage || (error.message === "Network Error"
          ? "שגיאת רשת - בדוק את החיבור לאינטרנט"
          : "שם המשתמש או הסיסמה שגויים")
      };
    }
  };

  const getWhatsappSessionToken = (userId = currentUser?.id) => {
    if (!userId) return "";
    return readWhatsappSessionTokens()[userId] || "";
  };

  const switchUser = (userId) => {
    const user = activeUsers.find(u => u.id === userId);
    if (user) {
      setCurrentUser(user);
      localStorage.setItem("currentUserId", user.id);
    }
  };

  const removeUserFromShift = (userId) => {
    removeWhatsappSessionToken(userId);
    const updatedUsers = activeUsers.filter(u => u.id !== userId);
    setActiveUsers(updatedUsers);
    
    if (currentUser?.id === userId) {
      if (updatedUsers.length > 0) {
        setCurrentUser(updatedUsers[0]);
        localStorage.setItem("currentUserId", updatedUsers[0].id);
      } else {
        setCurrentUser(null);
        localStorage.removeItem("currentUserId");
      }
    }
    
    localStorage.setItem("activeShiftUsers", JSON.stringify(updatedUsers));
  };

  const logout = () => {
    setCurrentUser(null);
    setActiveUsers([]);
    localStorage.removeItem("currentUserId");
    localStorage.removeItem("activeShiftUsers");
    localStorage.removeItem("managerId");
    localStorage.removeItem("lastActivityTime");
    sessionStorage.removeItem(WHATSAPP_SESSION_STORAGE_KEY);
  };

  const endShift = () => {
    setCurrentUser(null);
    setActiveUsers([]);
    localStorage.removeItem("currentUserId");
    localStorage.removeItem("activeShiftUsers");
    localStorage.removeItem("managerId");
    localStorage.removeItem("lastActivityTime");
    sessionStorage.removeItem(WHATSAPP_SESSION_STORAGE_KEY);
  };

  return (
    <UserContext.Provider value={{ 
      currentUser, 
      activeUsers,
      login, 
      logout,
      switchUser,
      removeUserFromShift,
      endShift,
      getWhatsappSessionToken,
      isLoading 
    }}>
      {children}
    </UserContext.Provider>
  );
}