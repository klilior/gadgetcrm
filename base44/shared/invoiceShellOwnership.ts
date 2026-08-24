/**
 * D2b1 — single owner of AUTOMATIC invoice-shell creation.
 *
 * Before this, a mobile/public upload invoked processIntake while the InvoiceIntakeRaw
 * create automation invoked processIntakeAutomation, so two callers could race to create a
 * shell for the same intake. Ownership is now explicit and exclusive:
 *
 *   processIntakeAutomation → the ONE automatic creator.
 *   publicInvoiceUpload     → accepts the file and reports pending; never creates a shell.
 *   processIntake           → manual, idempotent recovery only, using the same shared
 *                             decideIntakeShellAction rules (so it can reuse but not race).
 *
 * Pure and DB-free.
 */

export const AUTOMATIC_SHELL_OWNER = 'processIntakeAutomation';

export const SHELL_CALLERS = {
  PUBLIC_UPLOAD: 'publicInvoiceUpload',
  AUTOMATION: 'processIntakeAutomation',
  MANUAL_RECOVERY: 'processIntake'
};

/**
 * @returns {{caller: string, owns_automatic_creation: boolean, may_create_shell: boolean, mode: 'automatic'|'manual_recovery'|'accept_only', may_invoke_creator: boolean}}
 */
export function planShellOwnership(caller) {
  if (caller === SHELL_CALLERS.AUTOMATION) {
    return { caller, owns_automatic_creation: true, may_create_shell: true, mode: 'automatic', may_invoke_creator: false };
  }
  if (caller === SHELL_CALLERS.MANUAL_RECOVERY) {
    // Manual recovery may create a shell only when the shared decision says 'create' — it is
    // never triggered automatically, so it cannot race the automation owner.
    return { caller, owns_automatic_creation: false, may_create_shell: true, mode: 'manual_recovery', may_invoke_creator: false };
  }
  return { caller, owns_automatic_creation: false, may_create_shell: false, mode: 'accept_only', may_invoke_creator: false };
}

/** True only when exactly one of the given callers owns automatic creation. */
export function hasSingleAutomaticOwner(callers) {
  return (callers || []).map(planShellOwnership).filter((plan) => plan.owns_automatic_creation).length === 1;
}