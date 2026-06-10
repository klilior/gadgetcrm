/**
 * שכבת מיפוי עובדים אחידה
 * מחברת בין כל מקורות הנתונים: Employee, SalesTransaction, GoalDefinition, LinetUsersMap
 */

/**
 * יוצר מפה של עובדים עם כל השמות האפשריים לזיהוי
 * @param {Array} employees - רשימת עובדים מטבלת Employee
 * @param {Array} linetUsersMap - מיפוי שמות מ-Linet (אופציונלי)
 * @returns {Map} מפה של employee.id -> employee data עם aliases
 */
export function buildEmployeeMap(employees, linetUsersMap = []) {
  const employeeMap = new Map();
  
  // בנה מפה של linet_employee_code -> linet user_name
  const linetMap = new Map();
  linetUsersMap.forEach(mapping => {
    linetMap.set(mapping.user_id, mapping.user_name);
  });
  
  employees.forEach(emp => {
    const fullName = emp.employee_name || '';
    const firstName = fullName.split(' ')[0];
    const linetCode = emp.linet_employee_code;
    const linetName = linetCode ? linetMap.get(linetCode) : null;
    
    // כל השמות האפשריים לזיהוי העובד
    const aliases = new Set([
      fullName.toLowerCase(),
      firstName.toLowerCase(),
      emp.username?.toLowerCase(),
      emp.email?.toLowerCase(),
    ]);
    
    // הוסף את השם מ-Linet אם קיים
    if (linetName) {
      aliases.add(linetName.toLowerCase());
    }
    
    // הסר ערכים ריקים
    aliases.delete('');
    aliases.delete(undefined);
    aliases.delete(null);
    
    employeeMap.set(emp.id, {
      ...emp,
      aliases: Array.from(aliases),
      linetName,
      firstName,
    });
  });
  
  return employeeMap;
}

/**
 * מוצא עובד לפי שם מכל מקור (sales_rep, agent_name וכו')
 * @param {Map} employeeMap - מפת העובדים שנבנתה ע"י buildEmployeeMap
 * @param {string} name - השם לחיפוש
 * @returns {Object|null} העובד שנמצא או null
 */
export function findEmployeeByName(employeeMap, name) {
  if (!name) return null;
  const normalizedName = name.toLowerCase().trim();
  
  for (const [id, emp] of employeeMap) {
    if (emp.aliases.some(alias => 
      alias === normalizedName || 
      alias.startsWith(normalizedName + ' ') ||
      normalizedName.startsWith(alias + ' ') ||
      alias.includes(normalizedName) ||
      normalizedName.includes(alias)
    )) {
      return { id, ...emp };
    }
  }
  return null;
}

/**
 * מוצא עובד לפי ID
 * @param {Map} employeeMap - מפת העובדים
 * @param {string} employeeId - מזהה העובד
 * @returns {Object|null} העובד שנמצא או null
 */
export function findEmployeeById(employeeMap, employeeId) {
  if (!employeeId) return null;
  const emp = employeeMap.get(employeeId);
  return emp ? { id: employeeId, ...emp } : null;
}

/**
 * מסנן עסקאות מכירה לפי עובד
 * @param {Array} salesTransactions - עסקאות מכירה
 * @param {Map} employeeMap - מפת העובדים
 * @param {string} employeeId - מזהה העובד
 * @returns {Array} עסקאות המכירה של העובד
 */
export function filterSalesByEmployee(salesTransactions, employeeMap, employeeId) {
  const emp = employeeMap.get(employeeId);
  if (!emp) return [];
  
  return salesTransactions.filter(tx => {
    if (!tx.sales_rep) return false;
    const salesRepLower = tx.sales_rep.toLowerCase().trim();
    return emp.aliases.some(alias => 
      alias === salesRepLower || 
      alias.startsWith(salesRepLower + ' ') ||
      salesRepLower.startsWith(alias + ' ') ||
      alias.includes(salesRepLower) ||
      salesRepLower.includes(alias)
    );
  });
}

/**
 * מסנן יעדים/מטרות לפי עובד
 * @param {Array} goals - יעדים מ-GoalDefinition
 * @param {Map} employeeMap - מפת העובדים
 * @param {string} employeeId - מזהה העובד
 * @returns {Array} יעדים של העובד
 */
export function filterGoalsByEmployee(goals, employeeMap, employeeId) {
  const emp = employeeMap.get(employeeId);
  if (!emp) return [];
  
  return goals.filter(goal => {
    // יעדים צוותיים חלים על כולם
    if (goal.scope_type === 'TEAM') return true;
    
    // אם יש agent_id תואם
    if (goal.agent_id === employeeId) return true;
    
    // חפש לפי agent_name
    if (!goal.agent_name) return false;
    const goalNameLower = goal.agent_name.toLowerCase().trim();
    
    return emp.aliases.some(alias => 
      alias === goalNameLower || 
      alias.startsWith(goalNameLower + ' ') ||
      goalNameLower.startsWith(alias + ' ') ||
      alias.includes(goalNameLower) ||
      goalNameLower.includes(alias)
    );
  });
}

/**
 * מסנן targets לפי עובד
 * @param {Array} targets - יעדים מ-Target entity
 * @param {string} employeeId - מזהה העובד
 * @returns {Array} יעדים של העובד
 */
export function filterTargetsByEmployee(targets, employeeId) {
  if (!employeeId) return [];
  return targets.filter(t => t.user_id === employeeId);
}

/**
 * חישוב מכירות לפי קטגוריות
 */
export const SalesCategories = {
  isDevice: (category, productName) => {
    if (!category && !productName) return false;
    const catLower = (category || '').toLowerCase();
    const prodLower = (productName || '').toLowerCase();
    return catLower.includes('טלפון') || catLower.includes('סמארטפון') ||
           catLower === 'טלפונים סלולרים' || 
           prodLower.includes('galaxy') || prodLower.includes('iphone') || 
           prodLower.includes('סמסונג') || prodLower.includes('אייפון');
  },
  
  isAccessory: (category) => {
    if (!category) return false;
    const lower = category.toLowerCase();
    return lower.includes('אביזר') || lower === 'אביזרים סלולריים';
  },
  
  isLine: (category, productName) => {
    if (!category && !productName) return false;
    const catLower = (category || '').toLowerCase();
    const prodLower = (productName || '').toLowerCase();

    // אל תסווג כ"קו" אם זה אביזר/חבילה של אביזרים
    if (SalesCategories.isAccessory(category)) return false;

    // זיהוי קווים אמיתי: קו/סים/eSIM/line/SIM (כולל עברית "סים")
    const isLineKeyword = (
      catLower.includes('קו') ||
      catLower.includes('sim') ||
      catLower.includes('סים') ||
      catLower.includes('line') ||
      prodLower.includes('sim') ||
      prodLower.includes('סים') ||
      prodLower.includes('esim') ||
      prodLower.includes('קו') ||
      prodLower.includes('line')
    );

    // הוסר: 'חבילה' ו-'מנוי' כדי לא לתפוס באנדלים של אביזרים
    return isLineKeyword;
  },
  
  is4GLine: (tx) => {
    const cat = (tx.category || '').toLowerCase();
    const prod = (tx.product_name || '').toLowerCase();
    return (cat.includes('4g') || prod.includes('4g')) && !cat.includes('5g') && !prod.includes('5g');
  },
  
  is5GLine: (tx) => {
    const cat = (tx.category || '').toLowerCase();
    const prod = (tx.product_name || '').toLowerCase();
    return cat.includes('5g') || prod.includes('5g');
  }
};

/**
 * מחשב סיכום מכירות מעסקאות
 * @param {Array} salesTransactions - עסקאות מכירה
 * @returns {Object} סיכום מכירות
 */
export function calculateSalesSummary(salesTransactions) {
  const devices = salesTransactions
    .filter(s => SalesCategories.isDevice(s.category, s.product_name))
    .reduce((sum, s) => sum + Math.abs(s.quantity || 1), 0);
    
  const accessoriesRevenue = salesTransactions
    .filter(s => SalesCategories.isAccessory(s.category))
    .reduce((sum, s) => sum + (s.price_ex_vat || 0), 0);
    
  const lineSales = salesTransactions.filter(s => SalesCategories.isLine(s.category, s.product_name));
  const totalLines = lineSales.reduce((sum, s) => sum + Math.abs(Number(s.quantity ?? 1)), 0);
  const lines4g = lineSales.filter(s => SalesCategories.is4GLine(s)).reduce((sum, s) => sum + Math.abs(Number(s.quantity ?? 1)), 0);
  const lines5g = lineSales.filter(s => SalesCategories.is5GLine(s)).reduce((sum, s) => sum + Math.abs(Number(s.quantity ?? 1)), 0);
  
  // אם אין הבחנה 4G/5G, אל תנפח אוטומטית ל-4G; השאר 0 כדי לא להציג מתי שלא ברור
  const finalLines4g = lines4g;
  
  const totalRevenue = salesTransactions.reduce((sum, s) => sum + (s.price_ex_vat || 0), 0);
  
  return {
    Devices: devices,
    AccessoriesRevenue: Math.round(accessoriesRevenue),
    Lines4G: finalLines4g,
    Lines5G: lines5g,
    TotalSalesRevenue: Math.round(totalRevenue),
  };
}

/**
 * ממפה יעדים מ-GoalDefinition לפורמט אחיד
 * @param {Array} goals - יעדים מ-GoalDefinition
 * @returns {Object} מפת יעדים לפי סוג
 */
export function mapGoalsToTargets(goals) {
  const targetMap = {};
  
  goals.forEach(g => {
    let targetType = null;
    
    if (g.commission_group_code === 'DEVICES' && g.metric_type === 'UNITS') {
      targetType = 'Devices';
    } else if (g.commission_group_code === 'ACCESSORIES_GROUP' && g.metric_type === 'NET_AMOUNT') {
      targetType = 'AccessoriesRevenue';
    } else if (g.commission_group_code === 'LINES') {
      if (g.metric_type === 'LINES_4G_UNITS') {
        targetType = 'Lines4G';
      } else if (g.metric_type === 'LINES_5G_UNITS') {
        targetType = 'Lines5G';
      } else if (g.metric_type === 'UNITS') {
        targetType = 'Lines4G'; // ברירת מחדל
      }
    } else if (g.metric_type === 'NET_AMOUNT') {
      targetType = 'TotalSalesRevenue';
    }
    
    if (targetType) {
      // צבור יעדים מאותו סוג
      targetMap[targetType] = (targetMap[targetType] || 0) + (g.target_value || 0);
    }
  });
  
  return targetMap;
}

/**
 * ממפה Targets ליעדים
 * @param {Array} targets - יעדים מ-Target entity
 * @returns {Object} מפת יעדים לפי סוג
 */
export function mapTargetsToMap(targets) {
  const targetMap = {};
  targets.forEach(t => {
    targetMap[t.target_type] = (targetMap[t.target_type] || 0) + (t.target_value || 0);
  });
  return targetMap;
}

// ===== Added helpers: unique assignment and signed sales =====
export function getTxSign(tx) {
  const raw = String(tx?.doc_type ?? '').trim();
  const num = parseInt(raw, 10);
  const isCredit = num === 3 || /credit/i.test(raw) || raw.includes('זיכוי') || raw.includes('זכוי') || raw.includes('credit note');
  const n = (v) => Number(v ?? 0);
  const hasNegative = n(tx.total_row_amount) < 0 || n(tx.price_ex_vat) < 0 || n(tx.quantity) < 0;
  return (isCredit || hasNegative) ? -1 : 1;
}

export function resolveEmployeeForTransaction(employeeMap, tx) {
  if (!tx) return null;
  const directId = tx.employee_id;
  if (directId && employeeMap.has(directId)) return directId;
  const name = (tx.sales_rep || '').toLowerCase().trim();
  if (!name) return null;
  let bestId = null, bestScore = -1;
  for (const [id, emp] of employeeMap) {
    const first = (emp.firstName || '').toLowerCase().trim();
    for (const aliasRaw of (emp.aliases || [])) {
      const a = (aliasRaw || '').toLowerCase().trim();
      let score = 0;
      if (a === name) score = 3; // התאמה מלאה
      else if (first && first === name) score = 2; // שם פרטי מלא
      else if (a.startsWith(name + ' ') || name.startsWith(a + ' ')) score = 1; // prefix
      if (score > bestScore) { bestScore = score; bestId = id; }
    }
  }
  return bestScore > 0 ? bestId : null;
}

export function groupSalesByEmployee(salesTransactions = [], employeeMap) {
  const grouped = {};
  (salesTransactions || []).forEach((tx) => {
    const id = resolveEmployeeForTransaction(employeeMap, tx);
    if (!id) return;
    if (!grouped[id]) grouped[id] = [];
    grouped[id].push(tx);
  });
  return grouped;
}

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase();
}

function getMappedCommissionGroup(tx, commissionMappings = []) {
  const category = normalizeValue(tx?.category);
  const sku = normalizeValue(tx?.sku);
  const productName = normalizeValue(tx?.product_name);

  const sortedMappings = [...(commissionMappings || [])]
    .filter(m => m?.is_active !== false)
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));

  for (const mapping of sortedMappings) {
    const filters = mapping.filters_json || {};
    const categoryIn = (filters.category_in || []).map(normalizeValue);
    const skuIn = (filters.sku_in || []).map(normalizeValue);
    const productContains = (filters.product_name_contains || filters.name_contains || []).map(normalizeValue);

    const matchesCategory = filters.category ? category === normalizeValue(filters.category) : false;
    const matchesCategoryIn = categoryIn.length ? categoryIn.includes(category) : false;
    const matchesSku = filters.sku ? sku === normalizeValue(filters.sku) : false;
    const matchesSkuIn = skuIn.length ? skuIn.includes(sku) : false;
    const matchesProduct = productContains.length ? productContains.some(term => productName.includes(term)) : false;

    if (matchesCategory || matchesCategoryIn || matchesSku || matchesSkuIn || matchesProduct) {
      return mapping.commission_group_code;
    }
  }

  return null;
}

export function calculateSalesSummarySigned(salesTransactions = [], commissionMappings = []) {
  let devices = 0, accessoriesRevenue = 0, totalRevenue = 0, lines4g = 0, lines5g = 0;
  const hasMappings = (commissionMappings || []).length > 0;

  (salesTransactions || []).forEach((s) => {
    const sign = getTxSign(s);
    const qty = Math.abs(Number(s.quantity ?? 1)) || 1;
    const price = Math.abs(Number(s.price_ex_vat ?? s.total_row_amount ?? 0));
    const mappedGroup = getMappedCommissionGroup(s, commissionMappings);

    const isDevice = hasMappings ? mappedGroup === 'DEVICES' : SalesCategories.isDevice(s.category, s.product_name);
    const isAccessory = hasMappings ? mappedGroup === 'ACCESSORIES_GROUP' : SalesCategories.isAccessory(s.category);
    const isLine = hasMappings ? mappedGroup === 'LINES' : SalesCategories.isLine(s.category, s.product_name);

    if (isDevice) devices += sign * qty;
    if (isAccessory) accessoriesRevenue += sign * price;
    if (isLine) {
      if (SalesCategories.is5GLine(s)) lines5g += sign * qty;
      else lines4g += sign * qty;
    }

    totalRevenue += sign * price;
  });

  return {
    Devices: devices,
    AccessoriesRevenue: Math.round(accessoriesRevenue * 100) / 100,
    Lines4G: lines4g,
    Lines5G: lines5g,
    TotalSalesRevenue: Math.round(totalRevenue),
  };
}