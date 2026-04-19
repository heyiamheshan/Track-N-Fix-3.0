/**
 * attendanceUtils.ts
 * Pure business-logic helpers for attendance rules.
 * No Prisma / Express dependencies — safe to unit-test in isolation.
 */

/** Minutes past midnight for the workshop closing time (18:30). */
export const CLOSING_TIME_MINUTES = 18 * 60 + 30; // 1110

/** Grace window (minutes) allowed before a late leave-return is flagged. */
export const LEAVE_GRACE_MINUTES = 30;

/** Maximum number of ADMIN or MANAGER accounts allowed. */
export const MAX_ROLE_COUNT = 2;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GraceCheckResult {
    status: 'EARLY_CHECKOUT' | 'ON_TIME';
    flag: boolean;
}

export interface RoleAvailability {
    available: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Determines whether a leave-return is within the 30-minute grace window.
 *
 * @param leaveEndTime  The scheduled end of the employee's leave.
 * @param returnTime    The actual time the employee returned.
 * @returns { status: 'EARLY_CHECKOUT', flag: true }  when the employee is
 *          more than LEAVE_GRACE_MINUTES late returning.
 */
export function checkGraceRule(leaveEndTime: Date, returnTime: Date): GraceCheckResult {
    const diffMinutes = (returnTime.getTime() - leaveEndTime.getTime()) / (1000 * 60);
    if (diffMinutes > LEAVE_GRACE_MINUTES) {
        return { status: 'EARLY_CHECKOUT', flag: true };
    }
    return { status: 'ON_TIME', flag: false };
}

/**
 * Returns true when the current time is at or past the closing cutoff AND the
 * employee has not yet checked out — meaning an auto-flag should be created.
 *
 * @param currentTime   The time to evaluate (injected so it's testable).
 * @param hasCheckedOut Whether the employee already has a checkout record.
 */
export function shouldAutoFlagEarlyCheckout(currentTime: Date, hasCheckedOut: boolean): boolean {
    const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
    return currentMinutes >= CLOSING_TIME_MINUTES && !hasCheckedOut;
}

/**
 * Checks whether a new account of the given role can be created.
 *
 * @param currentCount  Existing accounts with that role in the database.
 */
export function checkRoleAvailability(currentCount: number): RoleAvailability {
    return { available: currentCount < MAX_ROLE_COUNT };
}
