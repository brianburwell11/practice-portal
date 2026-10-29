/**
 * Site admins: the addresses in ADMIN_EMAILS. They create bands without
 * limits, see the /admin dashboard, and act as the Owner of every band
 * (support access; see `effectiveRole` in can.ts).
 */

/** Whether this email address is a site admin's. */
export function isSiteAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.toLowerCase());
}
