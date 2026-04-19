/**
 * financeUtils.ts
 * Pure financial calculation helpers — no Prisma / Express dependencies.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProfitResult {
    grossProfit: number;
    /** Margin as a percentage, rounded to 1 decimal place. */
    margin: number;
}

export interface StockDeltaResult {
    newQuantity: number;
    /** Negative value representing stock consumed. */
    ledgerEntry: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Calculates gross profit and markup margin for a single spare part.
 *
 * margin = (grossProfit / boughtPrice) × 100
 */
export function calculateProfitMargin(boughtPrice: number, sellingPrice: number): ProfitResult {
    const grossProfit = sellingPrice - boughtPrice;
    const margin = boughtPrice > 0
        ? parseFloat(((grossProfit / boughtPrice) * 100).toFixed(1))
        : 0;
    return { grossProfit, margin };
}

/**
 * Computes the new stock level and the ledger entry after a quotation consumes parts.
 *
 * @param currentStock   Current quantity on hand.
 * @param quantityUsed   Quantity consumed by the quotation.
 */
export function calculateStockDelta(currentStock: number, quantityUsed: number): StockDeltaResult {
    return {
        newQuantity: currentStock - quantityUsed,
        ledgerEntry: -quantityUsed,
    };
}

/**
 * Calculates the total inventory value across all spare parts,
 * rounded to 2 decimal places to avoid floating-point drift.
 *
 * @param parts  Array of objects with boughtPrice and quantity.
 */
export function calculateInventoryTotal(
    parts: Array<{ boughtPrice: number; quantity: number }>,
): number {
    const raw = parts.reduce((sum, p) => sum + p.boughtPrice * p.quantity, 0);
    return Math.round(raw * 100) / 100;
}
