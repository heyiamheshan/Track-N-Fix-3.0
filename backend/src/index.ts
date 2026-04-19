import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import cron from 'node-cron';

dotenv.config();

import authRoutes from './routes/auth';
import jobRoutes from './routes/jobs';
import imageRoutes from './routes/images';
import quotationRoutes from './routes/quotations';
import vehicleRoutes from './routes/vehicles';
import searchRoutes from './routes/search';
import notificationRoutes from './routes/notifications';
import voiceRoutes from './routes/voice';
import attendanceRoutes from './routes/attendance';
import inventoryRoutes from './routes/inventory';
import analyticsRoutes from './routes/analytics';
import prisma from './lib/prisma';

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
    'http://localhost:3000',
    process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve uploaded files
const uploadsDir = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
app.use('/uploads', express.static(uploadsDir));

import employeeRoutes from './routes/employees';

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/images', imageRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/analytics', analyticsRoutes);

app.get('/', (_req, res) => {
    res.send('TrackNFix Backend is Live and Running!');
});

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', message: 'TrackNFix API running', timestamp: new Date().toISOString() });
});

// ─── Scheduled Jobs ───────────────────────────────────────────────────────────

// Daily at 18:30: auto-flag employees who checked in but haven't checked out (early checkout)
cron.schedule('30 18 * * 1-6', async () => {
    console.log('[CRON] Running auto early-checkout flag job');
    try {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);

        const uncheckedOut = await prisma.attendance.findMany({
            where: { date: today, checkInTime: { not: null }, checkOutTime: null },
            include: { employee: { select: { name: true } } },
        });

        for (const att of uncheckedOut) {
            const alreadyFlagged = await prisma.attendanceRequest.findFirst({
                where: { employeeId: att.employeeId, type: 'EARLY_CHECKOUT', createdAt: { gte: today } },
            });
            if (alreadyFlagged) continue;

            const now = new Date();
            await prisma.attendanceRequest.create({
                data: { employeeId: att.employeeId, type: 'EARLY_CHECKOUT', requestedTime: now, reason: 'Auto-flagged: no checkout recorded by closing time', status: 'PENDING' },
            });
            await prisma.notification.create({
                data: { fromRole: 'EMPLOYEE', toRole: 'ADMIN', message: `⚠️ Auto-flag: ${att.employee.name} has no checkout recorded by closing time` },
            });
        }
    } catch (err) {
        console.error('[CRON] Auto early-checkout flag failed:', err);
    }
});

// Daily at 00:05: reactivate employees whose holiday has ended
cron.schedule('5 0 * * *', async () => {
    console.log('[CRON] Running holiday reactivation check');
    try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setUTCHours(0, 0, 0, 0);

        const expiredHolidays = await prisma.holiday.findMany({
            where: { status: 'APPROVED', holidayDate: { lte: yesterday } },
            include: { employee: true },
        });

        for (const h of expiredHolidays) {
            if (!h.employee.isActive) {
                await prisma.user.update({ where: { id: h.employeeId }, data: { isActive: true } });
                console.log(`[CRON] Reactivated employee ${h.employee.name} after holiday`);
            }
        }
    } catch (err) {
        console.error('[CRON] Holiday reactivation failed:', err);
    }
});

// Daily at 01:00: delete attendance_history records older than 6 months
cron.schedule('0 1 * * *', async () => {
    console.log('[CRON] Running attendance history cleanup');
    try {
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const deleted = await prisma.attendanceHistory.deleteMany({
            where: { archivedAt: { lt: sixMonthsAgo } },
        });
        console.log(`[CRON] Deleted ${deleted.count} old attendance history records`);
    } catch (err) {
        console.error('[CRON] Attendance history cleanup failed:', err);
    }
});

app.listen(PORT, () => {
    console.log(`🚗 TrackNFix API running on http://localhost:${PORT}`);
});

export default app;
