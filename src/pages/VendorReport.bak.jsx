import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Loader2, HandCoins, TrendingUp, Wrench, Package, Edit, Save, X, PackageMinus, Plus, Trash2, Banknote } from 'lucide-react';
import VendorStatsCards from '../components/vendor-report/VendorStatsCards';
import { format, parseISO } from 'date-fns';
import { he } from 'date-fns/locale';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useUser } from '../components/UserAuth';
import AddLabCreditModal from '../components/repairs/AddLabCreditModal';
import AddLabPaymentModal from '../components/repairs/AddLabPaymentModal';
import RepairDetailsModal from '../components/repairs/RepairDetailsModal';

export default function VendorReport() {
  const { currentUser } = useUser();
  const [repairs, setRepairs] = useState([]);
  const [labCredits, setLabCredits] = useState([]);
  const [labPayments, setLabPayments] = useState([]);
  const [clientsMap, setClientsMap] = useState({});
  const [techniciansMap, setTechniciansMap] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [editingRepairId, setEditingRepairId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [editingCreditId, setEditingCreditId] = useState(null);
  const [editCreditValues, setEditCreditValues] = useState({});
  const [showAddCredit, setShowAddCredit] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [selectedRepair, setSelectedRepair] = useState(null);
  const [editingPaymentId, setEditingPaymentId] = useState(null);
  const [editPaymentValues, setEditPaymentValues] = useState({});

  const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';
  const isShiftManager = currentUser?.role === 'מנהל משמרת';
  const isTechnician = currentUser?.role === 'טכנאי';
  const canAddCredit = isManager || isShiftManager;
  const canEditAll = isManager || isShiftManager;

  useEffect(() => {
    loadData();
  }, [currentUser]);

  const loadData = async () => {
    setIsLoading(true);
    let closedRepairs = [], credits = [], payments = [];
    try {
      [closedRepairs, credits, payments] = await Promise.all([
        base44.entities.Repair.filter({ repair_type: "מעבדת Gadget-Team", status: { $in: ["תיקון נסגר", "מכשיר סיים תיקון וממתין לאיסוף"] } }, "-updated_date", 500),
        base44.entities.LabCredit.list('-created_date', 500),
        base44.entities.LabPayment.list('-created_date', 500)
      ]);
    } catch (err) {
      console.error("Error loading vendor report data:", err);
    }
    console.log(`📊 VendorReport loaded: ${closedRepairs.length} repairs, ${credits.length} credits, ${payments.length} payments`);

    if (closedRepairs.length > 0) {
      const clientIds = [...new Set(closedRepairs.map(r => r.client_id).filter(Boolean))];
      const techIds = [...new Set(closedRepairs.map(r => r.technician_id).filter(Boolean))];
      const [clients, technicians] = await Promise.all([
        clientIds.length ? base44.entities.Client.filter({ id: { $in: clientIds } }) : [],
        techIds.length ? base44.entities.Employee.filter({ id: { $in: techIds } }) : []
      ]);
      setClientsMap(clients.reduce((acc, c) => ({ ...acc, [c.id]: c }), {}));
      setTechniciansMap(technicians.reduce((acc, t) => ({ ...acc, [t.id]: t }), {}));
    }

    setRepairs(closedRepairs);
    setLabCredits(credits);
    setLabPayments(payments);
    setIsLoading(false);
  };

  // Group repairs by month
  const monthlyData = useMemo(() => {
    const groups = {};
    repairs.forEach(r => {
      const monthKey = format(parseISO(r.updated_date), 'yyyy-MM');
      if (!groups[monthKey]) groups[monthKey] = { repairs: [], credits: [], payments: [] };
      groups[monthKey].repairs.push(r);
    });
    labCredits.forEach(c => {
      const dateStr = c.taken_date || c.created_date;
      const monthKey = format(parseISO(dateStr), 'yyyy-MM');
      if (!groups[monthKey]) groups[monthKey] = { repairs: [], credits: [], payments: [] };
      groups[monthKey].credits.push(c);
    });
    labPayments.forEach(p => {
      const monthKey = format(parseISO(p.payment_date || p.created_date), 'yyyy-MM');
      if (!groups[monthKey]) groups[monthKey] = { repairs: [], credits: [], payments: [] };
      groups[monthKey].payments.push(p);
    });
    return groups;
  }, [repairs, labCredits, labPayments]);

  const sortedMonths = useMemo(() => Object.keys(monthlyData).sort().reverse(), [monthlyData]);

  // Calculate stats per month
  const getMonthStats = (month) => {
    const data = monthlyData[month];
    let totalRevenue = 0, totalLabPayment = 0, totalCredits = 0, totalPaid = 0;
    data.repairs.forEach(r => {
      const fp = r.final_price || 0;
      const pc = r.part_cost || 0;
      const gross = fp - pc;
      const lab = (gross / 2) + pc;
      totalRevenue += fp;
      totalLabPayment += lab;
    });
    data.credits.forEach(c => {
      totalCredits += c.amount || 0;
    });
    data.payments.forEach(p => {
      totalPaid += p.amount || 0;
    });
    const netOwed = totalLabPayment - totalCredits - totalPaid;
    return { totalRevenue, totalLabPayment, totalCredits, totalPaid, netOwed, netProfit: totalRevenue - (totalLabPayment - totalCredits) };
  };

  // Repair edit handlers
  const handleEdit = (repair) => {
    setEditingRepairId(repair.id);
    setEditValues({ final_price: repair.final_price || 0, part_cost: repair.part_cost || 0 });
  };
  const handleSave = async (repair) => {
    await base44.entities.Repair.update(repair.id, {
      final_price: parseFloat(editValues.final_price),
      part_cost: parseFloat(editValues.part_cost)
    });
    setEditingRepairId(null);
    setEditValues({});
    loadData();
  };
  const handleCancel = () => { setEditingRepairId(null); setEditValues({}); };

  // Credit edit handlers
  const handleEditCredit = (credit) => {
    setEditingCreditId(credit.id);
    setEditCreditValues({ taken_by: credit.taken_by, product_description: credit.product_description, amount: credit.amount, notes: credit.notes || '' });
  };
  const handleSaveCredit = async (credit) => {
    await base44.entities.LabCredit.update(credit.id, {
      taken_by: editCreditValues.taken_by,
      product_description: editCreditValues.product_description,
      amount: parseFloat(editCreditValues.amount),
      notes: editCreditValues.notes
    });
    setEditingCreditId(null);
    setEditCreditValues({});
    loadData();
  };
  const handleCancelCredit = () => { setEditingCreditId(null); setEditCreditValues({}); };
  const handleDeleteCredit = async (id) => {
    if (!confirm('למחוק רשומה זו?')) return;
    await base44.entities.LabCredit.delete(id);
    loadData();
  };

  // Payment edit handlers
  const handleEditPayment = (p) => {
    setEditingPaymentId(p.id);
    setEditPaymentValues({ amount: p.amount, payment_type: p.payment_type, notes: p.notes || '' });
  };
  const handleSavePayment = async (p) => {
    await base44.entities.LabPayment.update(p.id, {
      amount: parseFloat(editPaymentValues.amount),
      payment_type: editPaymentValues.payment_type,
      notes: editPaymentValues.notes
    });
    setEditingPaymentId(null);
    setEditPaymentValues({});
    loadData();
  };
  const handleCancelPayment = () => { setEditingPaymentId(null); setEditPaymentValues({}); };
  const handleDeletePayment = async (id) => {
    if (!confirm('למחוק תשלום זה?')) return;
    await base44.entities.LabPayment.delete(id);
    loadData();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-12 h-12 text-purple-600 animate-spin" />
          <p className="text-lg text-gray-600">טוען דוח התחשבנות...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">דוח התחשבנות מעבדת Gadget-Team</h1>
        <div className="flex gap-2 flex-wrap">
          {canAddCredit && (
            <>
              <Button onClick={() => setShowAddPayment(true)} className="bg-green-600 hover:bg-green-700 gap-2">
                <Banknote className="w-4 h-4" />
                רישום תשלום
              </Button>
              <Button onClick={() => setShowAddCredit(true)} className="bg-orange-600 hover:bg-orange-700 gap-2">
                <Plus className="w-4 h-4" />
                רישום מוצר שנלקח
              </Button>
            </>
          )}
          {!canAddCredit && (
            <Badge variant="secondary" className="text-sm px-3 py-1.5">📋 מצב צפיה בלבד</Badge>
          )}
        </div>
      </div>

      {/* Stats */}
      <VendorStatsCards repairs={repairs} labCredits={labCredits} labPayments={labPayments} />

      {/* All Payments Summary */}
      {labPayments.length > 0 && (
        <Card className="bg-white/80 backdrop-blur-sm border-white/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Banknote className="w-5 h-5 text-green-600" />
              תשלומים למעבדה ({labPayments.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>תאריך</TableHead>
                    <TableHead className="text-right">סכום</TableHead>
                    <TableHead>סוג תשלום</TableHead>
                    <TableHead>נרשם ע״י</TableHead>
                    <TableHead>הערות</TableHead>
                    {canEditAll && <TableHead>פעולות</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {labPayments.map(payment => {
                    const isEditing = editingPaymentId === payment.id;
                    return (
                      <TableRow key={payment.id} className="bg-green-50/50">
                        <TableCell className="text-xs">{format(parseISO(payment.payment_date || payment.created_date), 'dd/MM/yy')}</TableCell>
                        <TableCell className="text-right font-bold text-green-600">
                          {isEditing ? (
                            <Input type="number" value={editPaymentValues.amount} onChange={e => setEditPaymentValues({...editPaymentValues, amount: e.target.value})} className="w-24" />
                          ) : `₪${(payment.amount || 0).toLocaleString()}`}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input value={editPaymentValues.payment_type} onChange={e => setEditPaymentValues({...editPaymentValues, payment_type: e.target.value})} className="w-28" />
                          ) : (
                            <Badge variant="secondary" className="text-xs">{payment.payment_type}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">{payment.recorded_by || '—'}</TableCell>
                        <TableCell className="text-xs text-gray-500">
                          {isEditing ? (
                            <Input value={editPaymentValues.notes} onChange={e => setEditPaymentValues({...editPaymentValues, notes: e.target.value})} className="w-28" />
                          ) : (payment.notes || '—')}
                        </TableCell>
                        {canEditAll && (
                          <TableCell>
                            {isEditing ? (
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" onClick={() => handleSavePayment(payment)}><Save className="w-4 h-4 text-green-600" /></Button>
                                <Button size="icon" variant="ghost" onClick={handleCancelPayment}><X className="w-4 h-4 text-red-600" /></Button>
                              </div>
                            ) : (
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" onClick={() => handleEditPayment(payment)}><Edit className="w-4 h-4 text-blue-600" /></Button>
                                <Button size="icon" variant="ghost" onClick={() => handleDeletePayment(payment.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                              </div>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monthly breakdown */}
      <Card className="bg-white/80 backdrop-blur-sm border-white/40">
        <CardHeader>
          <CardTitle>פירוט לפי חודש</CardTitle>
        </CardHeader>
        <CardContent>
          {sortedMonths.length === 0 ? (
            <div className="text-center py-10 text-gray-500">אין נתונים להצגה</div>
          ) : (
            <Accordion type="single" collapsible className="w-full space-y-2">
              {sortedMonths.map(monthKey => {
                const stats = getMonthStats(monthKey);
                const data = monthlyData[monthKey];
                return (
                  <AccordionItem key={monthKey} value={monthKey} className="border rounded-xl overflow-hidden">
                    <AccordionTrigger className="px-4 py-3 hover:bg-gray-50">
                      <div className="flex flex-col items-start gap-1 text-right w-full">
                        <span className="text-lg font-semibold">{format(parseISO(monthKey + '-01'), 'MMMM yyyy', { locale: he })}</span>
                        <div className="flex flex-wrap gap-3 text-xs sm:text-sm">
                          <span className="text-blue-600">הכנסות: ₪{stats.totalRevenue.toLocaleString()}</span>
                          <span className="text-orange-600">חוב תיקונים: ₪{stats.totalLabPayment.toLocaleString()}</span>
                          {stats.totalCredits > 0 && <span className="text-red-600">זיכויים: -₪{stats.totalCredits.toLocaleString()}</span>}
                          {stats.totalPaid > 0 && <span className="text-green-600">שולם: -₪{stats.totalPaid.toLocaleString()}</span>}
                          <span className="text-purple-700 font-bold">יתרה: ₪{stats.netOwed.toLocaleString()}</span>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="p-2 space-y-4">
                      {/* Repairs Table */}
                      <div>
                        <h4 className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
                          <Wrench className="w-4 h-4" /> תיקונים ({data.repairs.length})
                        </h4>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>מס׳ תיקון</TableHead>
                                <TableHead>לקוח</TableHead>
                                <TableHead>טכנאי</TableHead>
                                <TableHead className="text-right">הכנסה</TableHead>
                                <TableHead className="text-right">עלות חלק</TableHead>
                                <TableHead className="text-right">רווח גולמי</TableHead>
                                <TableHead className="text-right font-bold text-orange-700">תשלום למעבדה</TableHead>
                                <TableHead className="text-right font-bold text-green-700">רווח נקי</TableHead>
                                {canEditAll && <TableHead>פעולות</TableHead>}
                                </TableRow>
                                </TableHeader>
                                <TableBody>
                                {data.repairs.map(repair => {
                                const isEditing = editingRepairId === repair.id;
                                const fp = isEditing ? parseFloat(editValues.final_price) || 0 : (repair.final_price || 0);
                                const pc = isEditing ? parseFloat(editValues.part_cost) || 0 : (repair.part_cost || 0);
                                const gross = fp - pc;
                                const lab = (gross / 2) + pc;
                                const net = fp - lab;
                                return (
                                <TableRow key={repair.id} className="cursor-pointer hover:bg-purple-50/50" onClick={() => setSelectedRepair(repair)}>
                                <TableCell className="font-mono text-xs text-purple-700 underline">{repair.repair_id}</TableCell>
                                <TableCell>{clientsMap[repair.client_id]?.full_name || "—"}</TableCell>
                                <TableCell>{techniciansMap[repair.technician_id]?.employee_name || "—"}</TableCell>
                                <TableCell className="text-right" onClick={isEditing ? e => e.stopPropagation() : undefined}>
                                  {isEditing ? (
                                    <Input type="number" value={editValues.final_price} onChange={e => setEditValues({...editValues, final_price: e.target.value})} className="w-24" />
                                  ) : `₪${fp.toLocaleString()}`}
                                </TableCell>
                                <TableCell className="text-right" onClick={isEditing ? e => e.stopPropagation() : undefined}>
                                  {isEditing ? (
                                    <Input type="number" value={editValues.part_cost} onChange={e => setEditValues({...editValues, part_cost: e.target.value})} className="w-24" />
                                  ) : `₪${pc.toLocaleString()}`}
                                </TableCell>
                                <TableCell className="text-right">₪{gross.toLocaleString()}</TableCell>
                                <TableCell className="text-right font-bold text-orange-600">₪{lab.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</TableCell>
                                <TableCell className="text-right font-bold text-green-600">₪{net.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</TableCell>
                                {canEditAll && (
                                  <TableCell onClick={e => e.stopPropagation()}>
                                    {isEditing ? (
                                      <div className="flex gap-1">
                                        <Button size="icon" variant="ghost" onClick={() => handleSave(repair)}><Save className="w-4 h-4 text-green-600" /></Button>
                                        <Button size="icon" variant="ghost" onClick={handleCancel}><X className="w-4 h-4 text-red-600" /></Button>
                                      </div>
                                    ) : (
                                      <Button size="icon" variant="ghost" onClick={() => handleEdit(repair)}><Edit className="w-4 h-4 text-blue-600" /></Button>
                                    )}
                                  </TableCell>
                                )}
                                </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      </div>

                      {/* Credits Table */}
                      {data.credits.length > 0 && (
                        <div>
                          <h4 className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
                            <PackageMinus className="w-4 h-4 text-red-500" /> מוצרים שנלקחו ({data.credits.length})
                          </h4>
                          <div className="overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>תאריך</TableHead>
                                  <TableHead>מי לקח</TableHead>
                                  <TableHead>מוצר</TableHead>
                                  <TableHead className="text-right">שווי</TableHead>
                                  <TableHead>נרשם ע״י</TableHead>
                                  <TableHead>הערות</TableHead>
                                  {canEditAll && <TableHead>פעולות</TableHead>}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {data.credits.map(credit => {
                                  const isEditing = editingCreditId === credit.id;
                                  return (
                                    <TableRow key={credit.id} className="bg-red-50/50">
                                      <TableCell className="text-xs">{format(parseISO(credit.taken_date || credit.created_date), 'dd/MM/yy HH:mm')}</TableCell>
                                      <TableCell>
                                        {isEditing ? (
                                          <Input value={editCreditValues.taken_by} onChange={e => setEditCreditValues({...editCreditValues, taken_by: e.target.value})} className="w-28" />
                                        ) : credit.taken_by}
                                      </TableCell>
                                      <TableCell>
                                        {isEditing ? (
                                          <Input value={editCreditValues.product_description} onChange={e => setEditCreditValues({...editCreditValues, product_description: e.target.value})} className="w-36" />
                                        ) : credit.product_description}
                                      </TableCell>
                                      <TableCell className="text-right font-bold text-red-600">
                                        {isEditing ? (
                                          <Input type="number" value={editCreditValues.amount} onChange={e => setEditCreditValues({...editCreditValues, amount: e.target.value})} className="w-24" />
                                        ) : `-₪${(credit.amount || 0).toLocaleString()}`}
                                      </TableCell>
                                      <TableCell className="text-xs text-gray-500">{credit.recorded_by || '—'}</TableCell>
                                      <TableCell className="text-xs text-gray-500">
                                        {isEditing ? (
                                          <Input value={editCreditValues.notes} onChange={e => setEditCreditValues({...editCreditValues, notes: e.target.value})} className="w-28" />
                                        ) : (credit.notes || '—')}
                                      </TableCell>
                                      {canEditAll && (
                                        <TableCell>
                                          {isEditing ? (
                                            <div className="flex gap-1">
                                              <Button size="icon" variant="ghost" onClick={() => handleSaveCredit(credit)}><Save className="w-4 h-4 text-green-600" /></Button>
                                              <Button size="icon" variant="ghost" onClick={handleCancelCredit}><X className="w-4 h-4 text-red-600" /></Button>
                                            </div>
                                          ) : (
                                            <div className="flex gap-1">
                                              <Button size="icon" variant="ghost" onClick={() => handleEditCredit(credit)}><Edit className="w-4 h-4 text-blue-600" /></Button>
                                              <Button size="icon" variant="ghost" onClick={() => handleDeleteCredit(credit.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                                            </div>
                                          )}
                                        </TableCell>
                                      )}
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )}
                      {/* Payments Table */}
                      {data.payments.length > 0 && (
                        <div>
                          <h4 className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
                            <Banknote className="w-4 h-4 text-green-600" /> תשלומים ({data.payments.length})
                          </h4>
                          <div className="overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>תאריך</TableHead>
                                  <TableHead className="text-right">סכום</TableHead>
                                  <TableHead>סוג תשלום</TableHead>
                                  <TableHead>נרשם ע״י</TableHead>
                                  <TableHead>הערות</TableHead>
                                  {canEditAll && <TableHead>פעולות</TableHead>}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {data.payments.map(payment => {
                                  const isEditing = editingPaymentId === payment.id;
                                  return (
                                    <TableRow key={payment.id} className="bg-green-50/50">
                                      <TableCell className="text-xs">{format(parseISO(payment.payment_date || payment.created_date), 'dd/MM/yy')}</TableCell>
                                      <TableCell className="text-right font-bold text-green-600">
                                        {isEditing ? (
                                          <Input type="number" value={editPaymentValues.amount} onChange={e => setEditPaymentValues({...editPaymentValues, amount: e.target.value})} className="w-24" />
                                        ) : `-₪${(payment.amount || 0).toLocaleString()}`}
                                      </TableCell>
                                      <TableCell>
                                        {isEditing ? (
                                          <Input value={editPaymentValues.payment_type} onChange={e => setEditPaymentValues({...editPaymentValues, payment_type: e.target.value})} className="w-28" />
                                        ) : (
                                          <Badge variant="secondary" className="text-xs">{payment.payment_type}</Badge>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-xs text-gray-500">{payment.recorded_by || '—'}</TableCell>
                                      <TableCell className="text-xs text-gray-500">
                                        {isEditing ? (
                                          <Input value={editPaymentValues.notes} onChange={e => setEditPaymentValues({...editPaymentValues, notes: e.target.value})} className="w-28" />
                                        ) : (payment.notes || '—')}
                                      </TableCell>
                                      {canEditAll && (
                                        <TableCell>
                                          {isEditing ? (
                                            <div className="flex gap-1">
                                              <Button size="icon" variant="ghost" onClick={() => handleSavePayment(payment)}><Save className="w-4 h-4 text-green-600" /></Button>
                                              <Button size="icon" variant="ghost" onClick={handleCancelPayment}><X className="w-4 h-4 text-red-600" /></Button>
                                            </div>
                                          ) : (
                                            <div className="flex gap-1">
                                              <Button size="icon" variant="ghost" onClick={() => handleEditPayment(payment)}><Edit className="w-4 h-4 text-blue-600" /></Button>
                                              <Button size="icon" variant="ghost" onClick={() => handleDeletePayment(payment.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                                            </div>
                                          )}
                                        </TableCell>
                                      )}
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </CardContent>
      </Card>

      <AddLabCreditModal isOpen={showAddCredit} onClose={() => setShowAddCredit(false)} onSaved={loadData} currentUser={currentUser} />
      <AddLabPaymentModal isOpen={showAddPayment} onClose={() => setShowAddPayment(false)} onSaved={loadData} currentUser={currentUser} />
      {selectedRepair && (
        <RepairDetailsModal
          isOpen={!!selectedRepair}
          onClose={() => setSelectedRepair(null)}
          repair={selectedRepair}
          onUpdate={() => { setSelectedRepair(null); loadData(); }}
        />
      )}
    </div>
  );
}