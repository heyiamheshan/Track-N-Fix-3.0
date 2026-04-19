/**
 * Unit tests — Workforce & Attendance Logic (Priority 1)
 * File under test: src/utils/attendanceUtils.ts
 */

import {
    checkGraceRule,
    shouldAutoFlagEarlyCheckout,
    checkRoleAvailability,
    CLOSING_TIME_MINUTES,
    LEAVE_GRACE_MINUTES,
    MAX_ROLE_COUNT,
} from '../utils/attendanceUtils';

// ── checkGraceRule ────────────────────────────────────────────────────────────

describe('checkGraceRule — 30-minute grace window', () => {
    test('returns EARLY_CHECKOUT flag when employee returns 31 min after leave end', () => {
        const leaveEnd  = new Date('2026-04-13T14:00:00');
        const returnAt  = new Date('2026-04-13T14:31:00'); // 31 min late

        const result = checkGraceRule(leaveEnd, returnAt);

        expect(result.status).toBe('EARLY_CHECKOUT');
        expect(result.flag).toBe(true);
    });

    test('returns ON_TIME when employee returns exactly at leave end', () => {
        const leaveEnd = new Date('2026-04-13T14:00:00');
        const returnAt = new Date('2026-04-13T14:00:00');

        const result = checkGraceRule(leaveEnd, returnAt);

        expect(result.status).toBe('ON_TIME');
        expect(result.flag).toBe(false);
    });

    test('returns ON_TIME when employee returns within the 30-min grace window', () => {
        const leaveEnd = new Date('2026-04-13T14:00:00');
        const returnAt = new Date('2026-04-13T14:30:00'); // exactly 30 min — still within grace

        const result = checkGraceRule(leaveEnd, returnAt);

        expect(result.status).toBe('ON_TIME');
        expect(result.flag).toBe(false);
    });

    test('returns EARLY_CHECKOUT for any return > 30 min past leave end', () => {
        const leaveEnd = new Date('2026-04-13T09:00:00');
        const returnAt = new Date('2026-04-13T12:00:00'); // 3 hours late

        const result = checkGraceRule(leaveEnd, returnAt);

        expect(result.status).toBe('EARLY_CHECKOUT');
        expect(result.flag).toBe(true);
    });

    test('LEAVE_GRACE_MINUTES constant is 30', () => {
        expect(LEAVE_GRACE_MINUTES).toBe(30);
    });
});

// ── shouldAutoFlagEarlyCheckout ───────────────────────────────────────────────

describe('shouldAutoFlagEarlyCheckout — 18:30 auto-flag cron logic', () => {
    test('returns true at 18:35 when employee has not checked out', () => {
        const time = new Date();
        time.setHours(18, 35, 0, 0);

        expect(shouldAutoFlagEarlyCheckout(time, false)).toBe(true);
    });

    test('returns false at 18:35 when employee has already checked out', () => {
        const time = new Date();
        time.setHours(18, 35, 0, 0);

        expect(shouldAutoFlagEarlyCheckout(time, true)).toBe(false);
    });

    test('returns false at 18:29 even when employee has not checked out', () => {
        const time = new Date();
        time.setHours(18, 29, 0, 0);

        expect(shouldAutoFlagEarlyCheckout(time, false)).toBe(false);
    });

    test('returns true exactly at 18:30 (boundary) when employee has not checked out', () => {
        const time = new Date();
        time.setHours(18, 30, 0, 0);

        expect(shouldAutoFlagEarlyCheckout(time, false)).toBe(true);
    });

    test('CLOSING_TIME_MINUTES constant equals 1110 (18 × 60 + 30)', () => {
        expect(CLOSING_TIME_MINUTES).toBe(1110);
    });
});

// ── checkRoleAvailability ─────────────────────────────────────────────────────

describe('checkRoleAvailability — 2-account role limit', () => {
    test('returns available: false when current count is 2 (attempting 3rd account)', () => {
        expect(checkRoleAvailability(2)).toEqual({ available: false });
    });

    test('returns available: true when current count is 0', () => {
        expect(checkRoleAvailability(0)).toEqual({ available: true });
    });

    test('returns available: true when current count is 1', () => {
        expect(checkRoleAvailability(1)).toEqual({ available: true });
    });

    test('returns available: false when current count exceeds limit', () => {
        expect(checkRoleAvailability(5)).toEqual({ available: false });
    });

    test('MAX_ROLE_COUNT constant is 2', () => {
        expect(MAX_ROLE_COUNT).toBe(2);
    });
});
