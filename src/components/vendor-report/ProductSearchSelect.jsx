import React, { useState, useEffect, useRef } from 'react';
import { Input } from "@/components/ui/input";
import { base44 } from '@/api/base44Client';
import { Loader2, Search, Package, Check, X } from 'lucide-react';
import _ from 'lodash';

// Catalog-only picker over the WooCommerce product catalog.
// A product is only "selected" when a catalog result is clicked → onSelect(product).
// Typing after a selection clears it (onClear) so free text can never be submitted.
export default function ProductSearchSelect({ selected, onSelect, onClear }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const runSearch = useRef(
    _.debounce(async (t) => {
      if (!t || t.trim().length < 2) {
        setResults([]);
        setLoading(false);
        return;
      }
      const found = await base44.entities.Product.filter(
        { name: { $regex: t.trim(), $options: 'i' } },
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

  const handleChange = (t) => {
    setTerm(t);
    if (selected) onClear();
    setOpen(true);
    setLoading(true);
    runSearch(t);
  };

  const handlePick = (product) => {
    onSelect(product);
    setTerm('');
    setOpen(false);
    setResults([]);
  };

  // Locked-in state: show the chosen product as a chip with a clear button.
  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 border border-green-300 bg-green-50 rounded-md px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
          <span className="text-sm text-gray-800 truncate">{selected.name}</span>
          {selected.sku && <span className="text-xs text-gray-500 flex-shrink-0">({selected.sku})</span>}
        </div>
        <button type="button" onClick={onClear} className="text-gray-400 hover:text-red-500 flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <Input
          className="pr-9"
          placeholder="חפש מוצר מהקטלוג"
          value={term}
          onChange={e => handleChange(e.target.value)}
          onFocus={() => term.trim().length >= 2 && setOpen(true)}
        />
      </div>
      {open && (loading || results.length > 0 || term.trim().length >= 2) && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-3 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> מחפש...
            </div>
          )}
          {!loading && results.length === 0 && (
            <div className="py-3 text-center text-sm text-gray-400">לא נמצאו מוצרים</div>
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
                {p.sku && <span className="text-xs text-gray-400 flex-shrink-0">({p.sku})</span>}
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