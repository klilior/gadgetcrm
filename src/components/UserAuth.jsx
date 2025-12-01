import React, { createContext, useContext, useState, useEffect } from "react";
import { Employee } from "@/entities/all";

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

export function UserProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [activeUsers, setActiveUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initializeSystem = async () => {
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
      }
      setIsLoading(false);
    };
    
    initializeSystem();
  }, []);

  const login = async (identifier, password) => {
    try {
      const trimmedIdentifier = identifier.trim();
      const isEmail = trimmedIdentifier.includes('@');
      
      const filter = isEmail 
        ? { email: trimmedIdentifier.toLowerCase() } 
        : { username: trimmedIdentifier.toUpperCase() };

      console.log('🔐 Attempting login with filter:', filter);

      const employees = await retryApiCall(() => 
        Employee.filter(filter)
      );
      
      if (employees.length === 0) {
        return { success: false, error: "משתמש לא נמצא" };
      }
      
      const user = employees[0];
      if (user.password_hash !== password) {
        return { success: false, error: "סיסמה שגויה" };
      }

      if (!user.is_active) {
        return { success: false, error: "המשתמש אינו פעיל" };
      }

      if (user.role === 'מנהל') {
        setCurrentUser(user);
        setActiveUsers([]);
        localStorage.setItem("managerId", user.id);
        localStorage.removeItem("activeShiftUsers");
        localStorage.removeItem("currentUserId");
        
        await retryApiCall(() => 
          Employee.update(user.id, { last_login: new Date().toISOString() })
        );
        return { success: true };
      }

      const existingUserIndex = activeUsers.findIndex(u => u.id === user.id);
      let updatedActiveUsers;
      
      if (existingUserIndex >= 0) {
        updatedActiveUsers = [...activeUsers];
      } else {
        if (activeUsers.length >= 5) {
          return { success: false, error: "הגעת למקסימום משתמשים במשמרת (5)" };
        }
        updatedActiveUsers = [...activeUsers, user];
      }
      
      setActiveUsers(updatedActiveUsers);
      setCurrentUser(user);
      localStorage.setItem("activeShiftUsers", JSON.stringify(updatedActiveUsers));
      localStorage.setItem("currentUserId", user.id);
      localStorage.removeItem("managerId");
      
      await retryApiCall(() => 
        Employee.update(user.id, { last_login: new Date().toISOString() })
      );
      
      return { success: true };
    } catch (error) {
      console.error("Login error:", error);
      return { 
        success: false, 
        error: error.message === "Network Error" 
          ? "שגיאת רשת - בדוק את החיבור לאינטרנט"
          : "שגיאת מערכת בהתחברות" 
      };
    }
  };

  const switchUser = (userId) => {
    const user = activeUsers.find(u => u.id === userId);
    if (user) {
      setCurrentUser(user);
      localStorage.setItem("currentUserId", user.id);
    }
  };

  const removeUserFromShift = (userId) => {
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
  };

  const endShift = () => {
    setCurrentUser(null);
    setActiveUsers([]);
    localStorage.removeItem("currentUserId");
    localStorage.removeItem("activeShiftUsers");
    localStorage.removeItem("managerId");
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
      isLoading 
    }}>
      {children}
    </UserContext.Provider>
  );
}