import React, { useState, useEffect, useRef } from 'react';
import { Input } from "@/components/ui/input";
import { base44 } from '@/api/base44Client';
import { Loader2, Search, Package } from 'lucide-react';
import _ from 'lodash';

// Searchable picker over the WooCommerce product catalog.
// Calls onSelect({ name, price }) when a catalog item is chosen.
// Also reports free-typed text via onTextChange so manual entry still works.
export default function ProductSearchSelect({ value, onTextChange, onSelect }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const runSearch = useRef(
    _.debounce(async (term) => {
      if (!term || term.trim().length < 2) {
        setResults([]);
        setLoading(false);
        return;
      }
      const found = await base44.entities.Product.filter(
        { name: { $regex: term.trim(), $options: 'i' } },
        '-date_modified',
        15
      );
      setResults(found || []);
      setLoading(false);
    }, 300)
  ).current;

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleChange = (term) => {
    onTextChange(term);
    setOpen(true);
    setLoading(true);
    runSearch(term);
  };

  const handlePick = (product) => {
    const price = parseFloat(product.price || product.regular_price || 0) || 0;
    onSelect({ name: product.name, price });
    setOpen(false);
    setResults([]);
  };

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <Input
          className="pr-9"
          placeholder="חפש מוצר מהקטלוג או הקלד ידנית"
          value={value}
          onChange={e => handleChange(e.target.value)}
          onFocus={() => value && value.trim().length >= 2 && setOpen(true)}
        />
      </div>
      {open && (loading || results.length > 0) && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-3 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> מחפש...
            </div>
          )}
          {!loading && results.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => handlePick(p)}
              className="flex items-center justify-between w-full px-3 py-2 text-right hover:bg-purple-50 border-b border-gray-100 last:border-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Package className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="text-sm text-gray-800 truncate">{p.name}</span>
              </div>
              <span className="text-xs text-purple-600 font-semibold flex-shrink-0">
                ₪{(parseFloat(p.price || p.regular_price || 0) || 0).toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}