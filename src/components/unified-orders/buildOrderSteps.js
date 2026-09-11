// בונה את שלבי הטיפול בהזמנה מתוך הנתונים שקיימים כבר בפאנל — ללא קריאות רשת.
// status: done | current | todo | blocked | skipped
export function buildOrderSteps({
  isMiraklNew,
  pickingApplies,
  pickingStatus,
  isSelfPickupOrder,
  hasInvoice,
  hasShipment,
  isLocked,
  blockReason,
}) {
  const steps = [];

  if (isMiraklNew) {
    steps.push({ key: "accept", title: "אישור הזמנה", hint: "אשר את ההזמנה מול סופר-פארם", status: "current" });
    steps.push({ key: "picking", title: "ליקוט", hint: "ייפתח לאחר האישור", status: "todo" });
    steps.push({ key: "invoice", title: "חשבונית", hint: "", status: "todo" });
    steps.push({ key: "shipment", title: "משלוח", hint: "", status: "todo" });
    steps.push({ key: "done", title: "סגירה", hint: "", status: "todo" });
    return steps;
  }

  const pickingDone = !pickingApplies || pickingStatus === "completed";
  steps.push({
    key: "picking",
    title: "ליקוט וסריאלים",
    hint: pickingApplies
      ? pickingDone ? "כל הפריטים נאספו" : "סמן את כל הפריטים ברשימת הליקוט"
      : "לא נדרש להזמנה זו",
    status: !pickingApplies ? "skipped" : pickingDone ? "done" : "current",
  });

  steps.push({
    key: "invoice",
    title: "חשבונית",
    hint: hasInvoice ? "הופקה" : pickingDone ? "הנפק חשבונית בכרטיס הטיפול" : "ייפתח בסיום הליקוט",
    status: hasInvoice ? "done" : pickingDone ? "current" : "todo",
  });

  steps.push({
    key: "shipment",
    title: isSelfPickupOrder ? "מסירה בחנות" : "משלוח",
    hint: isSelfPickupOrder
      ? "איסוף עצמי — אין משלוח"
      : hasShipment ? "נוצר משלוח" : blockReason || (pickingDone ? "בחר חברת שילוח וצור משלוח" : "ייפתח בסיום הליקוט"),
    status: isSelfPickupOrder
      ? "skipped"
      : hasShipment ? "done" : blockReason ? "blocked" : pickingDone && hasInvoice ? "current" : "todo",
  });

  steps.push({
    key: "done",
    title: "סגירה",
    hint: isLocked ? "ההזמנה נעולה — הטיפול הושלם" : "מתעדכן אוטומטית עם סיום הטיפול",
    status: isLocked ? "done" : "todo",
  });

  return steps;
}