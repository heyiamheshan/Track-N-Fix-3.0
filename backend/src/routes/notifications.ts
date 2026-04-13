import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/notifications - get notifications for current user role
router.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const notifications = await prisma.notification.findMany({
            where: { toRole: req.user!.role as 'EMPLOYEE' | 'ADMIN' | 'MANAGER' },
            orderBy: { createdAt: 'desc' },
        });
        res.json(notifications);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/notifications - create notification
router.post('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { toRole, message, vehicleNumber, quotationId } = req.body;
        const notification = await prisma.notification.create({
            data: {
                fromRole: req.user!.role as 'EMPLOYEE' | 'ADMIN' | 'MANAGER',
                toRole,
                message,
                vehicleNumber,
                quotationId,
                userId: req.user!.id,
            },
        });
        res.status(201).json(notification);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/notifications/:id/read - mark as read
router.put('/:id/read', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const notification = await prisma.notification.update({
            where: { id: req.params.id },
            data: { isRead: true },
        });
        res.json(notification);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/notifications/:id
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await prisma.notification.delete({ where: { id: req.params.id } });
        res.json({ message: 'Notification deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
