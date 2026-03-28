import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Employee } from '@/entities/all';
import { base44 } from '@/api/base44Client';

const EmployeeContext = createContext();

export const useEmployees = () => {
  const context = useContext(EmployeeContext);
  if (!context) {
    // Fallback for components rendered outside provider (e.g. in tests or standalone)
    console.warn('⚠️ useEmployees called outside EmployeeProvider — returning empty data');
    return { employees: [], employeesMap: {}, linetUsersMap: [], isLoading: true, reloadEmployees: async () => {} };
  }
  return context;
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function EmployeeProvider({ children }) {
  const [employees, setEmployees] = useState([]);
  const [linetUsersMap, setLinetUsersMap] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState(0);

  const loadEmployees = useCallback(async (force = false) => {
    if (!force && Date.now() - lastFetch < CACHE_TTL && employees.length > 0) {
      console.log('⏱️ EmployeeProvider: cache hit');
      return employees;
    }
    console.log('🔄 EmployeeProvider: fetching employees + linetUsersMap...');
    const start = Date.now();
    try {
      const [data, linetData] = await Promise.all([
        Employee.filter({ is_active: true }).catch(() => []),
        base44.entities.LinetUsersMap.list(null, 200).catch(() => [])
      ]);
      setEmployees(data || []);
      setLinetUsersMap(linetData || []);
      setLastFetch(Date.now());
      console.log(`✅ EmployeeProvider: loaded ${data?.length || 0} employees, ${linetData?.length || 0} linet maps in ${Date.now() - start}ms`);
      return data || [];
    } catch (err) {
      console.error('❌ EmployeeProvider: failed to load', err);
      return employees;
    } finally {
      setIsLoading(false);
    }
  }, [lastFetch, employees]);

  useEffect(() => {
    loadEmployees();
  }, []);

  const employeesMap = useMemo(() => {
    const map = {};
    employees.forEach(e => { if (e?.id) map[e.id] = e; });
    return map;
  }, [employees]);

  const value = useMemo(() => ({
    employees,
    employeesMap,
    linetUsersMap,
    isLoading,
    reloadEmployees: () => loadEmployees(true),
  }), [employees, employeesMap, linetUsersMap, isLoading, loadEmployees]);

  return (
    <EmployeeContext.Provider value={value}>
      {children}
    </EmployeeContext.Provider>
  );
}