import { base44 } from '@/api/base44Client';

export async function getEmployeeDirectory(params = {}) {
  const response = await base44.functions.invoke('employeeDirectory', params);
  return response?.data?.employees || [];
}