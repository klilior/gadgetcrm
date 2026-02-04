import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { X, User, Mail, Phone, MapPin, Truck, Hash, Calendar, Tag, ShoppingCart, Send, Package, CheckCircle } from 'lucide-react';
import { format } from "date-fns";
import { base44 } from "@/api/base44Client";
import { Badge } from '@/components/ui/badge';

export default function OrderDetailsModal({ order, open, onClose, getStatusColor, STATUS_MAPPING }) {
    const [isCheckingShipping, setIsCheckingShipping] = useState(false);
    const [shippingOptions, setShippingOptions] = useState(null);
    const [selectedOption, setSelectedOption] = useState(null);
    const [isCreatingShipment, setIsCreatingShipment] = useState(false);
    const [shipmentCreated, setShipmentCreated] = useState(false);
    const [error, setError] = useState(null);
    
    if (!order) return null;
    
    const statusColor = getStatusColor(order.status);
    const hebrewStatus = STATUS_MAPPING[order.status] || order.status;

    const handleCheckShipping = async () => {
        setIsCheckingShipping(true);
        setError(null);
        
        try {
            console.log('📦 [OrderDetails] Starting shipping check for order:', order.id);
            
            const response = await base44.functions.invoke('veloCheck', {
                orderId: order.id
            });
            
            console.log('📦 [OrderDetails] Response:', response);
            
            if (response.data.success) {
                setShippingOptions(response.data.options);
                alert('✅ אפשרויות משלוח נטענו בהצלחה!');
            } else {
                const errorMsg = response.data.error || 'שגיאה לא ידועה';
                console.error('❌ [OrderDetails] Error:', errorMsg);
                setError(errorMsg);
                alert(`❌ שגיאה: ${errorMsg}`);
                
                // Show debug info if available
                if (response.data.debug) {
                    console.error('🔍 [OrderDetails] Debug info:', response.data.debug);
                }
            }
        } catch (error) {
            console.error('❌ [OrderDetails] Exception:', error);
            const errorMsg = error.response?.data?.error || error.message || 'שגיאה בבדיקת אפשרויות משלוח';
            setError(errorMsg);
            alert(`❌ שגיאה: ${errorMsg}`);
            
            // Log full error
            console.error('Full error:', {
                message: error.message,
                response: error.response?.data,
                stack: error.stack
            });
        } finally {
            setIsCheckingShipping(false);
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
            const { data } = await base44.functions.invoke('veloOrder', {
                orderId: order.id,
                polygonId: selectedOption.polygon_id,
                externalServiceId: selectedOption.external_service_id
            });
            
            if (data.success) {
                setShipmentCreated(true);
                alert(`✅ משלוח נוצר בהצלחה!\nקוד משלוח: ${data.shipment.shipping_code || 'N/A'}`);
            } else {
                const errorMsg = data.error || 'שגיאה ביצירת משלוח';
                setError(errorMsg);
                alert(`❌ שגיאה: ${errorMsg}`);
            }
        } catch (error) {
            console.error('Error creating shipment:', error);
            const errorMsg = error.response?.data?.error || error.message || 'שגיאה ביצירת משלוח';
            setError(errorMsg);
            alert(`❌ שגיאה: ${errorMsg}`);
        } finally {
            setIsCreatingShipment(false);
        }
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
                    {shippingOptions && (
                        <div className="space-y-3 p-4 bg-blue-50 rounded-lg">
                            <h3 className="font-semibold flex items-center gap-2">
                                <Package className="w-4 h-4" />
                                אפשרויות משלוח
                            </h3>
                            {Array.isArray(shippingOptions) && shippingOptions.map((option, idx) => (
                                <div 
                                    key={idx}
                                    onClick={() => setSelectedOption(option)}
                                    className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                                        selectedOption === option 
                                            ? 'border-blue-500 bg-blue-100' 
                                            : 'border-gray-200 bg-white hover:border-blue-300'
                                    }`}
                                >
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <p className="font-medium">{option.courier || 'שליח'}</p>
                                            <p className="text-sm text-gray-600">
                                                זמן: {option.delivery_time || 'N/A'}
                                            </p>
                                        </div>
                                        <div className="text-left">
                                            <p className="font-bold text-lg">₪{option.price || '0'}</p>
                                            {selectedOption === option && (
                                                <Badge className="bg-blue-600">נבחר</Badge>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    
                    {shipmentCreated && (
                        <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
                            <CheckCircle className="w-5 h-5 text-green-600" />
                            <div>
                                <p className="font-semibold text-green-900">משלוח נוצר בהצלחה!</p>
                                <p className="text-sm text-green-700">ההזמנה נשלחה לאישור ב-Velo Dashboard</p>
                            </div>
                        </div>
                    )}
                </div>
                
                <DialogFooter className="p-6 border-t flex justify-between items-center">
                    <div className="flex gap-2">
                        {!shipmentCreated && (
                            <>
                                <Button 
                                    variant="outline" 
                                    onClick={handleCheckShipping}
                                    disabled={isCheckingShipping}
                                >
                                    <Package className="w-4 h-4 ml-2"/>
                                    {isCheckingShipping ? 'בודק...' : 'בדוק משלוח'}
                                </Button>
                                {shippingOptions && (
                                    <Button 
                                        onClick={handleCreateShipment}
                                        disabled={!selectedOption || isCreatingShipment}
                                        className="bg-green-600 hover:bg-green-700"
                                    >
                                        <Send className="w-4 h-4 ml-2"/>
                                        {isCreatingShipment ? 'יוצר...' : 'צור משלוח'}
                                    </Button>
                                )}
                            </>
                        )}
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-lg font-bold">סך הכל:</div>
                        <div className="text-2xl font-bold text-blue-600">₪{order.total ? parseFloat(order.total).toFixed(2) : '0.00'}</div>
                    </div>
                </DialogFooter>
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