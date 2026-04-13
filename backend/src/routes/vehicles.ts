import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /api/vehicles/:vehicleNumber - auto-fill lookup
router.get('/:vehicleNumber', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const vehicle = await prisma.vehicle.findUnique({ where: { vehicleNumber: req.params.vehicleNumber } });
        if (!vehicle) { res.status(404).json({ error: 'Vehicle not found' }); return; }
        res.json(vehicle);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/vehicles - list all vehicles
router.get('/', authenticate, async (_req: Request, res: Response): Promise<void> => {
    try {
        const vehicles = await prisma.vehicle.findMany({ orderBy: { createdAt: 'desc' } });
        res.json(vehicles);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
