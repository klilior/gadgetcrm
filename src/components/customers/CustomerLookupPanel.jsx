import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, UserCheck, Phone, MapPin } from "lucide-react";
import { customersService } from "@/components/utils/customersService";

const digitsOnly = (value = "") => String(value).replace(/\D/g, "");

export function buildCustomerNote(customer) {
  if (!customer) return "";
  return [
    "פרטי לקוח קיימים:",
    customer.full_name ? `שם: ${customer.full_name}` : null,
    customer.phone ? `טלפון: ${customer.phone}` : null,
    customer.email ? `אימייל: ${customer.email}` : null,
    customer.city ? `עיר: ${customer.city}` : null,
    customer.full_address ? `כתובת: ${customer.full_address}` : null,
    customer.customer_tier ? `דרגת לקוח: ${customer.customer_tier}` : null,
    customer.total_orders ? `הזמנות: ${customer.total_orders}` : null,
    customer.total_repairs ? `תיקונים: ${customer.total_repairs}` : null,
    customer.last_tracking_number ? `מעקב אחרון: ${customer.last_tracking_number}` : null,
  ].filter(Boolean).join("\n");
}

export function customerToShipmentData(customer) {
  return {
    name: customer?.full_name || "",
    phone: customer?.phone || "",
    city: customer?.city || "",
    address: customer?.full_address || "",
    email: customer?.email || "",
    customer,
  };
}

export default function CustomerLookupPanel({ phoneValue = "", onSelect, compact = false }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const normalizedPhone = useMemo(() => digitsOnly(phoneValue), [phoneValue]);

  const runSearch = async (value) => {
    const term = (value || "").trim();
    const phone = digitsOnly(term);
    if (term.length < 2 && phone.length < 7) return;
    setLoading(true);
    const list = await customersService.search({
      query: term,
      phone: phone.length >= 7 ? phone : undefined,
      email: term.includes("@") ? term : undefined,
    }, 8);
    setResults(list || []);
    setLoading(false);
  };

  useEffect(() => {
    if (normalizedPhone.length < 7) return;
    const timer = setTimeout(async () => {
      setLoading(true);
      const list = await customersService.search({ phone: normalizedPhone }, 5);
      setResults(list || []);
      if (list?.length === 1) {
        setSelectedId(list[0].id);
        onSelect?.(list[0]);
      }
      setLoading(false);
    }, 450);
    return () => clearTimeout(timer);
  }, [normalizedPhone]);

  const chooseCustomer = (customer) => {
    setSelectedId(customer.id);
    onSelect?.(customer);
  };

  return (
    <Card className={compact ? "border-blue-100 bg-blue-50/60" : "border-indigo-100 bg-white shadow-sm"}>
      <CardContent className={compact ? "p-3 space-y-2" : "p-4 space-y-3"}>
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(query); } }}
            placeholder="חיפוש לקוח לפי שם, טלפון, עיר, אימייל או כתובת"
            className="bg-white"
          />
          <Button type="button" onClick={() => runSearch(query)} disabled={loading} className="shrink-0">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            חפש
          </Button>
        </div>

        {loading && <div className="text-xs text-gray-500">מחפש לקוח...</div>}

        {results.length > 0 && (
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {results.map((customer) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => chooseCustomer(customer)}
                className={`w-full text-right rounded-xl border p-3 bg-white hover:border-indigo-300 hover:shadow-sm transition-all ${selectedId === customer.id ? "border-green-400 ring-2 ring-green-100" : "border-gray-100"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-gray-900 flex items-center gap-2">
                      {selectedId === customer.id && <UserCheck className="w-4 h-4 text-green-600" />}
                      {customer.full_name || "לקוח ללא שם"}
                    </div>
                    <div className="text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-1 mt-1">
                      {customer.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{customer.phone}</span>}
                      {(customer.city || customer.full_address) && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{customer.city || customer.full_address}</span>}
                    </div>
                  </div>
                  {customer.customer_tier && <Badge variant="outline">{customer.customer_tier}</Badge>}
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}