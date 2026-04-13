import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

function getDateRange(range: string, date: string): { start: Date; end: Date } {
    const ref = date ? new Date(date) : new Date();
    ref.setHours(0, 0, 0, 0);

    if (range === 'daily') {
        const end = new Date(ref);
        end.setHours(23, 59, 59, 999);
        return { start: ref, end };
    }

    if (range === 'monthly') {
        const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
        const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999);
        return { start, end };
    }

    // weekly (Mon–Sun)
    const day = ref.getDay(); // 0=Sun
    const diffToMon = day === 0 ? -6 : 1 - day;
    const start = new Date(ref);
    start.setDate(ref.getDate() + diffToMon);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
}

// GET /api/analytics/summary?range=daily|weekly|monthly&date=YYYY-MM-DD
router.get('/summary', authenticate, requireRole('MANAGER'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const range = (req.query.range as string) || 'monthly';
        const date = (req.query.date as string) || '';
        const { start, end } = getDateRange(range, date);

        // ── Finalized quotations in period ────────────────────────────────
        const finalizedQuotations = await prisma.quotation.findMany({
            where: { status: 'FINALIZED', updatedAt: { gte: start, lte: end } },
            include: {
                job: { select: { jobType: true } },
                items: { include: { sparePart: { select: { boughtPrice: true } } } },
            },
        });

        // ── Revenue ───────────────────────────────────────────────────────
        const totalRevenue = finalizedQuotations.reduce((s, q) => s + (q.totalAmount || 0), 0);

        // ── COGS: bought price × quantity for all linked spare parts ─────
        let totalCOGS = 0;
        for (const q of finalizedQuotations) {
            for (const item of q.items) {
                if (item.sparePart && item.quantity) {
                    totalCOGS += item.sparePart.boughtPrice * item.quantity;
                }
            }
        }

        const grossProfit = totalRevenue - totalCOGS;
        const profitMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

        // ── By job category ───────────────────────────────────────────────
        const categoryMap: Record<string, { revenue: number; cogs: number; jobCount: number }> = {};
        for (const q of finalizedQuotations) {
            const type = q.job.jobType;
            if (!categoryMap[type]) categoryMap[type] = { revenue: 0, cogs: 0, jobCount: 0 };
            categoryMap[type].revenue += q.totalAmount || 0;
            categoryMap[type].jobCount += 1;
            for (const item of q.items) {
                if (item.sparePart && item.quantity) {
                    categoryMap[type].cogs += item.sparePart.boughtPrice * item.quantity;
                }
            }
        }
        const byCategory = Object.entries(categoryMap).map(([jobType, data]) => ({
            jobType,
            revenue: data.revenue,
            cogs: data.cogs,
            grossProfit: data.revenue - data.cogs,
            jobCount: data.jobCount,
        }));

        // ── Total jobs in period ──────────────────────────────────────────
        const totalJobsInPeriod = await prisma.job.count({
            where: { createdAt: { gte: start, lte: end } },
        });
        const finalizationRate = totalJobsInPeriod > 0
            ? (finalizedQuotations.length / totalJobsInPeriod) * 100
            : 0;
        const aov = finalizedQuotations.length > 0 ? totalRevenue / finalizedQuotations.length : 0;

        // ── Inventory ─────────────────────────────────────────────────────
        const allParts = await prisma.sparePart.findMany();
        const inventoryValue = allParts.reduce((s, p) => s + p.boughtPrice * p.quantity, 0);

        // Daily stock consumption (today's negative ledger entries)
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayLedger = await prisma.stockLedger.findMany({
            where: { createdAt: { gte: todayStart }, change: { lt: 0 } },
            include: { sparePart: { select: { boughtPrice: true, name: true } } },
        });
        const dailyConsumption = todayLedger.reduce((s, e) => s + Math.abs(e.change) * e.sparePart.boughtPrice, 0);

        // Liquidity: top 10 parts by tied-up capital (boughtPrice × quantity), with turnover
        const ledgerPeriod = await prisma.stockLedger.findMany({
            where: { createdAt: { gte: start, lte: end }, change: { lt: 0 } },
            select: { sparePartId: true, change: true },
        });
        const turnoverMap: Record<string, number> = {};
        for (const e of ledgerPeriod) {
            turnoverMap[e.sparePartId] = (turnoverMap[e.sparePartId] || 0) + Math.abs(e.change);
        }
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
                lowStock: p.quantity < p.lowStockThreshold,
            }));

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
