/**
 * Unit tests — Financial & Inventory Integrity (Priority 2)
 * File under test: src/utils/financeUtils.ts
 */

import {
    calculateProfitMargin,
    calculateStockDelta,
    calculateInventoryTotal,
} from '../utils/financeUtils';

// ── calculateProfitMargin ─────────────────────────────────────────────────────

describe('calculateProfitMargin — profit and markup margin', () => {
    test('calculates correct grossProfit and 25% margin for LKR 1000 / 1250 pair', () => {
        const result = calculateProfitMargin(1000, 1250);

        expect(result.grossProfit).toBe(250);
        expect(result.margin).toBe(25.0);
    });

    test('returns zero margin when boughtPrice is 0 (avoids division by zero)', () => {
        const result = calculateProfitMargin(0, 500);

        expect(result.grossProfit).toBe(500);
        expect(result.margin).toBe(0);
    });

    test('handles equal bought and selling price (zero profit)', () => {
        const result = calculateProfitMargin(800, 800);

        expect(result.grossProfit).toBe(0);
        expect(result.margin).toBe(0);
    });

    test('rounds margin to 1 decimal place', () => {
        // 1500 → 2000: profit=500, margin = (500/1500)*100 = 33.333…% → 33.3
        const result = calculateProfitMargin(1500, 2000);

        expect(result.grossProfit).toBe(500);
        expect(result.margin).toBe(33.3);
    });

    test('handles large amounts without floating-point overflow', () => {
        const result = calculateProfitMargin(100000, 125000);

        expect(result.grossProfit).toBe(25000);
        expect(result.margin).toBe(25.0);
    });
});

// ── calculateStockDelta ───────────────────────────────────────────────────────

describe('calculateStockDelta — stock ledger after quotation finalisation', () => {
    test('reduces stock by 3 and creates ledger entry of -3', () => {
        const result = calculateStockDelta(10, 3);

        expect(result.newQuantity).toBe(7);
        expect(result.ledgerEntry).toBe(-3);
    });

    test('consuming all stock results in newQuantity of 0', () => {
        const result = calculateStockDelta(5, 5);

        expect(result.newQuantity).toBe(0);
        expect(result.ledgerEntry).toBe(-5);
    });

    test('consuming 1 unit decrements by exactly 1', () => {
        const result = calculateStockDelta(20, 1);

        expect(result.newQuantity).toBe(19);
        expect(result.ledgerEntry).toBe(-1);
    });

    test('ledgerEntry is always negative (representing consumption)', () => {
        const { ledgerEntry } = calculateStockDelta(100, 50);

        expect(ledgerEntry).toBeLessThan(0);
    });
});

// ── calculateInventoryTotal ───────────────────────────────────────────────────

describe('calculateInventoryTotal — floating-point safe total valuation', () => {
    test('sums 50 parts with varied prices and quantities correctly', () => {
        // Generate 50 parts: alternating prices and quantities to stress FP precision
        const parts = Array.from({ length: 50 }, (_, i) => ({
            boughtPrice: 100 + i * 13.7,   // e.g. 100, 113.7, 127.4 …
            quantity:    (i % 10) + 1,       // 1–10
        }));

        const expected = Math.round(
            parts.reduce((sum, p) => sum + p.boughtPrice * p.quantity, 0) * 100
        ) / 100;

        expect(calculateInventoryTotal(parts)).toBe(expected);
    });

    test('returns 0 for an empty parts array', () => {
        expect(calculateInventoryTotal([])).toBe(0);
    });

    test('handles single part correctly', () => {
        expect(calculateInventoryTotal([{ boughtPrice: 250, quantity: 4 }])).toBe(1000);
    });

    test('rounds to 2 decimal places (floating-point safety)', () => {
        // 0.1 + 0.2 is a classic JS FP issue
        const parts = [
            { boughtPrice: 0.1, quantity: 1 },
            { boughtPrice: 0.2, quantity: 1 },
        ];
        const result = calculateInventoryTotal(parts);

        // Must equal 0.30, not 0.30000000000000004
        expect(result).toBe(0.30);
    });

    test('handles parts with quantity of 0 (zero contribution)', () => {
        const parts = [
            { boughtPrice: 500, quantity: 0 },
            { boughtPrice: 200, quantity: 3 },
        ];
        expect(calculateInventoryTotal(parts)).toBe(600);
    });
});
