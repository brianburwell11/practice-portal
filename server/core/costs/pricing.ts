/**
 * What each service charges, for the cost estimate on /admin. These change:
 * check them against the pages below now and then, and update `VERIFIED`.
 *
 *   Fly.io   https://fly.io/docs/about/pricing/
 *   Neon     https://neon.com/pricing
 *   R2       https://developers.cloudflare.com/r2/pricing/
 *   Resend   https://resend.com/pricing
 *
 * "List" prices are what the usage would cost on a paid plan with no free
 * allowance. "Billed" applies the plan we're actually on.
 */

export const VERIFIED = '2026-11-05';

const HOURS_PER_MONTH = 730;

export const PRICING = {
  fly: {
    /**
     * shared-cpu-1x with 1 GB (fly.toml), billed per second while running:
     * $2.19/mo for the 256 MB base plus 0.75 GB at $6/GB-mo (memory went
     * from $5 to $6 per GB on 2026-10-01).
     */
    machineUsdPerHour: (2.19 + 0.75 * 6) / HOURS_PER_MONTH,
    /** No free allowance: every running second is billed. */
  },
  neon: {
    /** We're on the free plan: over a limit, compute is suspended, not billed. */
    plan: 'free' as 'free' | 'launch',
    freeCuHours: 100,
    freeStorageGb: 0.5,
    /** Launch plan rates, for the list price. */
    usdPerCuHour: 0.106,
    usdPerGbMonth: 0.35,
    /**
     * Compute size while awake. The free plan's default is 0.25 CU; override
     * with NEON_CU if it's been changed in the Neon console.
     */
    cu: Number(process.env.NEON_CU) || 0.25,
  },
  r2: {
    freeGb: 10,
    usdPerGbMonth: 0.015,
  },
  resend: {
    /** Free: 3,000 a month (100 a day). Pro: $20 for 50,000. */
    freeEmails: 3000,
    proUsdPerMonth: 20,
    /** Pro's $20 spread over its 50,000, for the list price. */
    listUsdPerEmail: 20 / 50_000,
  },
  /** practiceportal.app, paid yearly. Set DOMAIN_YEARLY_USD to the real renewal price. */
  domainUsdPerMonth: (Number(process.env.DOMAIN_YEARLY_USD) || 0) / 12,
};
