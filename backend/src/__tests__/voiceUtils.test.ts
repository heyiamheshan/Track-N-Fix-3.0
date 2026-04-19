/**
 * Unit tests — AI Intent & Command Normalisation (Priority 3)
 * File under test: src/utils/voiceUtils.ts
 */

import { normalizeVehicleNumber, normalizeIntent } from '../utils/voiceUtils';

// ── normalizeVehicleNumber ────────────────────────────────────────────────────

describe('normalizeVehicleNumber — Whisper transcript → WP-ABC-1234 format', () => {
    test('converts spelled-out vehicle number to canonical format', () => {
        // Whisper output: "wp a b c one two three four"
        expect(normalizeVehicleNumber('wp a b c one two three four')).toBe('WP-ABC-1234');
    });

    test('handles uppercase input (Whisper may capitalise)', () => {
        expect(normalizeVehicleNumber('WP A B C ONE TWO THREE FOUR')).toBe('WP-ABC-1234');
    });

    test('handles mixed case input', () => {
        expect(normalizeVehicleNumber('Wp A b C One Two Three Four')).toBe('WP-ABC-1234');
    });

    test('handles zero in the number portion', () => {
        // "wp x y z zero zero one two" → WP-XYZ-0012
        expect(normalizeVehicleNumber('wp x y z zero zero one two')).toBe('WP-XYZ-0012');
    });

    test('handles different province prefix', () => {
        // "nc a b c five six seven eight" → NC-ABC-5678
        expect(normalizeVehicleNumber('nc a b c five six seven eight')).toBe('NC-ABC-5678');
    });

    test('maps all number words correctly', () => {
        // Covers 0–9 in the number section
        expect(normalizeVehicleNumber('wp a b c zero nine eight seven')).toBe('WP-ABC-0987');
    });
});

// ── normalizeIntent ───────────────────────────────────────────────────────────

describe('normalizeIntent — LLaMA intent → action category mapping', () => {
    test('"vehicle_history" maps to RETRIEVE_HISTORY', () => {
        expect(normalizeIntent('vehicle_history')).toBe('RETRIEVE_HISTORY');
    });

    test('"print_report" also maps to RETRIEVE_HISTORY', () => {
        expect(normalizeIntent('print_report')).toBe('RETRIEVE_HISTORY');
    });

    test('both retrieve-type intents resolve to the same action', () => {
        // This is the core assertion: "show me records" and "I need a report" share one handler
        const historyAction = normalizeIntent('vehicle_history');
        const reportAction  = normalizeIntent('print_report');

        expect(historyAction).toBe(reportAction);
    });

    test('"inventory_query" maps to INVENTORY_QUERY', () => {
        expect(normalizeIntent('inventory_query')).toBe('INVENTORY_QUERY');
    });

    test('"employee_status" maps to EMPLOYEE_STATUS', () => {
        expect(normalizeIntent('employee_status')).toBe('EMPLOYEE_STATUS');
    });

    test('"financial_query" maps to FINANCIAL_QUERY', () => {
        expect(normalizeIntent('financial_query')).toBe('FINANCIAL_QUERY');
    });

    test('"general" maps to GENERAL', () => {
        expect(normalizeIntent('general')).toBe('GENERAL');
    });

    test('unknown intent falls back to uppercased raw value', () => {
        expect(normalizeIntent('unknown_intent')).toBe('UNKNOWN_INTENT');
    });
});
