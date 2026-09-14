import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { resolveCorrelationId } from '../../shared/correlation.ts';
import { resolveActor } from '../../shared/actorResolver.ts';
import { upsertIntegrationReference } from '../../shared/integrationReferences.ts';
import { logAudit } from '../../shared/audit.ts';
import { startMigrationRun, finishMigrationRun } from '../../shared/migrationRuns.ts';

function emailKey(value) {
  return String(value || '').trim().toLowerCase();
}

function groupByEmail(records) {
  const map = new Map();
  for (const record of records) {
    const key = emailKey(record.email);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(record);
  }
  return map;
}

export default async function(req) {
  let migrationRun = null;
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const dryRun = body.execute !== true;
    const correlationId = resolveCorrelationId(req, body.correlation_id, 'foundation');
    const actor = await resolveActor(base44, { user });
    const sr = base44.asServiceRole.entities;

    migrationRun = await startMigrationRun(base44, {
      migration_type: 'FOUNDATION_IDENTITY_AND_EXTERNAL_REFERENCE_POC_V1',
      executed_by_user_id: user.id,
      dry_run: dryRun,
      correlation_id: correlationId,
      metadata: { scope: 'Employee exact-email mapping and three dual-storage references' },
    });

    const [employees, users] = await Promise.all([
      sr.Employee.list('email', 500),
      sr.User.list('email', 500),
    ]);
    const employeesByEmail = groupByEmail(employees);
    const usersByEmail = groupByEmail(users);
    const usersById = new Map(users.map((item) => [String(item.id), item]));
    const mappingReport = [];
    let linksChanged = 0;
    let failed = 0;

    for (const employee of employees) {
      const email = emailKey(employee.email);
      const emailEmployees = email ? employeesByEmail.get(email) || [] : [];
      const emailUsers = email ? usersByEmail.get(email) || [] : [];
      const existingUser = employee.user_id ? usersById.get(String(employee.user_id)) : null;
      let matchedUser = null;
      let method = 'UNMATCHED';
      let confidence = 0;
      let conflict = '';

      if (employee.user_id) {
        if (existingUser) {
          matchedUser = existingUser;
          method = 'EXISTING_USER_ID';
          confidence = 100;
        } else {
          method = 'INVALID_EXISTING_USER_ID';
          conflict = 'Employee.user_id does not match an existing User';
        }
      } else if (!email) {
        method = 'NO_EMAIL';
      } else if (emailEmployees.length !== 1) {
        method = 'DUPLICATE_EMPLOYEE_EMAIL';
        conflict = `${emailEmployees.length} Employees share this email`;
      } else if (emailUsers.length !== 1) {
        method = emailUsers.length === 0 ? 'NO_USER_WITH_EMAIL' : 'DUPLICATE_USER_EMAIL';
        conflict = emailUsers.length > 1 ? `${emailUsers.length} Users share this email` : '';
      } else {
        matchedUser = emailUsers[0];
        method = 'EXACT_UNIQUE_EMAIL';
        confidence = 100;
        if (!dryRun) {
          try {
            await sr.Employee.update(employee.id, { user_id: matchedUser.id });
            await logAudit(base44, {
              actor_user_id: actor.user_id,
              actor_employee_id: actor.employee_id,
              entity_type: 'Employee',
              entity_id: employee.id,
              action: 'UPDATE',
              field_changes: { user_id: { before: null, after: matchedUser.id } },
              before_data: { user_id: null },
              after_data: { user_id: matchedUser.id },
              source: 'MIGRATION',
              correlation_id: correlationId,
              request_context: { migration_run_id: migrationRun.id },
            });
            linksChanged++;
          } catch (error) {
            failed++;
            conflict = error.message;
            method = 'LINK_FAILED';
          }
        }
      }

      mappingReport.push({
        employee: employee.employee_name,
        email: employee.email,
        employee_id: employee.id,
        linet_id: employee.linet_employee_code || null,
        matched_user: matchedUser ? {
          id: matchedUser.id,
          email: matchedUser.email,
          name: matchedUser.full_name,
        } : null,
        match_method: method,
        confidence,
        conflict: conflict || null,
        linked: Boolean(employee.user_id) || (!dryRun && method === 'EXACT_UNIQUE_EMAIL' && !conflict),
      });
    }

    const pocReferences = [];
    if (!dryRun) {
      const [clients, products, orders] = await Promise.all([
        sr.Client.list('-created_date', 500),
        sr.Product.list('-created_date', 1000),
        sr.Order.list('-created_date', 500),
      ]);
      const samples = [
        {
          record: clients.find((item) => item.woo_customer_id != null),
          entity_type: 'Customer',
          integration: 'WOOCOMMERCE',
          external_entity_type: 'CUSTOMER',
          externalField: 'woo_customer_id',
        },
        {
          record: products.find((item) => item.woo_product_id != null),
          entity_type: 'Product',
          integration: 'WOOCOMMERCE',
          external_entity_type: 'PRODUCT',
          externalField: 'woo_product_id',
        },
        {
          record: orders.find((item) => item.external_order_number),
          entity_type: 'Order',
          integration: 'WOOCOMMERCE',
          external_entity_type: 'ORDER',
          externalField: 'external_order_number',
        },
      ];

      for (const sample of samples) {
        if (!sample.record) continue;
        const result = await upsertIntegrationReference(base44, {
          entity_type: sample.entity_type,
          entity_id: sample.record.id,
          integration: sample.integration,
          external_entity_type: sample.external_entity_type,
          external_id: sample.record[sample.externalField],
          metadata: { proof_of_concept: true, legacy_field: sample.externalField },
        });
        pocReferences.push({
          id: result.reference.id,
          entity_type: sample.entity_type,
          entity_id: sample.record.id,
          external_key: result.reference.external_key,
          created: result.created,
        });
        if (result.created) {
          await logAudit(base44, {
            actor_user_id: actor.user_id,
            actor_employee_id: actor.employee_id,
            entity_type: 'IntegrationReference',
            entity_id: result.reference.id,
            action: 'CREATE',
            after_data: {
              entity_type: sample.entity_type,
              entity_id: sample.record.id,
              external_key: result.reference.external_key,
            },
            source: 'MIGRATION',
            correlation_id: correlationId,
            request_context: { migration_run_id: migrationRun.id },
          });
        }
      }
    }

    const recordsChanged = linksChanged + pocReferences.filter((item) => item.created).length;
    await finishMigrationRun(base44, migrationRun.id, {
      status: failed > 0 ? 'PARTIAL' : 'COMPLETED',
      records_scanned: employees.length,
      records_changed: recordsChanged,
      records_skipped: employees.length - linksChanged,
      records_failed: failed,
      summary: dryRun
        ? `Dry run completed for ${employees.length} Employees; no business records changed.`
        : `Foundation POC completed: ${linksChanged} Employee links and ${pocReferences.filter((item) => item.created).length} IntegrationReferences created.`,
      rollback_available: false,
      metadata: { employee_links_changed: linksChanged, poc_references: pocReferences },
    });

    return Response.json({
      success: true,
      dry_run: dryRun,
      correlation_id: correlationId,
      migration_run_id: migrationRun.id,
      actor,
      mapping_report: mappingReport,
      employee_links_changed: linksChanged,
      integration_reference_poc: pocReferences,
    });
  } catch (error) {
    return Response.json({
      success: false,
      migration_run_id: migrationRun?.id || null,
      error: error.message,
    }, { status: 500 });
  }
}