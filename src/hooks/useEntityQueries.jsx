import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { customersService } from '@/components/utils/customersService';

// Customers — used by Tickets, RepairDashboard, Customers, Orders
export function useCustomersQuery(options = {}) {
  return useQuery({
    queryKey: ['customers'],
    queryFn: () => customersService.list(),
    staleTime: 5 * 60 * 1000,     // 5 min
    gcTime: 10 * 60 * 1000,
    ...options,
  });
}

// Tickets
export function useTicketsQuery(limit = 200, options = {}) {
  return useQuery({
    queryKey: ['tickets', limit],
    queryFn: () => base44.entities.Ticket.list('-updated_date', limit).catch(() => []),
    staleTime: 60 * 1000,         // 1 min
    gcTime: 5 * 60 * 1000,
    ...options,
  });
}

// Orders
export function useOrdersQuery(limit = 200, options = {}) {
  return useQuery({
    queryKey: ['orders', limit],
    queryFn: () => base44.entities.Order.list('-order_date', limit).catch(() => []),
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    ...options,
  });
}

// SalesTransaction with date filter
export function useSalesTransactionsQuery(dateFrom, dateTo, limit = 2000, options = {}) {
  return useQuery({
    queryKey: ['salesTransactions', dateFrom, dateTo, limit],
    queryFn: () => base44.entities.SalesTransaction.filter(
      { issue_date: { $gte: dateFrom, $lte: dateTo } },
      '-issue_date',
      limit
    ).catch(() => []),
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    enabled: !!dateFrom && !!dateTo,
    ...options,
  });
}

// Helper to invalidate after mutations
export function useInvalidateEntity(queryKey) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: [queryKey] });
}