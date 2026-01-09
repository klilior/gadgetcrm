import { useEffect, useMemo, useState } from 'react';
import { suppliersService } from '../utils/suppliersService';

export default function useSuppliers({ activeOnly = false } = {}) {
  const [suppliersList, setSuppliersList] = useState([]);
  const [loading, setLoading] = useState(true);

  const reloadSuppliers = async () => {
    setLoading(true);
    try {
      const list = await suppliersService.list(activeOnly);
      setSuppliersList(list || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadSuppliers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOnly]);

  const suppliersMap = useMemo(() => suppliersService.toMap(suppliersList), [suppliersList]);

  return { suppliersList, suppliersMap, loading, reloadSuppliers };
}