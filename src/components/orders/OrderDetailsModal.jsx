import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { X, User, Mail, Phone, MapPin, Truck, Hash, Calendar, Tag, ShoppingCart, Send, Package, CheckCircle, Printer, Check, Loader2 } from 'lucide-react';
import { format } from "date-fns";
import { base44 } from "@/api/base44Client";
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import CreateShipmentModal from '../shipping/CreateShipmentModal';
import { updateWooOrderStatus } from "@/functions/updateWooOrderStatus";

export default function OrderDetailsModal({ order, open, onClose, getStatusColor, STATUS_MAPPING, onStatusChange }) {
    const [isCheckingShipping, setIsCheckingShipping] = useState(false);
    const [shippingOptions, setShippingOptions] = useState(null);
    const [selectedOption, setSelectedOption] = useState(null);
    const [isCreatingShipment, setIsCreatingShipment] = useState(false);
    const [shipmentCreated, setShipmentCreated] = useState(false);
    const [createdShipmentData, setCreatedShipmentData] = useState(null);
    const [error, setError] = useState(null);
    const [newStatus, setNewStatus] = useState(order?.status || '');
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
    const [showUpsShipment, setShowUpsShipment] = useState(false);
    
    if (!order) return null;
    
    const statusColor = getStatusColor(order.status);
    const hebrewStatus = STATUS_MAPPING[order.status] || order.status;

    const handleCreateVeloShipment = async () => {
        setIsCreatingShipment(true);
        setError(null);

        try {
            console.log('🚀 [OrderDetails] Creating Velo shipment for order:', order.id);

            const response = await base44.functions.invoke('veloOrder', {
                orderId: order.id,
                polygonId: 68
            });

            console.log('📦 [OrderDetails] Velo response:', response);

            const data = response.data || response;

            if (data.success) {
                console.log('✅ Shipment created:', data.shipment);
                setShipmentCreated(true);
                const shipmentInfo = { ...data.shipment, warning: data.warning };
                setCreatedShipmentData(shipmentInfo);
                if (shipmentInfo.label_url) {
                    window.open(shipmentInfo.label_url, '_blank');
                }
            } else {
                const errorMsg = data.error || 'שגיאה ביצירת משלוח';
                console.error('❌ Velo error:', errorMsg);
                setError(errorMsg);
            }
        } catch (error) {
            console.error('❌ [OrderDetails] Exception:', error);
            const errorMsg = error.response?.data?.error || error.message || 'שגיאה ביצירת משלוח Velo';
            setError(errorMsg);
        } finally {
            setIsCreatingShipment(false);
        }
    };

    const handleCreateShipment = async () => {
        if (!selectedOption) {
            alert('נא לבחור אפשרות משלוח');
            return;
        }

        setIsCreatingShipment(true);
        setError(null);

        try {
            console.log('🚀 Creating shipment with:', {
                orderId: order.id,
                polygonId: selectedOption.polygon_id,
                externalServiceId: selectedOption.external_service_id
            });

            const response = await base44.functions.invoke('veloOrder', {
                orderId: order.id,
                polygonId: selectedOption.polygon_id,
                externalServiceId: selectedOption.external_service_id
            });

            console.log('📦 Velo response:', response);

            // Response from invoke is the full axios response
            const data = response.data || response;

            if (data.success) {
                console.log('✅ Shipment created:', data.shipment);
                if (data.warning) {
                    console.warn('⚠️ Warning:', data.warning);
                }
                setShipmentCreated(true);
                const shipmentInfo = { ...data.shipment, warning: data.warning };
                setCreatedShipmentData(shipmentInfo);
                
                // Auto-open label for printing if available
                if (shipmentInfo.label_url) {
                    window.open(shipmentInfo.label_url, '_blank');
                }
            } else {
                const errorMsg = data.error || 'שגיאה ביצירת משלוח';
                console.error('❌ Shipment error:', errorMsg, data.details);
                setError(errorMsg + (data.details ? ` (${JSON.stringify(data.details)})` : ''));
            }
        } catch (error) {
            console.error('❌ Error creating shipment:', error);
            const errorMsg = error.response?.data?.error || error.message || 'שגיאה ביצירת משלוח';
            setError(errorMsg);
        } finally {
            setIsCreatingShipment(false);
        }
    };

    const handleUpdateStatus = async () => {
        if (!newStatus || newStatus === order.status) return;
        
        setIsUpdatingStatus(true);
        try {
            const { data } = await updateWooOrderStatus({ 
                order_id: order.id, 
                new_status: newStatus 
            });
            
            if (data.success) {
                if (onStatusChange) {
                    onStatusChange(order.id, newStatus);
                }
                const wooMsg = data.updated_woo ? ' + WooCommerce' : ' (מקומי בלבד)';
                alert(`✅ סטטוס עודכן בהצלחה${wooMsg}`);
                if (data.warning) console.warn('⚠️', data.warning);
            } else {
                alert('❌ שגיאה: ' + (data.error || 'לא ידוע'));
            }
        } catch (error) {
            console.error('Error updating status:', error);
            alert('❌ שגיאה בעדכון סטטוס');
        } finally {
            setIsUpdatingStatus(false);
        }
    };

    // Check if this is a UPS pickup order
    const isUpsPickupOrder = (() => {
        const method = (order.shipping_method || '').toLowerCase();
        return method.includes('pickup') || method.includes('נקודת איסוף') || method.includes('ups') && method.includes('איסוף');
    })();

    const hasPickupPointData = (() => {
        if (!order.pickup_point_data) return false;
        try {
            const raw = typeof order.pickup_point_data === 'string' ? order.pickup_point_data : JSON.stringify(order.pickup_point_data);
            return raw && raw.length > 5;
        } catch { return false; }
    })();

    const handlePrintLabel = () => {
        if (!createdShipmentData) return;
        
        // Open Velo label URL if available
        const labelUrl = createdShipmentData.label_url;
        if (labelUrl) {
            window.open(labelUrl, '_blank');
            return;
        }
        
        // Fallback: Create printable content with barcode
        let billingData = {};
        try { billingData = JSON.parse(order.raw_data_billing || '{}'); } catch (e) {}
        
        const printContent = `
            <html dir="rtl">
            <head>
                <title>שטר משלוח - ${order.external_order_number || order.id}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; margin: 0; }
                    .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
                    .info { margin: 10px 0; font-size: 14px; }
                    .label { font-weight: bold; }
                    .barcode { text-align: center; font-size: 32px; font-weight: bold; margin: 20px 0; padding: 15px; border: 3px solid #000; letter-spacing: 3px; }
                    .tracking { text-align: center; font-size: 12px; margin-top: 10px; color: #666; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>שטר משלוח VELO</h1>
                    <p>הזמנה: #${order.external_order_number || order.id}</p>
                </div>
                <div class="barcode">${createdShipmentData.shipping_code || 'N/A'}</div>
                ${createdShipmentData.tracking_url ? `<div class="tracking">מעקב: ${createdShipmentData.tracking_url}</div>` : ''}
                <div class="info"><span class="label">שם:</span> ${billingData.first_name || ''} ${billingData.last_name || ''}</div>
                <div class="info"><span class="label">טלפון:</span> ${billingData.phone || ''}</div>
                <div class="info"><span class="label">כתובת:</span> ${billingData.address_1 || ''}, ${billingData.city || ''}</div>
            </body>
            </html>
        `;
        const printWindow = window.open('', '_blank');
        printWindow.document.write(printContent);
        printWindow.document.close();
        printWindow.print();
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-3xl p-0" dir="rtl">
                <DialogHeader className="p-6 pb-4 border-b">
                    <DialogTitle className="text-xl flex justify-between items-center">
                        <span>פרטי הזמנה #{order.id}</span>
                        <Button variant="ghost" size="icon" onClick={onClose} className="mr-auto">
                            <X className="w-4 h-4" />
                        </Button>
                    </DialogTitle>
                </DialogHeader>

                <div className="max-h-[70vh] overflow-y-auto p-6 space-y-6">
                    
                    <div className="grid md:grid-cols-2 gap-6">
                        <div className="space-y-4 p-4 rounded-lg bg-gray-50/80">
                            <h3 className="font-semibold flex items-center gap-2"><User className="w-4 h-4" /> פרטי לקוח</h3>
                            <InfoItem icon={User} label="שם מלא" value={order.client_name} />
                            <InfoItem icon={Mail} label="אימייל" value={<a href={`mailto:${order.billing?.email}`} className="text-blue-600 hover:underline">{order.billing?.email}</a>} />
                            <InfoItem icon={Phone} label="טלפון" value={<a href={`tel:${order.billing?.phone}`} className="text-blue-600 hover:underline">{order.billing?.phone}</a>} />
                            <InfoItem icon={MapPin} label="כתובת" value={`${order.billing?.address_1 || ''}, ${order.billing?.city || ''}`} />
                        </div>
                        <div className="space-y-4 p-4 rounded-lg bg-gray-50/80">
                            <h3 className="font-semibold flex items-center gap-2"><Hash className="w-4 h-4" /> פרטי הזמנה</h3>
                            <InfoItem icon={Calendar} label="תאריך" value={order.order_date ? format(new Date(order.order_date), 'dd/MM/yyyy HH:mm') : '-'} />
                            <InfoItem icon={Tag} label="סטטוס" value={<span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>{hebrewStatus}</span>} />
                            <InfoItem icon={Truck} label="משלוח" value={order.shipping_method || 'לא צוין'} />
                            <InfoItem icon={Tag} label="מקור" value={order.payment_method_title || 'WooCommerce'} />
                        </div>
                    </div>
                    
                    {/* Customer Note */}
                    {order.customer_note && (
                        <div className="p-4 rounded-lg bg-yellow-50 border border-yellow-200">
                            <h3 className="font-semibold flex items-center gap-2 text-yellow-800 mb-2">
                                <Tag className="w-4 h-4" /> הערת לקוח
                            </h3>
                            <p className="text-gray-800 whitespace-pre-wrap">{order.customer_note}</p>
                        </div>
                    )}
                    
                    <div>
                        <h3 className="font-semibold mb-3 flex items-center gap-2"><ShoppingCart className="w-4 h-4" /> מוצרים</h3>
                        <div className="border rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-100">
                                    <tr>
                                        <th className="p-2 text-right font-medium">מוצר</th>
                                        <th className="p-2 text-center font-medium">כמות</th>
                                        <th className="p-2 text-left font-medium">מחיר</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {order.line_items?.map((item, index) => (
                                        <tr key={index} className="border-t">
                                            <td className="p-2">{item.name}</td>
                                            <td className="p-2 text-center">{item.quantity}</td>
                                            <td className="p-2 text-left">₪{parseFloat(item.total).toFixed(2)}</td>
                                        </tr>
                                    ))}
                                    <tr className="border-t bg-gray-50 font-medium">
                                        <td colSpan={2} className="p-2 text-right">עלות משלוח</td>
                                        <td className="p-2 text-left">₪{order.shipping_total ? parseFloat(order.shipping_total).toFixed(2) : '0.00'}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                    
                    {/* Error Display */}
                    {error && (
                        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                            <p className="text-red-900 font-semibold">שגיאה:</p>
                            <p className="text-red-700 text-sm mt-1">{error}</p>
                        </div>
                    )}
                    
                    {/* Shipping Options */}
                    {shippingOptions && shippingOptions.length > 0 && !shipmentCreated && (
                        <div className="space-y-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
                            <h3 className="font-semibold flex items-center gap-2 text-blue-800">
                                <Package className="w-4 h-4" />
                                אפשרויות משלוח זמינות ({shippingOptions.length})
                            </h3>
                            <div className="space-y-2">
                                {shippingOptions.map((option, idx) => {
                                    const price = option.shipping_code?.prices?.[0]?.price || option.rate || 0;
                                    return (
                                        <div 
                                            key={idx}
                                            onClick={() => setSelectedOption(option)}
                                            className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                                                selectedOption === option 
                                                    ? 'border-blue-500 bg-blue-100 shadow-md' 
                                                    : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm'
                                            }`}
                                        >
                                            <div className="flex justify-between items-start">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <p className="font-bold text-gray-900">{option.service_name || option.courier || 'שליח'}</p>
                                                        {selectedOption === option && (
                                                            <Badge className="bg-blue-600"><Check className="w-3 h-3 ml-1" />נבחר</Badge>
                                                        )}
                                                    </div>
                                                    <p className="text-sm text-gray-600 mt-1">{option.description || ''}</p>
                                                    <div className="flex gap-4 mt-2 text-xs text-gray-500">
                                                        <span>שליח: {option.courier || '-'}</span>
                                                        {option.pickup_max_days && <span>איסוף: עד {option.pickup_max_days} ימים</span>}
                                                        {option.dropoff_max_days && <span>משלוח: עד {option.dropoff_max_days} ימים</span>}
                                                    </div>
                                                </div>
                                                <div className="text-left mr-4">
                                                    <p className="font-bold text-xl text-blue-600">₪{price}</p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            
                            {selectedOption && (
                                <Button 
                                    onClick={handleCreateShipment}
                                    disabled={isCreatingShipment}
                                    className="w-full bg-green-600 hover:bg-green-700 mt-3"
                                    size="lg"
                                >
                                    <Send className="w-4 h-4 ml-2"/>
                                    {isCreatingShipment ? 'יוצר משלוח...' : 'צור שטר משלוח'}
                                </Button>
                            )}
                        </div>
                    )}

                    {shippingOptions && shippingOptions.length === 0 && !shipmentCreated && (
                        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <p className="text-yellow-800">לא נמצאו אפשרויות משלוח זמינות לכתובת זו</p>
                        </div>
                    )}
                    
                    {shipmentCreated && (
                        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                            <div className="flex items-center gap-3 mb-3">
                                    <CheckCircle className={`w-6 h-6 ${createdShipmentData?.warning ? 'text-yellow-600' : 'text-green-600'}`} />
                                    <div>
                                        <p className={`font-bold text-lg ${createdShipmentData?.warning ? 'text-yellow-900' : 'text-green-900'}`}>
                                            {createdShipmentData?.warning ? 'משלוח נוצר בטיוטה' : 'משלוח נוצר בהצלחה!'}
                                        </p>
                                        <p className="text-sm text-green-700">קוד משלוח: {createdShipmentData?.shipping_code || createdShipmentData?.id || 'ממתין לאישור'}</p>
                                        {createdShipmentData?.status && (
                                            <p className="text-xs text-green-600 mt-1">סטטוס: {createdShipmentData.status}</p>
                                        )}
                                        {createdShipmentData?.warning && (
                                            <p className="text-xs text-yellow-700 mt-1 bg-yellow-100 px-2 py-1 rounded">⚠️ {createdShipmentData.warning}</p>
                                        )}
                                        {createdShipmentData?.tracking_url && (
                                            <a href={createdShipmentData.tracking_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mt-1 block">
                                                🔗 מעקב משלוח
                                            </a>
                                        )}
                                    </div>
                                </div>
                            {(createdShipmentData?.label_url || createdShipmentData?.shipping_code) && (
                                <Button onClick={handlePrintLabel} className="w-full bg-blue-600 hover:bg-blue-700">
                                    <Printer className="w-4 h-4 ml-2" />
                                    הדפס שטר משלוח
                                </Button>
                            )}
                        </div>
                    )}

                    {/* Pickup Point Info Banner */}
                    {hasPickupPointData && !shipmentCreated && (
                        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                            <div className="flex items-center gap-3">
                                <MapPin className="w-6 h-6 text-amber-600 flex-shrink-0" />
                                <div className="flex-1">
                                    <p className="font-semibold text-amber-900">הלקוח בחר נקודת איסוף UPS</p>
                                    <p className="text-sm text-amber-700 mt-1">לחץ על "שטר מטען UPS" כדי ליצור שטר מטען עם נקודת האיסוף שנבחרה</p>
                                </div>
                                <Button 
                                    onClick={() => setShowUpsShipment(true)}
                                    className="bg-amber-600 hover:bg-amber-700 text-white flex-shrink-0"
                                >
                                    <Truck className="w-4 h-4 ml-2"/>
                                    צור שטר מטען
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Status Change Section - Always visible */}
                    <div className="p-4 bg-gray-50 border rounded-lg">
                        <h4 className="font-semibold mb-3 flex items-center gap-2">
                            <Tag className="w-4 h-4" />
                            עדכון סטטוס הזמנה (גם באתר WooCommerce)
                        </h4>
                        <div className="flex gap-2">
                            <Select value={newStatus} onValueChange={setNewStatus}>
                                <SelectTrigger className="flex-1">
                                    <SelectValue placeholder="בחר סטטוס" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="processing">בטיפול</SelectItem>
                                    <SelectItem value="completed">הושלם</SelectItem>
                                    <SelectItem value="on-hold">בהמתנה</SelectItem>
                                    <SelectItem value="cancelled">בוטל</SelectItem>
                                    <SelectItem value="refunded">הוחזר</SelectItem>
                                </SelectContent>
                            </Select>
                            <Button 
                                onClick={handleUpdateStatus} 
                                disabled={isUpdatingStatus || !newStatus || newStatus === order.status}
                                className="bg-purple-600 hover:bg-purple-700"
                            >
                                {isUpdatingStatus ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : null}
                                {isUpdatingStatus ? 'מעדכן...' : 'עדכן סטטוס'}
                            </Button>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">העדכון ישנה את הסטטוס גם כאן וגם באתר WooCommerce</p>
                    </div>
                </div>
                
                <DialogFooter className="p-6 border-t flex justify-between items-center">
                    <div className="flex gap-2">
                        {!shipmentCreated && (
                            <>
                                <Button 
                                    onClick={() => setShowUpsShipment(true)}
                                    className="bg-amber-600 hover:bg-amber-700 text-white"
                                >
                                    <Truck className="w-4 h-4 ml-2"/>
                                    שטר מטען UPS
                                </Button>
                                <Button 
                                    variant="outline" 
                                    onClick={handleCheckShipping}
                                    disabled={isCheckingShipping}
                                    className="bg-blue-50 border-blue-300 hover:bg-blue-100"
                                >
                                    <Package className="w-4 h-4 ml-2"/>
                                    {isCheckingShipping ? 'טוען אפשרויות...' : 'Velo משלוח'}
                                </Button>
                            </>
                        )}
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-lg font-bold">סך הכל:</div>
                        <div className="text-2xl font-bold text-blue-600">₪{order.total ? parseFloat(order.total).toFixed(2) : '0.00'}</div>
                    </div>
                </DialogFooter>

                {showUpsShipment && (
                    <CreateShipmentModal
                        open={showUpsShipment}
                        onClose={() => setShowUpsShipment(false)}
                        order={order}
                        client={order.client_id ? { id: order.client_id, full_name: order.client_name } : null}
                        onSuccess={() => {
                            setShipmentCreated(true);
                        }}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

const InfoItem = ({ icon: Icon, label, value }) => (
    <div className="flex items-start gap-3">
        <Icon className="w-4 h-4 text-gray-500 mt-1 flex-shrink-0" />
        <div>
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-sm font-medium text-gray-800">{value || '-'}</div>
        </div>
    </div>
);