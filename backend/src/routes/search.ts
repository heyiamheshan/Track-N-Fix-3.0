import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /api/search?q=ABC123&type=vehicleNumber|telephone
router.get('/', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const { q, type } = req.query as { q: string; type: string };
        if (!q) { res.status(400).json({ error: 'Query parameter q is required' }); return; }

        let vehicle = null;
        if (type === 'telephone') {
            vehicle = await prisma.vehicle.findFirst({ where: { telephone: { contains: q } } });
        } else {
            vehicle = await prisma.vehicle.findFirst({ where: { vehicleNumber: { contains: q, mode: 'insensitive' } } });
        }

        if (!vehicle) { res.status(404).json({ error: 'No records found' }); return; }

        const jobs = await prisma.job.findMany({
            where: { vehicleId: vehicle.id },
            include: {
                images: true,
                employee: { select: { id: true, name: true } },
                quotations: { include: { items: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json({ vehicle, jobs });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
