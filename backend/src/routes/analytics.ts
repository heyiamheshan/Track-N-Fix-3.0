/**
 * analytics.ts — Financial Analytics Routes
 *
 * Provides aggregated financial and operational KPI data for the manager dashboard.
 *
 *   GET /api/analytics/summary?range=daily|weekly|monthly&date=YYYY-MM-DD
 *
 * Response sections:
 *   - period       – The requested range and resolved start/end dates
 *   - revenue      – Total revenue, COGS, gross profit, and profit margin %
 *   - jobs         – Total jobs, finalized count, finalization rate, and average order value
 *   - byCategory   – Revenue/profit breakdown by job type (SERVICE, REPAIR, ACCIDENT_RECOVERY)
 *   - inventory    – Total inventory value, today's stock consumption, and top-10 parts by capital
 *
 * Design notes:
 *   - COGS is calculated from the boughtPrice × quantity of spare parts linked to finalized quotations.
 *   - Inventory turnover (units consumed in period) is derived from stock ledger negative entries.
 *   - Only MANAGER role can access analytics to protect sensitive financial data.
 */

import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// ── Helper: Date Range Resolver ───────────────────────────────────────────────

/**
 * Converts a range label and optional reference date into a concrete start/end Date pair.
 *
 * @param range  'daily' | 'weekly' | 'monthly'
 * @param date   Optional ISO date string (defaults to today)
 * @returns      { start, end } covering the full range (start = 00:00, end = 23:59:59.999)
 *
 * Weekly ranges use Monday as the week start (ISO week convention).
 */
function getDateRange(range: string, date: string): { start: Date; end: Date } {
    const ref = date ? new Date(date) : new Date();
    ref.setHours(0, 0, 0, 0); // Normalise to start of day

    if (range === 'daily') {
        const end = new Date(ref);
        end.setHours(23, 59, 59, 999);
        return { start: ref, end };
    }

    if (range === 'monthly') {
        const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
        const end   = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999);
        return { start, end };
    }

    // Default: weekly — align to Monday of the ref week
    const day = ref.getDay(); // 0 = Sunday, 1 = Monday, …
    const diffToMon = day === 0 ? -6 : 1 - day; // Days back to the most recent Monday
    const start = new Date(ref);
    start.setDate(ref.getDate() + diffToMon);
    const end = new Date(start);
    end.setDate(start.getDate() + 6); // Sunday = Monday + 6
    end.setHours(23, 59, 59, 999);
    return { start, end };
}

// ── GET /api/analytics/summary ────────────────────────────────────────────────
/**
 * Returns a comprehensive financial + operational summary for the requested period.
 *
 * Calculation steps:
 *  1. Fetch all finalized quotations in the period with their items and spare-part costs.
 *  2. Sum revenue (totalAmount) and COGS (boughtPrice × quantity for each item).
 *  3. Compute gross profit and profit margin.
 *  4. Group revenue and COGS by job category (SERVICE / REPAIR / ACCIDENT_RECOVERY).
 *  5. Count total jobs and compute finalization rate and average order value (AOV).
 *  6. Calculate total inventory value and daily stock consumption from the ledger.
 *  7. Identify the top 10 parts by capital tied up, with their turnover units in the period.
 */
router.get('/summary', authenticate, requireRole('MANAGER'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const range = (req.query.range as string) || 'monthly';
        const date  = (req.query.date  as string) || '';
        const { start, end } = getDateRange(range, date);

        // ── Step 1: Finalized quotations in period ────────────────────────────
        // Include items with spare-part bought prices for COGS calculation
        const finalizedQuotations = await prisma.quotation.findMany({
            where: { status: 'FINALIZED', updatedAt: { gte: start, lte: end } },
            include: {
                job: { select: { jobType: true } },
                items: { include: { sparePart: { select: { boughtPrice: true } } } },
            },
        });

        // ── Step 2: Revenue & COGS ────────────────────────────────────────────
        // Revenue = sum of finalised quotation totals
        const totalRevenue = finalizedQuotations.reduce((s, q) => s + (q.totalAmount || 0), 0);

        // COGS = bought price × quantity for every spare part used across all quotations
        let totalCOGS = 0;
        for (const q of finalizedQuotations) {
            for (const item of q.items) {
                if (item.sparePart && item.quantity) {
                    totalCOGS += item.sparePart.boughtPrice * item.quantity;
                }
            }
        }

        const grossProfit  = totalRevenue - totalCOGS;
        // Profit margin expressed as a percentage of revenue
        const profitMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

        // ── Step 3: Revenue breakdown by job category ─────────────────────────
        const categoryMap: Record<string, { revenue: number; cogs: number; jobCount: number }> = {};
        for (const q of finalizedQuotations) {
            const type = q.job.jobType;
            if (!categoryMap[type]) categoryMap[type] = { revenue: 0, cogs: 0, jobCount: 0 };
            categoryMap[type].revenue  += q.totalAmount || 0;
            categoryMap[type].jobCount += 1;
            for (const item of q.items) {
                if (item.sparePart && item.quantity) {
                    categoryMap[type].cogs += item.sparePart.boughtPrice * item.quantity;
                }
            }
        }

        const byCategory = Object.entries(categoryMap).map(([jobType, data]) => ({
            jobType,
            revenue:     data.revenue,
            cogs:        data.cogs,
            grossProfit: data.revenue - data.cogs,
            jobCount:    data.jobCount,
        }));

        // ── Step 4: Job KPIs ──────────────────────────────────────────────────
        const totalJobsInPeriod = await prisma.job.count({
            where: { createdAt: { gte: start, lte: end } },
        });

        // Finalization rate = finalized jobs / total jobs created in period
        const finalizationRate = totalJobsInPeriod > 0
            ? (finalizedQuotations.length / totalJobsInPeriod) * 100
            : 0;

        // Average order value (AOV) = total revenue / number of finalized quotations
        const aov = finalizedQuotations.length > 0 ? totalRevenue / finalizedQuotations.length : 0;

        // ── Step 5: Inventory metrics ─────────────────────────────────────────
        const allParts = await prisma.sparePart.findMany();

        // Total capital tied up in stock
        const inventoryValue = allParts.reduce((s, p) => s + p.boughtPrice * p.quantity, 0);

        // Today's stock consumption: sum the value of all negative ledger entries today
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayLedger = await prisma.stockLedger.findMany({
            where: { createdAt: { gte: todayStart }, change: { lt: 0 } },
            include: { sparePart: { select: { boughtPrice: true, name: true } } },
        });
        const dailyConsumption = todayLedger.reduce(
            (s, e) => s + Math.abs(e.change) * e.sparePart.boughtPrice, 0
        );

        // ── Step 6: Inventory turnover map ────────────────────────────────────
        // Count units consumed per part in the selected period from ledger deductions
        const ledgerPeriod = await prisma.stockLedger.findMany({
            where: { createdAt: { gte: start, lte: end }, change: { lt: 0 } },
            select: { sparePartId: true, change: true },
        });
        const turnoverMap: Record<string, number> = {};
        for (const e of ledgerPeriod) {
            turnoverMap[e.sparePartId] = (turnoverMap[e.sparePartId] || 0) + Math.abs(e.change);
        }

        // Top 10 parts by capital (highest stock value) — most impactful for liquidity analysis
        const topByValue = [...allParts]
            .sort((a, b) => b.boughtPrice * b.quantity - a.boughtPrice * a.quantity)
            .slice(0, 10)
            .map(p => ({
                id: p.id,
                name: p.name,
                quantity: p.quantity,
                boughtPrice: p.boughtPrice,
                sellingPrice: p.sellingPrice,
                stockValue: p.boughtPrice * p.quantity,
                unitsConsumedInPeriod: turnoverMap[p.id] || 0,
                lowStock: p.quantity < p.lowStockThreshold, // Flag for dashboard alert
            }));

        // ── Response ──────────────────────────────────────────────────────────
        res.json({
            period: { range, start, end },
            revenue: { total: totalRevenue, cogs: totalCOGS, grossProfit, profitMargin },
            jobs: { total: totalJobsInPeriod, finalized: finalizedQuotations.length, finalizationRate, aov },
            byCategory,
            inventory: { totalValue: inventoryValue, dailyConsumption, topByValue },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
