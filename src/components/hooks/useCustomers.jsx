import { useEffect, useMemo, useState } from 'react';
import { customersService } from '../utils/customersService';

export default function useCustomers() {
  const [customersList, setCustomersList] = useState([]);
  const [loading, setLoading] = useState(true);

  const reloadCustomers = async () => {
    setLoading(true);
    try {
      const list = await customersService.list();
      setCustomersList(list || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadCustomers();
  }, []);

  const customersMap = useMemo(() => customersService.toMap(customersList), [customersList]);

  return { customersList, customersMap, loading, reloadCustomers };
}