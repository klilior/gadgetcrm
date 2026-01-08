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
    return catLower.includes('קו') || catLower.includes('sim') || catLower.includes('line') || 
           catLower.includes('חבילה') || catLower.includes('מנוי') ||
           prodLower.includes('sim') || prodLower.includes('קו') || prodLower.includes('חבילה');
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
  const totalLines = lineSales.reduce((sum, s) => sum + Math.abs(s.quantity || 1), 0);
  const lines4g = lineSales.filter(s => SalesCategories.is4GLine(s)).reduce((sum, s) => sum + Math.abs(s.quantity || 1), 0);
  const lines5g = lineSales.filter(s => SalesCategories.is5GLine(s)).reduce((sum, s) => sum + Math.abs(s.quantity || 1), 0);
  
  // אם אין הבחנה 4G/5G, שים הכל ב-4G
  const finalLines4g = lines4g > 0 ? lines4g : (totalLines > 0 && lines5g === 0 ? totalLines : 0);
  
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