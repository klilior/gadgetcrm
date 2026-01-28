import React, { useState, useEffect } from 'react';
import { Repair, Client, RepairDevice, RepairVendor, Employee } from '@/entities/all';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Plus, X, AlertTriangle } from 'lucide-react';
import { useUser } from '../UserAuth';
import RepairLabel from './RepairLabel';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';

const issueCategories = ["מסך", "סוללה/התחממות", "גב אחורי", "שקע טעינה", "תוכנה/וירוס", "קליטה", "שמע", "מצלמה", "לא נדלק", "אחר"];
const deviceColors = ["שחור", "לבן", "זהב", "ורוד", "כחול", "ירוק", "אחר"];
const deviceManufacturers = ["Apple", "Samsung", "Xiaomi", "אביזר כללי", "טאבלט", "אחר"];

export default function NewRepairModal({ isOpen, onClose, onRepairCreated }) {
    const { currentUser } = useUser();
    
    const [step, setStep] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null); // Renamed errorMessage to error
    
    const [allClients, setAllClients] = useState([]); // Renamed 'clients'
    const [allDevices, setAllDevices] = useState([]); // Renamed 'devices'
    const [allVendors, setAllVendors] = useState([]); // Renamed 'vendors'
    
    const [selectedClient, setSelectedClient] = useState(null); // Renamed 'selectedClientId' to object
    const [selectedDevice, setSelectedDevice] = useState(null); // Renamed 'selectedDeviceId' to object
    
    const [searchTerm, setSearchTerm] = useState('');
    const [isCreatingClient, setIsCreatingClient] = useState(false);
    const [isCreatingDevice, setIsCreatingDevice] = useState(false);
    
    const [newClientData, setNewClientData] = useState({ // Renamed 'newClient'
        full_name: '', 
        phone: '', 
        email: ''
    });
    
    const [newDeviceData, setNewDeviceData] = useState({ // Renamed 'newDevice'
        manufacturer: '', 
        model: '', 
        serial_imei: '', 
        color: ''
    });
    
    const [repairData, setRepairData] = useState({ // Renamed 'repairDetails'
        repair_type: '',
        vendor_id: '',
        lock_code: '',
        issue_categories: [], // Changed to array for multiple selection
        issue_description: '',
        existing_damage: '',
        expected_price: ''
    });

    const [quoteRequired, setQuoteRequired] = useState(false); // New state

    const [showLabel, setShowLabel] = useState(false); // Renamed 'showPrintLabel'
    const [createdRepair, setCreatedRepair] = useState(null); // Renamed 'createdRepairForPrint'

    useEffect(() => {
        if (isOpen) {
            setStep(1);
            setIsLoading(true);
            setAllClients([]); // Updated state name
            setAllDevices([]); // Updated state name
            setAllVendors([]); // Updated state name
            setSelectedClient(null); // Updated state name
            setSelectedDevice(null); // Updated state name
            setSearchTerm('');
            setIsCreatingClient(false);
            setIsCreatingDevice(false);
            setNewClientData({ full_name: '', phone: '', email: '' }); // Updated state name
            setNewDeviceData({ manufacturer: '', model: '', serial_imei: '', color: '' }); // Updated state name
            setRepairData({ // Updated state name
                repair_type: '', vendor_id: '', lock_code: '', issue_categories: [],
                issue_description: '', existing_damage: '', expected_price: ''
            });
            setError(null); // Updated state name
            setShowLabel(false); // Updated state name
            setCreatedRepair(null); // Updated state name
            setQuoteRequired(false); // Reset new state
            
            loadData();
        }
    }, [isOpen]);

    const loadData = async () => {
        try {
            const [clientList, vendorList] = await Promise.all([
                Client.list(),
                RepairVendor.filter({ active: true })
            ]);
            
            setAllClients(clientList || []); // Updated state name
            setAllVendors(vendorList || []); // Updated state name
        } catch (err) {
            console.error('Error loading data:', err);
            setError('❌ שגיאה בטעינת נתונים: ' + err.message); // Updated error state
            setAllClients([]); // Updated state name
            setAllVendors([]); // Updated state name
        } finally {
            setIsLoading(false);
        }
    };

    const getVisibleClients = () => {
        if (!allClients || allClients.length === 0) return []; // Updated state name
        if (!searchTerm) return allClients; // Updated state name
        
        const term = searchTerm.toLowerCase();
        return allClients.filter(c => // Updated state name
            (c.full_name && c.full_name.toLowerCase().includes(term)) ||
            (c.phone && c.phone.includes(term))
        );
    };

    const handleClientSelect = (client) => { // Now receives client object
        setSelectedClient(client); // Sets client object
        loadClientDevices(client.id); // Still uses client ID to fetch devices
        setStep(2);
    };

    const loadClientDevices = async (clientId) => {
        try {
            const deviceList = await RepairDevice.filter({ client_id: clientId });
            setAllDevices(deviceList || []); // Updated state name
        } catch (err) {
            console.error('Error loading devices:', err);
            setAllDevices([]); // Updated state name
        }
    };

    const handleCreateClient = async () => {
        if (!newClientData.full_name.trim() || !newClientData.phone.trim()) {
            setError('❌ נדרש שם וטלפון ללקוח');
            return;
        }
        
        setIsLoading(true);
        setError(null);
        try {
            // Use findOrCreateClient to prevent duplicates
            const response = await base44.functions.invoke('findOrCreateClient', {
                phone: newClientData.phone,
                full_name: newClientData.full_name,
                email: newClientData.email || undefined
            });

            console.log('findOrCreateClient response:', response);

            // Check if response has data property (for platform v2)
            const clientResponse = response?.data || response;

            if (!clientResponse || clientResponse.error) {
                throw new Error(clientResponse?.error || 'שגיאה באימות לקוח');
            }

            const client = clientResponse.client;
            
            if (!client || !client.id) {
                throw new Error('לא התקבל לקוח מהשרת');
            }
            
            if (clientResponse.isNew) {
                setError("✅ לקוח חדש נוצר בהצלחה!");
            } else {
                setError(`✅ לקוח קיים נמצא במערכת: "${client.full_name}"`);
            }
            
            await loadData(); // Reload clients
            
            setSelectedClient(client);
            setIsCreatingClient(false);
            await loadClientDevices(client.id); // Load devices for the client
            setStep(2);

        } catch (err) {
            console.error('Error creating client:', err);
            setError('❌ שגיאה באימות/יצירת לקוח: ' + err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateDevice = async () => {
        if (!newDeviceData.manufacturer || !newDeviceData.model || !newDeviceData.serial_imei || !newDeviceData.color) { // Updated state name
            setError('❌ נדרש למלא את כל השדות'); // Updated error state
            return;
        }
        if (!selectedClient) {
            setError('❌ יש לבחור לקוח לפני יצירת מכשיר');
            return;
        }
        
        setIsLoading(true);
        setError(null); // Clears previous error
        try {
            const deviceData = { ...newDeviceData, client_id: selectedClient.id }; // Updated state name, uses selectedClient.id
            const created = await RepairDevice.create(deviceData);
            setError("✅ מכשיר נוצר בהצלחה!"); // Updated error state
            setSelectedDevice(created); // Sets device object
            setIsCreatingDevice(false);
            setStep(3);
        } catch (err) {
            console.error('Error creating device:', err);
            setError('❌ שגיאה ביצירת מכשיר: ' + err.message); // Updated error state
        } finally {
            setIsLoading(false);
        }
    };

    // New function to handle selecting an existing device
    const handleDeviceSelect = (device) => {
        setSelectedDevice(device);
        setStep(3);
    };

    const handleCreateRepair = async () => {
        if (!selectedDevice) { // New check
            setError('נא לבחור או ליצור מכשיר');
            return;
        }

        if (!repairData.lock_code || repairData.issue_categories.length === 0 || !repairData.issue_description) { // Updated state name
            setError('נא למלא את כל השדות הנדרשים (כולל לפחות תקלה אחת)'); // Updated error state
            return;
        }
        
        setIsLoading(true);
        setError(null); // Clears previous error
        
        try {
            const now = new Date();
            // Updated repair ID format
            const repairId = `REP-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
            
            let technicianId = currentUser?.id; // Assign to current user if available

            let defaultStatus = 'בטיפול/אבחון';
            // If it's an in-store repair, status is 'בטיפול החנות'
            if (repairData.repair_type === 'בטיפול החנות') {
                defaultStatus = 'בטיפול החנות';
            } else if (repairData.repair_type === 'מעבדת יבואן') {
                defaultStatus = 'At_Importer';
            }
            // For 'מעבדת Gadget-Team' it's already assigned to currentUser.id

            const slaDate = new Date();
            slaDate.setDate(slaDate.getDate() + 7); // SLA due in 7 days

            const repairToCreate = {
                repair_type: repairData.repair_type, // Updated state name
                vendor_id: repairData.repair_type === 'מעבדת יבואן' ? repairData.vendor_id : undefined, // Updated state name
                lock_code: repairData.lock_code, // Updated state name
                issue_category: repairData.issue_categories.join(', '), // Join multiple categories
                issue_description: repairData.issue_description, // Updated state name
                existing_damage: repairData.existing_damage || undefined, // Updated state name
                expected_price: parseFloat(repairData.expected_price) || 0, // Updated state name
                quote_required: quoteRequired, // New field
                quote_approved: false, // New field, default to false
                repair_id: repairId,
                client_id: selectedClient.id, // Uses selectedClient.id
                device_id: selectedDevice.id, // Uses selectedDevice.id
                technician_id: technicianId,
                status: defaultStatus,
                sla_due: slaDate.toISOString().split('T')[0]
            };
            
            setError("⏳ שומר תיקון..."); // Updated error state
            
            const created = await Repair.create(repairToCreate);
            
            if (!created || !created.id) {
                throw new Error("התיקון לא נוצר במערכת");
            }
            
            console.log('✅ Repair created successfully:', created);
            
            setError("✅ תיקון נוצר! מספר: " + repairId); // Updated error state
            
            // Send WhatsApp notification
            try {
                if (selectedClient.phone) {
                    const message = `שלום ${selectedClient.full_name},\n\nקיבלנו את המכשיר שלך לתיקון! ✅\n\n📱 מכשיר: ${selectedDevice.manufacturer} ${selectedDevice.model}\n🔢 מספר תיקון: ${repairId}\n🔧 סוג תיקון: ${repairData.repair_type}\n📋 תקלות: ${repairData.issue_categories.join(', ')}\n\nנעדכן אותך על התקדמות התיקון.\n\nתודה,\nצוות Gadget`;
                    
                    await base44.functions.invoke('sendWhatsapp', {
                        to: selectedClient.phone,
                        messageObject: {
                            type: "text",
                            text: { body: message }
                        }
                    });
                    
                    // Log activity
                    await base44.asServiceRole.entities.Activity.create({
                        summary: `הודעת כניסה לתיקון - ${repairId}`,
                        activity_type: 'וואטסאפ יוצא',
                        content: message
                    });
                    
                    console.log('✅ WhatsApp notification sent');
                }
            } catch (whatsappError) {
                console.error('⚠️ Failed to send WhatsApp notification:', whatsappError);
                // Don't fail the whole operation if WhatsApp fails
            }
            
            // Prepare repair for printing
            setCreatedRepair({ // Updated state name
                ...created,
                client: selectedClient, // Pass client object
                device: selectedDevice, // Pass device object
                agent: currentUser // Pass current user as agent
            });
            
            // Show print label
            setTimeout(() => {
                setShowLabel(true); // Updated state name
            }, 500);
            
        } catch (err) {
            console.error('❌ Error creating repair:', err);
            setError('❌ שגיאה ביצירת תיקון: ' + err.message); // Updated error state
        } finally {
            setIsLoading(false);
        }
    };

    // Renamed handleClosePrintLabel to handleLabelClose
    const handleLabelClose = async () => {
        setShowLabel(false); // Updated state name
        if (onRepairCreated) {
            await onRepairCreated(); // Refresh the repair list
        }
        onClose(); // Close the NewRepairModal fully
    };

    // Removed: handleClosePrintReceipt function

    // New unified close handler for the dialog
    const handleClose = () => {
        if (!isLoading) { // Prevent closing while an operation is in progress
            onClose();
        }
    };

    // Only render the modal or the label, not both at the same time
    if (!isOpen && !showLabel) return null;

    return (
        <>
            {/* The main dialog for NewRepairModal - open if isOpen AND NOT showLabel */}
            <Dialog open={isOpen && !showLabel} onOpenChange={handleClose}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir="rtl">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-bold">תיקון חדש</DialogTitle>
                    </DialogHeader>

                    {error && ( // Display error message
                        <div className={`p-4 rounded-lg mb-4 text-center font-bold ${
                            error.includes('❌') ? 'bg-red-100 text-red-800' : 
                            error.includes('✅') ? 'bg-green-100 text-green-800' : 
                            'bg-blue-100 text-blue-800'
                        }`}>
                            {error}
                        </div>
                    )}

                    {/* Step indicators */}
                    <div className="flex items-center justify-center space-x-2 mb-6">
                        <Badge variant={step === 1 ? "default" : "secondary"}>1. לקוח</Badge>
                        <Badge variant={step === 2 ? "default" : "secondary"}>2. מכשיר</Badge>
                        <Badge variant={step === 3 ? "default" : "secondary"}>3. פרטים</Badge>
                    </div>

                    <div className="space-y-6">
                        {step === 1 && (
                            <div className="space-y-4">
                                <h3 className="text-lg font-semibold">שלב 1: בחירת לקוח</h3>
                                
                                {isCreatingClient ? (
                                    <div className="space-y-4">
                                        <h4 className="font-medium">הוספת לקוח חדש</h4>
                                        <div className="grid gap-4">
                                            <div>
                                                <Label htmlFor="new-client-full-name">שם מלא *</Label>
                                                <Input 
                                                    id="new-client-full-name"
                                                    value={newClientData.full_name} // Updated state name
                                                    onChange={(e) => setNewClientData({...newClientData, full_name: e.target.value})} // Updated state name
                                                />
                                            </div>
                                            <div>
                                                <Label htmlFor="new-client-phone">טלפון *</Label>
                                                <Input 
                                                    id="new-client-phone"
                                                    value={newClientData.phone} // Updated state name
                                                    onChange={(e) => setNewClientData({...newClientData, phone: e.target.value})} // Updated state name
                                                />
                                            </div>
                                            <div>
                                                <Label htmlFor="new-client-email">דוא"ל</Label>
                                                <Input 
                                                    id="new-client-email"
                                                    value={newClientData.email} // Updated state name
                                                    onChange={(e) => setNewClientData({...newClientData, email: e.target.value})} // Updated state name
                                                />
                                            </div>
                                        </div>
                                        <div className="flex gap-3 justify-end">
                                            <Button variant="outline" onClick={() => setIsCreatingClient(false)}>
                                                ביטול
                                            </Button>
                                            <Button onClick={handleCreateClient} disabled={isLoading}>
                                                {isLoading ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : 'הוסף לקוח'} {/* Updated Loader icon */}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="relative">
                                            {/* Removed Search icon as per outline */}
                                            <Input
                                                placeholder="חיפוש לקוח לפי שם או טלפון..."
                                                value={searchTerm}
                                                onChange={(e) => setSearchTerm(e.target.value)}
                                                className="pr-10" // Adjust padding since search icon is gone
                                            />
                                        </div>

                                        <div className="max-h-60 overflow-y-auto space-y-2">
                                            {isLoading ? (
                                                <div className="text-center py-4">
                                                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-purple-600" /> {/* Updated Loader icon */}
                                                    <p className="text-sm text-gray-600 mt-2">טוען לקוחות...</p>
                                                </div>
                                            ) : getVisibleClients().length > 0 ? (
                                                getVisibleClients().map(client => (
                                                    <div 
                                                        key={client.id}
                                                        onClick={() => handleClientSelect(client)} // Passed client object
                                                        className="p-4 rounded-xl border cursor-pointer hover:bg-gray-50 transition-all"
                                                    >
                                                        <p className="font-semibold">{client.full_name}</p>
                                                        <p className="text-sm text-gray-600">{client.phone}</p>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="text-center py-8 text-gray-500">
                                                    {allClients.length === 0 ? 'אין לקוחות במערכת' : 'לא נמצאו לקוחות מתאימים לחיפוש'} {/* Updated state name */}
                                                </div>
                                            )}
                                        </div>

                                        <Button 
                                            onClick={() => setIsCreatingClient(true)}
                                            className="w-full"
                                        >
                                            <Plus className="w-4 h-4 ml-2" /> {/* Updated icon */}
                                            הוסף לקוח חדש
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}

                        {step === 2 && (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-semibold">שלב 2: בחירת מכשיר</h3>
                                    <Button variant="outline" onClick={() => setStep(1)}>
                                        חזרה
                                    </Button>
                                </div>
                                
                                {isCreatingDevice ? (
                                    <div className="space-y-4">
                                        <h4 className="font-medium">הוספת מכשיר חדש</h4>
                                        <div className="grid gap-4">
                                            <div>
                                                <Label htmlFor="new-device-manufacturer">יצרן *</Label>
                                                <Select value={newDeviceData.manufacturer} onValueChange={(value) => setNewDeviceData({...newDeviceData, manufacturer: value})}> {/* Updated state name */}
                                                    <SelectTrigger id="new-device-manufacturer">
                                                        <SelectValue placeholder="בחר יצרן..." />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {deviceManufacturers.map(mfg => (
                                                            <SelectItem key={mfg} value={mfg}>{mfg}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div>
                                                <Label htmlFor="new-device-model">דגם *</Label>
                                                <Input 
                                                    id="new-device-model"
                                                    value={newDeviceData.model} // Updated state name
                                                    onChange={(e) => setNewDeviceData({...newDeviceData, model: e.target.value})} // Updated state name
                                                    placeholder="לדוגמה: iPhone 13 Pro"
                                                />
                                            </div>
                                            <div>
                                                <Label htmlFor="new-device-serial">מספר סידורי/IMEI *</Label>
                                                <Input 
                                                    id="new-device-serial"
                                                    value={newDeviceData.serial_imei} // Updated state name
                                                    onChange={(e) => setNewDeviceData({...newDeviceData, serial_imei: e.target.value})} // Updated state name
                                                />
                                            </div>
                                            <div>
                                                <Label htmlFor="new-device-color">צבע *</Label>
                                                <Select value={newDeviceData.color} onValueChange={(value) => setNewDeviceData({...newDeviceData, color: value})}> {/* Updated state name */}
                                                    <SelectTrigger id="new-device-color">
                                                        <SelectValue placeholder="בחר צבע..." />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {deviceColors.map(color => (
                                                            <SelectItem key={color} value={color}>{color}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                        <div className="flex gap-3 justify-end">
                                            <Button variant="outline" onClick={() => setIsCreatingDevice(false)}>
                                                ביטול
                                            </Button>
                                            <Button onClick={handleCreateDevice} disabled={isLoading}>
                                                {isLoading ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : 'הוסף מכשיר'} {/* Updated Loader icon */}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="max-h-60 overflow-y-auto space-y-2">
                                            {allDevices.length > 0 ? ( // Updated state name
                                                allDevices.map(device => ( // Updated state name
                                                    <div 
                                                        key={device.id}
                                                        onClick={() => handleDeviceSelect(device)} // New handler
                                                        className="p-4 rounded-xl border cursor-pointer hover:bg-gray-50"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            {/* Removed Smartphone icon */}
                                                            <div>
                                                                <p className="font-semibold">{device.manufacturer} {device.model}</p>
                                                                <p className="text-sm text-gray-600">
                                                                    {device.serial_imei} • {device.color}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="text-center py-8 text-gray-500">
                                                    אין מכשירים רשומים עבור הלקוח
                                                </div>
                                            )}
                                        </div>
                                        
                                        <Button 
                                            onClick={() => setIsCreatingDevice(true)} 
                                            className="w-full"
                                        >
                                            <Plus className="w-4 h-4 ml-2" /> {/* Updated icon */}
                                            הוסף מכשיר חדש
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}

                        {step === 3 && (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-semibold">שלב 3: פרטי התיקון</h3>
                                    <Button variant="outline" onClick={() => setStep(2)}>
                                        חזרה
                                    </Button>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label htmlFor="repair-type">סוג תיקון *</Label>
                                        <Select 
                                            value={repairData.repair_type} // Updated state name
                                            onValueChange={(value) => setRepairData({...repairData, repair_type: value})} // Updated state name
                                        >
                                            <SelectTrigger id="repair-type">
                                                <SelectValue placeholder="בחר סוג תיקון..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="בטיפול החנות">בטיפול החנות</SelectItem>
                                                <SelectItem value="מעבדת Gadget-Team">מעבדת Gadget-Team</SelectItem>
                                                <SelectItem value="מעבדת יבואן">מעבדת יבואן</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {repairData.repair_type === 'מעבדת יבואן' && ( // Updated state name
                                        <div>
                                            <Label htmlFor="vendor-select">יבואן/מעבדה *</Label>
                                            <Select 
                                                value={repairData.vendor_id} // Updated state name
                                                onValueChange={(value) => setRepairData({...repairData, vendor_id: value})} // Updated state name
                                            >
                                                <SelectTrigger id="vendor-select">
                                                    <SelectValue placeholder="בחר יבואן..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {allVendors.map(vendor => ( // Updated state name
                                                        <SelectItem key={vendor.id} value={vendor.id}>
                                                            {vendor.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}

                                    <div>
                                        <Label htmlFor="lock-code">קוד נעילה *</Label>
                                        <Input 
                                            id="lock-code"
                                            value={repairData.lock_code} // Updated state name
                                            onChange={(e) => setRepairData({...repairData, lock_code: e.target.value})} // Updated state name
                                            placeholder="קוד פין/דפוס/פנים"
                                        />
                                    </div>

                                    <div className="col-span-2">
                                        <Label>נושאי התקלה * (ניתן לבחור מספר תקלות)</Label>
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2 p-3 border rounded-lg bg-gray-50">
                                            {issueCategories.map(category => (
                                                <div key={category} className="flex items-center gap-2">
                                                    <Checkbox
                                                        id={`issue-${category}`}
                                                        checked={repairData.issue_categories.includes(category)}
                                                        onCheckedChange={(checked) => {
                                                            if (checked) {
                                                                setRepairData({...repairData, issue_categories: [...repairData.issue_categories, category]});
                                                            } else {
                                                                setRepairData({...repairData, issue_categories: repairData.issue_categories.filter(c => c !== category)});
                                                            }
                                                        }}
                                                    />
                                                    <Label htmlFor={`issue-${category}`} className="text-sm cursor-pointer">{category}</Label>
                                                </div>
                                            ))}
                                        </div>
                                        {repairData.issue_categories.length > 0 && (
                                            <div className="flex flex-wrap gap-1 mt-2">
                                                {repairData.issue_categories.map(cat => (
                                                    <Badge key={cat} variant="secondary" className="flex items-center gap-1">
                                                        {cat}
                                                        <X 
                                                            className="w-3 h-3 cursor-pointer hover:text-red-500" 
                                                            onClick={() => setRepairData({...repairData, issue_categories: repairData.issue_categories.filter(c => c !== cat)})}
                                                        />
                                                    </Badge>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div>
                                        <Label htmlFor="expected-price">מחיר צפוי (₪)</Label>
                                        <Input 
                                            id="expected-price"
                                            type="number"
                                            value={repairData.expected_price} // Updated state name
                                            onChange={(e) => setRepairData({...repairData, expected_price: e.target.value})} // Updated state name
                                            placeholder="0"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <Label htmlFor="issue-description">תיאור התקלה *</Label>
                                    <Textarea 
                                        id="issue-description"
                                        value={repairData.issue_description} // Updated state name
                                        onChange={(e) => setRepairData({...repairData, issue_description: e.target.value})} // Updated state name
                                        placeholder="פרט את התקלה..."
                                        rows={3}
                                    />
                                </div>

                                <div>
                                    <Label htmlFor="existing-damage">נזק קיים</Label>
                                    <Textarea 
                                        id="existing-damage"
                                        value={repairData.existing_damage} // Updated state name
                                        onChange={(e) => setRepairData({...repairData, existing_damage: e.target.value})} // Updated state name
                                        placeholder="שריטות, סדקים וכו'..."
                                        rows={2}
                                    />
                                </div>

                                {/* New quote required checkbox */}
                                <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                                    <Checkbox
                                        id="quote-required"
                                        checked={quoteRequired}
                                        onCheckedChange={setQuoteRequired}
                                    />
                                    <Label htmlFor="quote-required" className="flex items-center gap-2 cursor-pointer text-amber-900 font-medium">
                                        <AlertTriangle className="w-5 h-5" />
                                        דרושה הצעת מחיר לפני תיקון
                                    </Label>
                                </div>

                                {quoteRequired && (
                                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                                        <strong>שים לב:</strong> המידע יודגש במדבקה - אין לתקן ללא אישור הצעת מחיר מהלקוח!
                                    </div>
                                )}

                                <div className="flex gap-3 justify-end pt-4">
                                    <Button variant="outline" onClick={() => setStep(2)}>
                                        חזרה
                                    </Button>
                                    <Button onClick={handleCreateRepair} disabled={isLoading} className="bg-green-600 hover:bg-green-700">
                                        {isLoading ? (
                                            <>
                                                <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                                                יוצר...
                                            </>
                                        ) : (
                                            'צור תיקון'
                                        )}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
            
            {/* RepairLabel component - rendered when showLabel is true and createdRepair exists */}
            {showLabel && createdRepair && ( // Updated state names
                <RepairLabel
                    repair={createdRepair} // Updated state name
                    client={createdRepair.client} // Access client from createdRepair object
                    device={createdRepair.device} // Access device from createdRepair object
                    agent={currentUser} // Pass currentUser
                    isOpen={showLabel} // Updated state name
                    onClose={handleLabelClose} // Updated handler name
                />
            )}
            
            {/* Removed RepairReceipt component */}
        </>
    );
}