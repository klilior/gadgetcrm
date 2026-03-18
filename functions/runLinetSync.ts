import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { format, subDays, parseISO, addMonths, addDays } from 'npm:date-fns@2.30.0';

const BASE_URL = "https://app.linet.org.il/api";
const SYNC_KEY = "linet_main_sync";
const MAX_EXECUTION_TIME = 240000; // 4 min
const BATCH_SIZE = 50;

function normalizePhoneNumber(phone) {
    if (!phone) return null;
    let digits = phone.replace(/[^\d]/g, '');
    if (digits.length === 13 && digits.startsWith('9720')) digits = digits.slice(3);
    else if (digits.length === 12 && digits.startsWith('972')) digits = '0' + digits.slice(3);
    else if (digits.startsWith('0972') && digits.length > 12) digits = '0' + digits.slice(4);
    if (digits.length === 10 && digits.startsWith('0')) return digits;
    if (digits.length === 9 && !digits.startsWith('0')) return '0' + digits;
    if (digits.length >= 9 && digits.length <= 11) {
        if (!digits.startsWith('0')) digits = '0' + digits;
        return digits.slice(0, 10);
    }
    return null;
}

function parseNum(value) {
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/,/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

async function getLinetCredentials(base44) {
  let login_id = Deno.env.get("LINET_LOGIN_ID");
  let login_hash = Deno.env.get("LINET_LOGIN_HASH");
  let login_company = Deno.env.get("LINET_LOGIN_COMPANY");

  if (!login_id || !login_hash || !login_company) {
    const settingsList = await base44.asServiceRole.entities.Settings.list();
    const getSetting = (name) => settingsList.find((s) => s.setting_name === name)?.setting_value;
    login_id = login_id || getSetting("LINET_LOGIN_ID");
    login_hash = login_hash || getSetting("LINET_LOGIN_HASH");
    login_company = login_company || getSetting("LINET_LOGIN_COMPANY");
  }

  if (!login_id || !login_hash || !login_company) throw new Error("Missing Linet credentials");
  return { login_id, login_hash, login_company: Number(login_company) };
}

async function loadCaches(base44) {
  console.log("📥 Loading caches...");
  const transList = await base44.asServiceRole.entities.LinetCategoryTranslation.list(null, 1000);
  const categoryTranslationMap = {};
  transList.forEach((t) => (categoryTranslationMap[t.category_id] = t.category_name));

  const productCache = {};
  let hasMore = true;
  let offset = 0;
  while (hasMore) {
    const maps = await base44.asServiceRole.entities.LinetProductMap.list(null, 1000, offset);
    for (const m of maps) {
      if (!m.sku) continue;
      let finalName = m.linet_category_name;
      if (finalName) {
        let idPart = null;
        if (finalName.startsWith('Unknown Cat ')) idPart = finalName.replace('Unknown Cat ', '').trim();
        else if (finalName.startsWith('cat_id:')) idPart = finalName.replace('cat_id:', '').trim();
        else if (!isNaN(finalName)) idPart = finalName;
        if (idPart && categoryTranslationMap[idPart]) finalName = categoryTranslationMap[idPart];
      }
      productCache[m.sku] = finalName;
    }
    if (maps.length < 1000) hasMore = false;
    else offset += 1000;
  }

  const usersList = await base44.asServiceRole.entities.LinetUsersMap.list(null, 1000);
  const usersMap = {};
  usersList.forEach((u) => (usersMap[String(u.user_id)] = u.user_name));

  console.log(`✅ Loaded ${Object.keys(productCache).length} products, ${Object.keys(categoryTranslationMap).length} categories, ${Object.keys(usersMap).length} users`);
  return { categoryTranslationMap, productCache, usersMap };
}

async function fetchDocuments(credentials, dateFrom, dateTo, limit, offset) {
  const payload = {
    ...credentials, limit, offset,
    query: { issue_date: `${dateFrom} to ${dateTo}`, doctype: ["9", "3", "4"], refstatus: null },
  };
  const response = await fetch(`${BASE_URL}/newsearch/docs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Linet API Error ${response.status}: ${errorText}`);
  }
  const apiResponse = await response.json();
  if (apiResponse.errorCode && apiResponse.errorCode !== 0) throw new Error(`Linet Error ${apiResponse.errorCode}: ${apiResponse.text || 'Unknown error'}`);
  return apiResponse.body || [];
}

async function fetchProductCategory(credentials, sku, categoryTranslationMap) {
  try {
    const payload = { ...credentials, limit: 1, offset: 0, query: { sku } };
    const response = await fetch(`${BASE_URL}/newsearch/item`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (response.ok) {
      const data = await response.json();
      if (data.body && data.body.length > 0) {
        const cat_id = data.body[0].cat_id || data.body[0].category_id;
        if (cat_id) return categoryTranslationMap[cat_id] || `cat_id:${cat_id}`;
      }
    }
  } catch (_err) {}
  return 'Uncategorized';
}

async function upsertTransaction(base44, txData) {
  return retryOnRateLimit(async () => {
    const existing = await base44.asServiceRole.entities.SalesTransaction.filter(
      { linet_doc_id: txData.linet_doc_id, sku: txData.sku || '' }, null, 1,
    );
    if (existing.length > 0) {
      await base44.asServiceRole.entities.SalesTransaction.update(existing[0].id, txData);
      return 'updated';
    } else {
      await base44.asServiceRole.entities.SalesTransaction.create(txData);
      return 'created';
    }
  });
}

function phoneSearchVariants(phone) {
  if (!phone) return [];
  const variants = [phone];
  if (phone.startsWith('0') && phone.length === 10) {
    variants.push('972' + phone.slice(1));
    variants.push('+972' + phone.slice(1));
    variants.push('9720' + phone.slice(1));
    variants.push('+9720' + phone.slice(1));
  }
  return variants;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function retryOnRateLimit(fn, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (e.message && e.message.includes('429') && i < retries - 1) {
        const waitTime = Math.min((i + 1) * 3000, 15000);
        console.log(`⏳ Rate limited, waiting ${waitTime/1000}s (attempt ${i+1}/${retries})...`);
        await delay(waitTime);
      } else throw e;
    }
  }
}

async function findOrCreateClientFromLinetDoc(sr, doc) {
  const phone = normalizePhoneNumber(doc.mobile || doc.phone || doc.account_phone);
  const email = doc.email || null;
  const name = doc.company_name || doc.account_name || doc.company || 'לקוח לינט';
  const accountId = doc.account_id ? Number(doc.account_id) : null;
  const city = doc.city || null;
  const address = doc.address || null;

  if (accountId) {
    const byLinet = await sr.Client.filter({ linet_account_id: accountId }, null, 1);
    if (byLinet.length > 0) {
      const updates = {};
      if (phone && !byLinet[0].phone) updates.phone = phone;
      if (email && !byLinet[0].email) updates.email = email;
      if (city && !byLinet[0].city) updates.city = city;
      if (!byLinet[0].full_name || byLinet[0].full_name === 'לקוח חדש') updates.full_name = name;
      updates.last_interaction_date = new Date().toISOString();
      if (Object.keys(updates).length > 0) await sr.Client.update(byLinet[0].id, updates);
      return byLinet[0].id;
    }
  }

  if (phone) {
    const variants = phoneSearchVariants(phone);
    for (const variant of variants) {
      const byPhone = await sr.Client.filter({ phone: variant }, null, 1);
      if (byPhone.length > 0) {
        const updates = { last_interaction_date: new Date().toISOString() };
        if (accountId && !byPhone[0].linet_account_id) updates.linet_account_id = accountId;
        if (email && !byPhone[0].email) updates.email = email;
        if (byPhone[0].phone !== phone) updates.phone = phone;
        await sr.Client.update(byPhone[0].id, updates);
        return byPhone[0].id;
      }
    }
  }

  if (email) {
    const byEmail = await sr.Client.filter({ email: email.toLowerCase().trim() }, null, 1);
    if (byEmail.length > 0) {
      const updates = { last_interaction_date: new Date().toISOString() };
      if (accountId && !byEmail[0].linet_account_id) updates.linet_account_id = accountId;
      if (phone && !byEmail[0].phone) updates.phone = phone;
      if (!byEmail[0].full_name || byEmail[0].full_name === 'לקוח חדש') updates.full_name = name;
      await sr.Client.update(byEmail[0].id, updates);
      return byEmail[0].id;
    }
  }

  const byName = await sr.Client.filter({ full_name: name }, null, 1);
  if (byName.length > 0) {
    const updates = { last_interaction_date: new Date().toISOString() };
    if (accountId && !byName[0].linet_account_id) updates.linet_account_id = accountId;
    if (phone && !byName[0].phone) updates.phone = phone;
    if (email && !byName[0].email) updates.email = email;
    await sr.Client.update(byName[0].id, updates);
    return byName[0].id;
  }

  const newClient = await sr.Client.create({
    full_name: name, phone: phone || null, email: email || null,
    city: city || null, full_address: address || null,
    linet_account_id: accountId, source: 'Linet',
  });
  return newClient.id;
}

async function createLineContractFromSale(base44, sale, carrierCode, carrierName, carrierPolicy) {
  const existing = await base44.asServiceRole.entities.LineContract.filter(
    { original_invoice_id: sale.linet_doc_id, customer_name: sale.customer_name }, null, 1,
  );
  if (existing.length > 0) return 'skipped';

  const activationDate = new Date(sale.issue_date);
  let safeDate = addMonths(activationDate, carrierPolicy.churn_window_months || 12);
  safeDate = addDays(safeDate, carrierPolicy.safety_buffer_days || 30);
  const safe_retarget_date = format(safeDate, 'yyyy-MM-dd');
  const today = new Date();
  const status = safeDate <= today ? 'ELIGIBLE' : 'LOCKED';

  let customer_id;
  try {
    customer_id = await findOrCreateClientFromLinetDoc(base44.asServiceRole.entities, {
      company_name: sale.customer_name, account_id: sale.linet_account_id,
    });
  } catch (_e) {
    let customers = await base44.asServiceRole.entities.Client.filter({ full_name: sale.customer_name }, null, 1);
    if (customers.length > 0) customer_id = customers[0].id;
    else {
      const newCustomer = await base44.asServiceRole.entities.Client.create({ full_name: sale.customer_name, source: 'LINET_SYNC' });
      customer_id = newCustomer.id;
    }
  }

  const agentMaps = await base44.asServiceRole.entities.LinetUsersMap.filter({ user_name: sale.sales_rep }, null, 1);
  const agent_id = agentMaps.length > 0 ? agentMaps[0].user_id : sale.sales_rep;

  await base44.asServiceRole.entities.LineContract.create({
    customer_id, customer_name: sale.customer_name, linet_account_id: sale.linet_account_id,
    carrier_code: carrierCode, carrier_name: carrierName,
    activation_date: sale.issue_date, original_invoice_id: sale.linet_doc_id,
    agent_id, agent_name: sale.sales_rep, account_owner_id: agent_id, account_owner_name: sale.sales_rep,
    safe_retarget_date, status, last_action_date: new Date().toISOString(), last_action_type: 'SYNC_CREATED',
  });
  return 'created';
}

async function handleUndeliveredOrderTask(base44, doc, usersMap, triggerSku) {
  const linet_doc_id = String(doc.id);
  const doc_number = String(doc.docnum);
  const issue_date = doc.issue_date ? doc.issue_date.split(' ')[0] : null;
  const sales_rep_name = usersMap[String(doc.owner)] || String(doc.owner);
  const customer_name = doc.company_name || doc.account_name || doc.company || 'General Customer';
  let customer_phone = doc.phone || doc.mobile || doc.account_phone || null;

  const products = [];
  if (Array.isArray(doc.docDetailes)) {
    for (const line of doc.docDetailes) {
      if (line.sku === triggerSku) continue;
      if (!line.sku && !line.name) continue;
      products.push({ sku: line.sku || '', product_name: line.name || '', qty: Math.abs(parseFloat(line.qty) || 0) });
    }
  }

  const userMaps = await base44.asServiceRole.entities.LinetUsersMap.filter({ user_name: sales_rep_name }, null, 1);
  const owner_user_id = userMaps.length > 0 ? userMaps[0].base44_user_id || String(doc.owner) : String(doc.owner);

  let existing = await base44.asServiceRole.entities.UndeliveredOrderTask.filter({ source_doc_id: linet_doc_id }, null, 1);
  if (existing.length === 0) {
    existing = await base44.asServiceRole.entities.UndeliveredOrderTask.filter({ source_doc_number: doc_number, source_doc_date: issue_date }, null, 1);
  }

  const taskData = {
    source_system: 'Linet', source_doc_id: linet_doc_id, source_doc_number: doc_number,
    source_doc_date: issue_date, owner_user_id, owner_name: sales_rep_name,
    customer_name, customer_phone, products_list: JSON.stringify(products),
  };

  if (existing.length > 0) {
    const existingTask = existing[0];
    if (existingTask.status === 'Open') {
      await base44.asServiceRole.entities.UndeliveredOrderTask.update(existingTask.id, {
        customer_name: taskData.customer_name, customer_phone: taskData.customer_phone, products_list: taskData.products_list,
      });
      return 'updated';
    }
    return 'skipped';
  } else {
    await base44.asServiceRole.entities.UndeliveredOrderTask.create({
      ...taskData, status: 'Open',
      activity_log: JSON.stringify([{ action: 'נוצר אוטומטית מסנכרון לינט', user: 'system', timestamp: new Date().toISOString() }]),
    });
    return 'created';
  }
}

function detectCarrier(sku, productName, mappings) {
  if (!mappings || mappings.length === 0) return null;
  if (sku) {
    const exactMatch = mappings.find((m) => m.product_sku_exact === sku);
    if (exactMatch) return exactMatch.carrier_code;
  }
  if (sku) {
    const prefixMatch = mappings.find((m) => m.product_sku_prefix && sku.startsWith(m.product_sku_prefix));
    if (prefixMatch) return prefixMatch.carrier_code;
  }
  if (productName) {
    const nameMatch = mappings.find((m) => m.name_contains && productName.toLowerCase().includes(m.name_contains.toLowerCase()));
    if (nameMatch) return nameMatch.carrier_code;
  }
  return null;
}

async function executeLinetSync(base44, body = {}) {
  const runStartedAt = new Date().toISOString();
  let syncLog = null;
  try {
    let fromDatetime = body.from_datetime;
    const toDatetime = body.to_datetime || new Date().toISOString();
    const triggerType = body.trigger_type || 'MANUAL';
    const updateLastSuccessful = body.update_last_successful !== false;
    const createLineContracts = body.create_line_contracts !== false;
    const disableCustomerSync = body.disable_customer_sync === true;
    const skipClientMatching = body.skip_client_matching === true;

    if (!fromDatetime) {
      fromDatetime = subDays(new Date(), 1).toISOString();
      console.log(`ℹ️ No from_datetime provided, defaulting to: ${fromDatetime}`);
    }

    console.log(`🚀 Starting Linet Sync: ${fromDatetime} → ${toDatetime} (${triggerType})`);

    syncLog = await base44.asServiceRole.entities.SyncLog.create({
      sync_key: SYNC_KEY, run_started_at: runStartedAt, status: 'RUNNING',
      from_datetime: fromDatetime, to_datetime: toDatetime, trigger_type: triggerType,
      records_fetched: 0, records_created: 0, records_updated: 0, records_skipped: 0,
    });

    const metadataList = await base44.asServiceRole.entities.SyncMetadata.filter({ sync_key: SYNC_KEY });
    let metadata = metadataList[0];
    if (metadata) {
      await base44.asServiceRole.entities.SyncMetadata.update(metadata.id, { status: 'RUNNING', last_attempt: runStartedAt });
    } else {
      metadata = await base44.asServiceRole.entities.SyncMetadata.create({ sync_key: SYNC_KEY, status: 'RUNNING', last_attempt: runStartedAt, consecutive_failures: 0 });
    }

    const credentials = await getLinetCredentials(base44);
    const { categoryTranslationMap, productCache, usersMap } = await loadCaches(base44);

    const carrierMappings = createLineContracts ? await base44.asServiceRole.entities.CarrierProductMapping.filter({ is_active: true }, '-priority', 200) : [];
    const carrierPolicies = {};
    if (createLineContracts) {
      const policiesList = await base44.asServiceRole.entities.CarrierPolicy.filter({ is_active: true });
      policiesList.forEach((p) => (carrierPolicies[p.carrier_code] = p));
    }

    const dateFrom = fromDatetime ? format(parseISO(fromDatetime), 'yyyy-MM-dd') : format(subDays(new Date(), 1), 'yyyy-MM-dd');
    const dateTo = format(parseISO(toDatetime), 'yyyy-MM-dd');

    let offset = 0;
    let moreData = true;
    let stats = { fetched: 0, created: 0, updated: 0, skipped: 0, line_contracts_created: 0, undelivered_tasks_created: 0, undelivered_tasks_updated: 0, clients_created: 0 };
    const startTime = Date.now();
    const allDocuments = [];
    const UNDELIVERED_TRIGGER_SKU = '963258741';

    while (moreData) {
      if (Date.now() - startTime > MAX_EXECUTION_TIME) {
        await base44.asServiceRole.entities.SyncLog.update(syncLog.id, { run_finished_at: new Date().toISOString(), status: 'PARTIAL', records_fetched: stats.fetched, records_created: stats.created, records_updated: stats.updated, records_skipped: stats.skipped, details_json: { stopped_at_offset: offset, line_contracts: stats.line_contracts_created } });
        await base44.asServiceRole.entities.SyncMetadata.update(metadata.id, { status: 'PARTIAL', last_error_message: `Stopped at offset ${offset} due to time limit` });
        return { success: true, partial: true, nextOffset: offset, stats };
      }

      const documents = await fetchDocuments(credentials, dateFrom, dateTo, BATCH_SIZE, offset);
      if (!documents || documents.length === 0) { moreData = false; break; }

      stats.fetched += documents.length;
      allDocuments.push(...documents);

      for (const doc of documents) {
        const raw_doctype = Number(doc.doctype);
        if (![3, 4, 9].includes(raw_doctype)) { stats.skipped++; continue; }

        const linet_doc_id = String(doc.id);
        const doc_number = String(doc.docnum);
        const issue_date = doc.issue_date ? doc.issue_date.split(' ')[0] : null;
        const sales_rep_name = usersMap[String(doc.owner)] || String(doc.owner);
        const customer_name = doc.company_name || doc.account_name || doc.company || 'General Customer';
        const linet_account_id = doc.account_id ? Number(doc.account_id) : null;
        const is_credit = raw_doctype === 4;

        let linked_client_id = null;
        if (!skipClientMatching) {
          try {
            linked_client_id = await retryOnRateLimit(() => findOrCreateClientFromLinetDoc(base44.asServiceRole.entities, doc));
            stats.clients_created++;
          } catch (_clientErr) {}
        }

        if (Array.isArray(doc.docDetailes)) {
          const hasUndeliveredTrigger = doc.docDetailes?.some((line) => line.sku === UNDELIVERED_TRIGGER_SKU);
          if (hasUndeliveredTrigger && !is_credit) {
            try {
              const taskResult = await handleUndeliveredOrderTask(base44, doc, usersMap, UNDELIVERED_TRIGGER_SKU);
              if (taskResult === 'created') stats.undelivered_tasks_created++;
              else if (taskResult === 'updated') stats.undelivered_tasks_updated++;
            } catch (_e) {}
          }

          for (const line of doc.docDetailes) {
            const sku = line.sku || '';
            const product_name = line.name || '';
            let quantity = parseNum(line.qty);
            let total_row_amount = parseNum(line.iTotalVat);
            let price_ex_vat = parseNum(line.iTotal);
            let unit_price = line.price ? parseNum(line.price) : quantity !== 0 ? total_row_amount / quantity : 0;

            let category_name = 'Uncategorized';
            if (sku) {
              if (productCache[sku]) category_name = productCache[sku];
              else {
                category_name = await fetchProductCategory(credentials, sku, categoryTranslationMap);
                productCache[sku] = category_name;
                try { await base44.asServiceRole.entities.LinetProductMap.create({ sku, linet_category_name: category_name, last_checked: new Date().toISOString() }); } catch (_dup) {}
              }
            }

            if (is_credit) {
              quantity = Math.abs(quantity) * -1;
              total_row_amount = Math.abs(total_row_amount) * -1;
              price_ex_vat = Math.abs(price_ex_vat) * -1;
            }

            const txData = {
              linet_doc_id, doc_number, doc_type: is_credit ? 'חשבונית זיכוי' : 'חשבונית מס קבלה',
              issue_date, sales_rep: sales_rep_name, customer_name, linet_account_id,
              client_id: linked_client_id || null, sku, product_name, quantity, unit_price,
              total_row_amount, price_ex_vat, category: category_name, sync_timestamp: new Date().toISOString(),
            };

            try {
              const result = await upsertTransaction(base44, txData);
              if (result === 'created') stats.created++; else stats.updated++;

              if (createLineContracts && !is_credit && quantity > 0) {
                const carrierCode = detectCarrier(sku, product_name, carrierMappings);
                if (carrierCode && carrierPolicies[carrierCode]) {
                  try {
                    const contractResult = await createLineContractFromSale(base44, { ...txData, linet_doc_id }, carrierCode, carrierPolicies[carrierCode].carrier_name, carrierPolicies[carrierCode]);
                    if (contractResult === 'created') stats.line_contracts_created++;
                  } catch (_contractErr) {}
                }
              }
            } catch (_err) { stats.skipped++; }
          }
        }
      }

      if (documents.length < BATCH_SIZE) { moreData = false; } else { offset += BATCH_SIZE; }
      // Throttle between batches to avoid rate limiting
      await delay(500);
    }

    const runFinishedAt = new Date().toISOString();
    await base44.asServiceRole.entities.SyncLog.update(syncLog.id, { run_finished_at: runFinishedAt, status: 'SUCCESS', records_fetched: stats.fetched, records_created: stats.created, records_updated: stats.updated, records_skipped: stats.skipped, details_json: { line_contracts_created: stats.line_contracts_created } });

    const metadataUpdate = { status: 'SUCCESS', last_error_message: null, consecutive_failures: 0 };
    if (updateLastSuccessful) metadataUpdate.last_successful_sync = runFinishedAt;
    const mdList = await base44.asServiceRole.entities.SyncMetadata.filter({ sync_key: SYNC_KEY });
    if (mdList[0]) await base44.asServiceRole.entities.SyncMetadata.update(mdList[0].id, metadataUpdate);

    let customerSyncStats = null;
    try {
      if (!disableCustomerSync) {
        const uniqueAccountIds = [...new Set(allDocuments.map((doc) => doc.account_id).filter((id) => id && !isNaN(Number(id))).map((id) => Number(id)))];
        if (uniqueAccountIds.length > 0) {
          try {
            const customerSync = await base44.asServiceRole.functions.invoke('syncLinetCustomers', { account_ids: uniqueAccountIds, force_refresh: false });
            customerSyncStats = customerSync.stats;
          } catch (invokeErr) { console.log('⚠️ syncLinetCustomers failed:', invokeErr.message); }
        }
      }
    } catch (customerErr) { console.log('⚠️ Customer sync skipped:', customerErr.message); }

    let deviceSyncStats = null;
    try {
      if (allDocuments.length > 0) {
        const enrichedDocs = allDocuments.map(doc => {
          if (Array.isArray(doc.docDetailes)) {
            for (const line of doc.docDetailes) {
              if (line.sku && productCache[line.sku]) line.category_name = productCache[line.sku];
            }
          }
          return doc;
        });
        const deviceResult = await base44.asServiceRole.functions.invoke('processInvoiceDevices', { documents: enrichedDocs });
        deviceSyncStats = deviceResult.stats;
        console.log('📱 Device sync result:', JSON.stringify(deviceSyncStats));
      }
    } catch (deviceErr) { console.log('⚠️ Device sync skipped:', deviceErr.message); }

    return { success: true, stats, customer_sync: customerSyncStats, device_sync: deviceSyncStats, message: `סנכרון הושלם: ${stats.created} נוצרו, ${stats.updated} עודכנו, ${stats.line_contracts_created} חוזי קווים, ${stats.clients_created} לקוחות, ${stats.undelivered_tasks_created} משימות הזמנות` };
  } catch (error) {
    const errorMessage = error?.message || error?.toString() || String(error);
    try {
      if (syncLog) await base44.asServiceRole.entities.SyncLog.update(syncLog.id, { run_finished_at: new Date().toISOString(), status: 'FAILED', error_message: errorMessage });
      const metadataList = await base44.asServiceRole.entities.SyncMetadata.filter({ sync_key: SYNC_KEY });
      if (metadataList[0]) {
        const currentFailures = metadataList[0].consecutive_failures || 0;
        await base44.asServiceRole.entities.SyncMetadata.update(metadataList[0].id, { status: 'FAILED', last_error_message: errorMessage, consecutive_failures: currentFailures + 1 });
      }
    } catch (_e) {}
    return { success: false, error: errorMessage };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let body = {};
    try {
      const text = await req.text();
      if (text && text.trim()) body = JSON.parse(text);
    } catch (_e) {}

    const result = await executeLinetSync(base44, body);
    return Response.json(result, { status: result?.success ? 200 : 500 });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});