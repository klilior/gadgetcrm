import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { RefreshCw, Database, Tag, Users, Trash2, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

export default function SalesDataAdmin() {
    const { currentUser } = useUser();
    const [transactions, setTransactions] = useState([]);
    const [productMaps, setProductMaps] = useState([]);
    const [usersMap, setUsersMap] = useState([]);
    const [categoryTranslations, setCategoryTranslations] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState("transactions");
    const [debugData, setDebugData] = useState(null);
    const [debugAnalysis, setDebugAnalysis] = useState(null);
    
    // User map form state
    const [newUserMap, setNewUserMap] = useState({ user_id: "", user_name: "" });
    const [bulkCategories, setBulkCategories] = useState("");
    
    // Manual Sync State
    const [manualDateFrom, setManualDateFrom] = useState("2025-12-01");
    const [manualDateTo, setManualDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [showManualSync, setShowManualSync] = useState(false);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [txs, maps, users, categories] = await Promise.all([
                base44.entities.SalesTransaction.list('-issue_date', 100),
                base44.entities.LinetProductMap.list('-last_checked', 100),
                base44.entities.LinetUsersMap.list('user_id', 100),
                base44.entities.LinetCategoryTranslation.list('category_id', 1000)
            ]);
            setTransactions(txs);
            setProductMaps(maps);
            setUsersMap(users);
            setCategoryTranslations(categories);
        } catch (error) {
            console.error("Error loading data:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleAddUserMap = async () => {
        if (!newUserMap.user_id || !newUserMap.user_name) return;
        try {
            await base44.entities.LinetUsersMap.create(newUserMap);
            setNewUserMap({ user_id: "", user_name: "" });
            loadData();
        } catch (error) {
            alert("Error creating user map: " + error.message);
        }
    };

    const handleDeleteUserMap = async (id) => {
        if (!confirm("Delete this mapping?")) return;
        try {
            await base44.entities.LinetUsersMap.delete(id);
            loadData();
        } catch (error) {
            alert("Error deleting: " + error.message);
        }
    };

    const handleBulkImportCategories = async () => {
        if (!bulkCategories) return;
        
        setIsLoading(true);
        try {
            const lines = bulkCategories.split('\n');
            let count = 0;
            const toCreate = [];
            const toUpdate = [];

            // 1. Parse and prepare
            for (const line of lines) {
                if (!line.trim()) continue;
                
                const match = line.match(/^(\d+)[\s\t,]+(.+)$/);
                if (match) {
                    const category_id = Number(match[1]);
                    const category_name = match[2].trim();
                    
                    const existing = categoryTranslations.find(c => c.category_id === category_id);
                    
                    if (existing) {
                        if (existing.category_name !== category_name) {
                            toUpdate.push({ id: existing.id, category_name });
                        }
                    } else {
                        toCreate.push({ category_id, category_name });
                    }
                }
            }

            // 2. Batch Create (Chunked to be safe)
            if (toCreate.length > 0) {
                const chunkSize = 50;
                for (let i = 0; i < toCreate.length; i += chunkSize) {
                    const chunk = toCreate.slice(i, i + chunkSize);
                    await base44.entities.LinetCategoryTranslation.bulkCreate(chunk);
                    count += chunk.length;
                }
            }

            // 3. Sequential Updates (To avoid rate limits)
            if (toUpdate.length > 0) {
                for (const item of toUpdate) {
                    await base44.entities.LinetCategoryTranslation.update(item.id, { category_name: item.category_name });
                    count++;
                }
            }
            
            setBulkCategories("");
            alert(`Imported/Updated ${count} categories`);
            loadData();
        } catch (error) {
            console.error("Import error:", error);
            alert("Error importing: " + error.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteCategory = async (id) => {
        if (!confirm("Delete this category translation?")) return;
        try {
            await base44.entities.LinetCategoryTranslation.delete(id);
            loadData();
        } catch (error) {
            alert("Error deleting: " + error.message);
        }
    };

    const handleSync = async () => {
        setIsLoading(true);
        let currentOffset = 0;
        let isFinished = false;
        let totalDocs = 0;
        let totalLines = 0;
        let batchCount = 0;

        try {
            while (!isFinished) {
                batchCount++;
                console.log(`Starting batch ${batchCount} at offset ${currentOffset}...`);
                
                const params = { offset: currentOffset };
                if (showManualSync) {
                    params.manual_date_from = manualDateFrom;
                    params.manual_date_to = manualDateTo;
                }

                const res = await base44.functions.invoke('syncLinetSalesData', params);

                if (!res.data.success) {
                    throw new Error(res.data.error || "Unknown error during sync");
                }

                if (res.data.stats) {
                    totalDocs += res.data.stats.docs || 0;
                    totalLines += res.data.stats.lines || 0;
                }

                if (res.data.partial) {
                    currentOffset = res.data.nextOffset;
                    await new Promise(r => setTimeout(r, 1000));
                } else {
                    isFinished = true;
                    alert(`✅ סנכרון הושלם בהצלחה!\nטווח: ${res.data.stats?.skipped ? '(אוטומטי)' : manualDateFrom + ' עד ' + manualDateTo}\nעובדו ${totalDocs} מסמכים.\nנשמרו ${totalLines} שורות.`);
                    loadData();
                }
            }
        } catch (error) {
            console.error("Sync failed:", error);
            alert('❌ שגיאה בסנכרון: ' + (error.message || "Error"));
        } finally {
            setIsLoading(false);
        }
    };

    const handleDebugSync = async () => {
        setIsLoading(true);
        setDebugData(null);
        setDebugAnalysis(null);
        try {
            const res = await base44.functions.invoke('debugLinetSync');
            console.log("Debug result:", res.data);
            setDebugData(res.data);
            if (res.data.analysis) {
                setDebugAnalysis(res.data.analysis);
            }
            if (res.data.success) {
                alert('Debug הושלם - בדוק את התוצאות בטאב Debug');
            } else {
                alert('Debug נכשל: ' + res.data.error);
            }
        } catch (error) {
            console.error("Debug failed:", error);
            alert('שגיאה: ' + error.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDebugFetch = async () => {
        setIsLoading(true);
        try {
            // Fetch last 3 days to see raw data
            const dateTo = format(new Date(), 'yyyy-MM-dd');
            const dateFrom = format(new Date(Date.now() - 3 * 86400000), 'yyyy-MM-dd');
            
            const res = await base44.functions.invoke('linetApi', { 
                action: 'searchDocuments', 
                params: { date_from: dateFrom, date_to: dateTo, limit: 5 } 
            });
            
            if (res.data.success) {
                setDebugData(res.data.data);
            } else {
                alert('Error fetching debug data: ' + res.data.error);
            }
        } catch (error) {
            alert('Debug fetch failed: ' + error.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleTestConnection = async () => {
        setIsLoading(true);
        setDebugData(null);
        setDebugAnalysis(null);
        try {
            const res = await base44.functions.invoke('testLinetConnection', {
                date_from: manualDateFrom || '2025-11-01',
                date_to: manualDateTo || format(new Date(), 'yyyy-MM-dd')
            });
            
            console.log("Test Connection Result:", res.data);
            setDebugData(res.data);
            
            if (res.data.success) {
                setDebugAnalysis(res.data.recommendation);
            } else {
                setDebugAnalysis(`❌ שגיאה: ${res.data.error}`);
            }
        } catch (error) {
            console.error("Test Connection failed:", error);
            setDebugAnalysis(`❌ שגיאה: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteAllData = async () => {
        if (!currentUser || (currentUser.role !== 'מנהל' && currentUser.role !== 'admin')) {
            alert("אין לך הרשאה לבצע פעולה זו.");
            return;
        }

        // First Confirmation
        if (!window.confirm("⚠️ אזהרה חמורה!\n\nפעולה זו תמחק את כל נתוני המכירות מהמערכת.\nהאם אתה בטוח שברצונך להמשיך?")) {
            return;
        }

        // Second Confirmation
        const confirmationInput = window.prompt("אישור סופי בהחלט.\n\nהנתונים יימחקו לצמיתות ולא ניתן לשחזר אותם.\n\nכדי לאשר, אנא הקלד 'מחיקה' בתיבה למטה:");
        if (confirmationInput !== "מחיקה") {
            alert("הפעולה בוטלה.");
            return;
        }

        setIsLoading(true);
        let totalDeleted = 0;
        let isFinished = false;

        try {
            while (!isFinished) {
                const res = await base44.functions.invoke('deleteAllSalesData');

                if (!res.data.success) {
                    throw new Error(res.data.error || "Unknown error");
                }

                totalDeleted += (res.data.count || 0);

                if (res.data.partial) {
                    console.log(`Deleted ${totalDeleted} records so far... continuing...`);
                    // Small delay to prevent overwhelming the server
                    await new Promise(r => setTimeout(r, 500));
                } else {
                    isFinished = true;
                    alert(`✅ הנתונים נמחקו בהצלחה.\nסה"כ נמחקו: ${totalDeleted} רשומות.`);
                    loadData();
                }
            }
        } catch (error) {
            console.error("Delete failed:", error);
            alert(`❌ שגיאה בביצוע המחיקה (נמחקו ${totalDeleted} רשומות): ` + error.message);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    return (
        <div className="p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">ניהול נתוני מכירות</h1>
                    <p className="text-gray-600">צפייה בנתוני גלם ומיפוי מוצרים</p>
                </div>
                <div className="flex flex-col gap-2 items-end">
                    <div className="flex gap-2">
                        <Button onClick={() => setShowManualSync(!showManualSync)} variant="outline" className="bg-white shadow-sm">
                            {showManualSync ? 'הסתר סנכרון ידני' : 'סנכרון ידני מתקדם'}
                        </Button>
                        {(currentUser?.role === 'מנהל' || currentUser?.role === 'admin') && (
                            <Button 
                                onClick={handleDeleteAllData} 
                                disabled={isLoading} 
                                className="bg-red-600 text-white hover:bg-red-700 shadow-lg border border-red-800"
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
                                מחיקת כל הנתונים
                            </Button>
                        )}
                        <Button onClick={handleSync} disabled={isLoading} className="bg-green-600 text-white hover:bg-green-700 shadow-lg">
                            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                            {showManualSync ? 'בצע סנכרון ידני' : 'סנכרן אוטומטי (הכל)'}
                        </Button>
                        <Button onClick={loadData} disabled={isLoading} className="bg-blue-600 text-white hover:bg-blue-700 shadow-md">
                            רענן טבלה
                        </Button>
                    </div>

                    {showManualSync && (
                        <div className="flex gap-2 items-center bg-white p-2 rounded-lg shadow-inner border border-gray-200 animate-in fade-in slide-in-from-top-2">
                            <span className="text-sm font-medium text-gray-700">מתאריך:</span>
                            <input 
                                type="date" 
                                className="border rounded px-2 py-1 text-sm" 
                                value={manualDateFrom}
                                onChange={e => setManualDateFrom(e.target.value)}
                            />
                            <span className="text-sm font-medium text-gray-700">עד תאריך:</span>
                            <input 
                                type="date" 
                                className="border rounded px-2 py-1 text-sm" 
                                value={manualDateTo}
                                onChange={e => setManualDateTo(e.target.value)}
                            />
                        </div>
                    )}
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="glass-card p-1 rounded-xl">
                    <TabsTrigger value="transactions" className="rounded-lg data-[state=active]:bg-blue-100 data-[state=active]:text-blue-800">
                        <Database className="w-4 h-4 mr-2" />
                        עסקאות (100 אחרונות)
                    </TabsTrigger>
                    <TabsTrigger value="mapping" className="rounded-lg data-[state=active]:bg-purple-100 data-[state=active]:text-purple-800">
                        <Tag className="w-4 h-4 mr-2" />
                        מיפוי מוצרים
                    </TabsTrigger>
                    <TabsTrigger value="users" className="rounded-lg data-[state=active]:bg-orange-100 data-[state=active]:text-orange-800">
                        <Users className="w-4 h-4 mr-2" />
                        מיפוי עובדים
                    </TabsTrigger>
                    <TabsTrigger value="categories" className="rounded-lg data-[state=active]:bg-green-100 data-[state=active]:text-green-800">
                        <Tag className="w-4 h-4 mr-2" />
                        תרגום קטגוריות
                    </TabsTrigger>
                    <TabsTrigger value="debug" className="rounded-lg data-[state=active]:bg-red-100 data-[state=active]:text-red-800">
                        <Database className="w-4 h-4 mr-2" />
                        Debug API (RAW)
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="transactions" className="mt-6">
                    <Card className="glass-card border-0">
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>מספר מסמך</TableHead>
                                            <TableHead>תאריך הפקה</TableHead>
                                            <TableHead>חברה</TableHead>
                                            <TableHead>נציג</TableHead>
                                            <TableHead>מק"ט</TableHead>
                                            <TableHead>שם פריט</TableHead>
                                            <TableHead>כמות</TableHead>
                                            <TableHead>מחיר פריט (כולל מע"מ)</TableHead>
                                            <TableHead>סך שורה לפני מע"מ</TableHead>
                                            <TableHead>סך שורה (כולל מע"מ)</TableHead>
                                            <TableHead>קטגוריה</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {transactions.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan="8" className="text-center py-8 text-gray-500">
                                                    אין עסקאות להצגה
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            transactions.map((tx) => (
                                                <TableRow key={tx.id}>
                                                    <TableCell>
                                                        <div className="font-medium">{tx.doc_number}</div>
                                                        <div className="text-xs text-gray-500">{tx.doc_type}</div>
                                                    </TableCell>
                                                    <TableCell>
                                                        {tx.issue_date}
                                                    </TableCell>
                                                    <TableCell>{tx.customer_name}</TableCell>
                                                    <TableCell>{tx.sales_rep}</TableCell>
                                                    <TableCell className="font-mono text-xs">{tx.sku}</TableCell>
                                                    <TableCell className="max-w-xs truncate" title={tx.product_name}>{tx.product_name}</TableCell>
                                                    <TableCell className="font-bold">{tx.quantity}</TableCell>
                                                    <TableCell>₪{tx.unit_price?.toFixed(2)}</TableCell>
                                                    <TableCell>₪{tx.price_ex_vat?.toFixed(2)}</TableCell>
                                                    <TableCell className={`font-bold ${tx.total_row_amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                        ₪{tx.total_row_amount?.toFixed(2)}
                                                    </TableCell>
                                                    <TableCell>
                                                        <span className="px-2 py-1 bg-gray-100 rounded text-xs">
                                                            {tx.category || '-'}
                                                        </span>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="mapping" className="mt-6">
                    <Card className="glass-card border-0">
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>מק"ט</TableHead>
                                            <TableHead>קטגוריה מקורית (Linet)</TableHead>
                                            <TableHead>דריסה ידנית</TableHead>
                                            <TableHead>נבדק לאחרונה</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {productMaps.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan="4" className="text-center py-8 text-gray-500">
                                                    אין נתוני מיפוי
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            productMaps.map((map) => (
                                                <TableRow key={map.id}>
                                                    <TableCell className="font-mono">{map.sku}</TableCell>
                                                    <TableCell>{map.linet_category_name}</TableCell>
                                                    <TableCell>
                                                        {map.manual_override ? (
                                                            <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs font-medium">
                                                                {map.manual_override}
                                                            </span>
                                                        ) : (
                                                            <span className="text-gray-400 text-xs">-</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-sm text-gray-600">
                                                        {map.last_checked ? format(new Date(map.last_checked), 'dd/MM/yyyy HH:mm') : '-'}
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="categories" className="mt-6">
                    <div className="bg-green-50 p-4 rounded-lg mb-4 border border-green-200 text-green-900">
                        <strong>📋 ייבוא קטגוריות</strong>
                        <p className="text-sm mt-1">
                            הדבק כאן את רשימת הקטגוריות בפורמט: <code>מזהה שסט"ב שם_קטגוריה</code> (כל קטגוריה בשורה חדשה).
                            <br />
                            לדוגמה:
                            <br />
                            16 טלפונים סלולרים
                            <br />
                            50 מחשבים
                        </p>
                    </div>
                    
                    <Card className="glass-card border-0 mb-4">
                        <CardContent className="p-4">
                            <textarea
                                className="w-full p-3 rounded border bg-white h-32 font-mono text-sm"
                                value={bulkCategories}
                                onChange={e => setBulkCategories(e.target.value)}
                                placeholder={`18\tמבצעים חמים\n1\tכללי\n...`}
                            />
                            <div className="mt-2 flex justify-end">
                                <Button onClick={handleBulkImportCategories} disabled={isLoading || !bulkCategories} className="bg-green-600 hover:bg-green-700 text-white shadow-md">
                                    <Database className="w-4 h-4 mr-2" />
                                    ייבא נתונים
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="glass-card border-0">
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Category ID</TableHead>
                                            <TableHead>Category Name</TableHead>
                                            <TableHead className="text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {categoryTranslations.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan="3" className="text-center py-8 text-gray-500">
                                                    אין תרגומי קטגוריות
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            categoryTranslations.sort((a,b) => a.category_id - b.category_id).map((cat) => (
                                                <TableRow key={cat.id}>
                                                    <TableCell className="font-mono font-bold">{cat.category_id}</TableCell>
                                                    <TableCell>{cat.category_name}</TableCell>
                                                    <TableCell className="text-right">
                                                        <Button 
                                                            variant="ghost" 
                                                            size="sm" 
                                                            onClick={() => handleDeleteCategory(cat.id)}
                                                            className="text-red-600 hover:text-red-800"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="users" className="mt-6">
                    <div className="bg-orange-50 p-4 rounded-lg mb-4 border border-orange-200 text-orange-900">
                        <strong>💡 איפה למצוא את קוד העובד?</strong>
                        <p className="text-sm mt-1">
                            בלשונית "Debug API" תוכל לראות את הנתונים הגולמיים. חפש את השדה <code>owner_id</code> או <code>agent_id</code> במסמכים.
                            זהו הקוד שעליך להזין כאן כדי לשייך אותו לשם העובד.
                        </p>
                    </div>
                    <Card className="glass-card border-0 mb-4">
                        <CardContent className="p-4 flex gap-4 items-end">
                            <div className="flex-1">
                                <label className="text-sm font-medium mb-1 block">User ID (Linet)</label>
                                <input 
                                    className="w-full p-2 rounded border bg-white"
                                    value={newUserMap.user_id}
                                    onChange={e => setNewUserMap({...newUserMap, user_id: e.target.value})}
                                    placeholder="לדוגמה: 101"
                                />
                            </div>
                            <div className="flex-1">
                                <label className="text-sm font-medium mb-1 block">User Name (Display)</label>
                                <input 
                                    className="w-full p-2 rounded border bg-white"
                                    value={newUserMap.user_name}
                                    onChange={e => setNewUserMap({...newUserMap, user_name: e.target.value})}
                                    placeholder="לדוגמה: דני"
                                />
                            </div>
                            <Button onClick={handleAddUserMap} className="bg-orange-600 hover:bg-orange-700 text-white shadow-md">
                                הוסף מיפוי
                            </Button>
                        </CardContent>
                    </Card>

                    <Card className="glass-card border-0">
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>User ID</TableHead>
                                            <TableHead>Mapped Name</TableHead>
                                            <TableHead>Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {usersMap.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan="3" className="text-center py-8 text-gray-500">
                                                    אין מיפוי משתמשים
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            usersMap.map((user) => (
                                                <TableRow key={user.id}>
                                                    <TableCell className="font-mono">{user.user_id}</TableCell>
                                                    <TableCell className="font-bold">{user.user_name}</TableCell>
                                                    <TableCell>
                                                        <Button 
                                                            variant="ghost" 
                                                            size="sm" 
                                                            onClick={() => handleDeleteUserMap(user.id)}
                                                            className="text-red-600 hover:text-red-800"
                                                        >
                                                            Delete
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="debug" className="mt-6">
                    <Card className="glass-card border-0">
                        <CardHeader>
                            <CardTitle className="flex justify-between items-center flex-wrap gap-2">
                                <span>נתונים גולמיים וניתוח מסמכים</span>
                                <div className="flex gap-2">
                                    <Button onClick={handleTestConnection} disabled={isLoading} size="sm" className="bg-purple-600 hover:bg-purple-700 text-white shadow-md">
                                                        <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                                                        🔬 בדיקת חיבור Linet
                                                    </Button>
                                                    <Button onClick={handleDebugSync} disabled={isLoading} size="sm" className="bg-orange-600 hover:bg-orange-700 text-white shadow-md">
                                                        <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                                                        Debug Sync
                                                    </Button>
                                                    <Button onClick={handleDebugFetch} disabled={isLoading} size="sm" className="bg-red-600 hover:bg-red-700 text-white shadow-md">
                                                        <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                                                        נתונים גולמיים
                                                    </Button>
                                </div>
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {debugAnalysis && (
                                <div className={`p-4 rounded-lg mb-4 font-bold text-lg text-center border-2 ${debugAnalysis.includes("VALID") ? "bg-green-100 text-green-800 border-green-300" : "bg-red-100 text-red-800 border-red-300"}`}>
                                    {debugAnalysis}
                                </div>
                            )}
                            {debugData ? (
                                <div className="space-y-4">
                                    <div className="bg-gray-900 text-green-400 p-4 rounded-lg overflow-auto max-h-[600px] text-xs font-mono" dir="ltr">
                                        <pre>{JSON.stringify(debugData, null, 2)}</pre>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-12 text-gray-500">
                                    לחץ על Debug Sync כדי לבדוק את המסמך הבעייתי (300142)
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}