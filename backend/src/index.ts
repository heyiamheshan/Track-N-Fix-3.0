/**
 * index.ts — TrackNFix Backend Entry Point
 *
 * Bootstraps the Express application:
 *  - Registers CORS, JSON body-parser and static-file middleware
 *  - Mounts all API route modules under /api/*
 *  - Schedules three recurring cron jobs for attendance automation
 *  - Starts the HTTP server on the configured PORT
 *
 * Environment variables consumed here:
 *   PORT            – HTTP listen port (default 5000)
 *   FRONTEND_URL    – Production frontend origin added to the CORS allow-list
 *   UPLOAD_DIR      – Relative directory for uploaded images (default "uploads")
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import cron from 'node-cron';

// Load .env variables before any other import reads process.env
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

// ── CORS Configuration ────────────────────────────────────────────────────────
// Allow requests from local dev servers and the production Amplify URL.
// FRONTEND_URL can be set at runtime so new deployments need no code change.
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://main.d1z3vjzwxx6p7j.amplifyapp.com',
    process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(cors({
    origin: function (origin, callback) {
        // Allow server-to-server requests (no Origin header)
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) === -1) {
            console.log('[CORS] Blocked origin:', origin);
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
    credentials: true,
}));

// ── Body Parsers ──────────────────────────────────────────────────────────────
// 50 MB limit to support base64-encoded image uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Static Files ──────────────────────────────────────────────────────────────
// Serve uploaded vehicle/job images directly from the uploads directory
const uploadsDir = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
app.use('/uploads', express.static(uploadsDir));

import employeeRoutes from './routes/employees';

// ── API Route Registration ────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);           // Authentication & password management
app.use('/api/jobs', jobRoutes);            // Job card lifecycle (DRAFT → SUBMITTED → REVIEWED → QUOTED → FINALIZED)
app.use('/api/images', imageRoutes);        // Vehicle / job image upload & delete
app.use('/api/quotations', quotationRoutes); // Quotation creation, workflow and customer notification
app.use('/api/vehicles', vehicleRoutes);    // Vehicle lookup and history
app.use('/api/search', searchRoutes);       // Global search by vehicle number or telephone
app.use('/api/notifications', notificationRoutes); // In-app notification feed
app.use('/api/employees', employeeRoutes);  // Employee management (Admin only)
app.use('/api/voice', voiceRoutes);         // AI voice assistant (Whisper + LLaMA)
app.use('/api/attendance', attendanceRoutes); // Attendance, leave, overtime and holiday
app.use('/api/inventory', inventoryRoutes); // Spare-parts inventory and stock ledger
app.use('/api/analytics', analyticsRoutes); // Financial analytics and KPI summary

// ── Health-check Endpoints ────────────────────────────────────────────────────
app.get('/', (_req, res) => {
    res.send('TrackNFix Backend is Live and Running!');
});

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', message: 'TrackNFix API running', timestamp: new Date().toISOString() });
});

// ── Scheduled Cron Jobs ───────────────────────────────────────────────────────

/**
 * [CRON 1] Daily at 18:30 (Mon–Sat):
 * Auto-flag employees who checked in but have no checkout recorded by closing time.
 * Creates an EARLY_CHECKOUT attendance request and sends an admin notification.
 * Skips employees already flagged today to avoid duplicate records.
 */
cron.schedule('30 18 * * 1-6', async () => {
    console.log('[CRON] Running auto early-checkout flag job');
    try {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);

        // Find all attendance records for today that have a check-in but no check-out
        const uncheckedOut = await prisma.attendance.findMany({
            where: { date: today, checkInTime: { not: null }, checkOutTime: null },
            include: { employee: { select: { name: true } } },
        });

        for (const att of uncheckedOut) {
            // Skip if this employee was already auto-flagged today
            const alreadyFlagged = await prisma.attendanceRequest.findFirst({
                where: { employeeId: att.employeeId, type: 'EARLY_CHECKOUT', createdAt: { gte: today } },
            });
            if (alreadyFlagged) continue;

            const now = new Date();

            // Create the auto-flag request in PENDING state for admin review
            await prisma.attendanceRequest.create({
                data: {
                    employeeId: att.employeeId,
                    type: 'EARLY_CHECKOUT',
                    requestedTime: now,
                    reason: 'Auto-flagged: no checkout recorded by closing time',
                    status: 'PENDING',
                },
            });

            // Notify admin so the issue appears in the attendance dashboard
            await prisma.notification.create({
                data: {
                    fromRole: 'EMPLOYEE',
                    toRole: 'ADMIN',
                    message: `⚠️ Auto-flag: ${att.employee.name} has no checkout recorded by closing time`,
                },
            });
        }
    } catch (err) {
        console.error('[CRON] Auto early-checkout flag failed:', err);
    }
});

/**
 * [CRON 2] Daily at 00:05:
 * Reactivates employee accounts whose approved holiday has ended (holiday date was yesterday or earlier).
 * Employees are deactivated when a holiday is approved and automatically re-enabled here.
 */
cron.schedule('5 0 * * *', async () => {
    console.log('[CRON] Running holiday reactivation check');
    try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setUTCHours(0, 0, 0, 0);

        // Find approved holidays whose date has already passed
        const expiredHolidays = await prisma.holiday.findMany({
            where: { status: 'APPROVED', holidayDate: { lte: yesterday } },
            include: { employee: true },
        });

        for (const h of expiredHolidays) {
            if (!h.employee.isActive) {
                // Reactivate the employee account so they can check in again
                await prisma.user.update({ where: { id: h.employeeId }, data: { isActive: true } });
                console.log(`[CRON] Reactivated employee ${h.employee.name} after holiday`);
            }
        }
    } catch (err) {
        console.error('[CRON] Holiday reactivation failed:', err);
    }
});

/**
 * [CRON 3] Daily at 01:00:
 * Purges attendance history records older than 6 months to manage database growth.
 * Records are archived by the manager before being moved to history, so deletion here
 * only removes data that has already been reviewed and saved.
 */
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

// ── Inventory Seed ────────────────────────────────────────────────────────────
async function seedInventoryIfEmpty() {
    const count = await prisma.sparePart.count();
    if (count > 0) return;

    const parts = [
        { name: 'Car Battery 12V 60Ah', serialNumber: 'BAT-12V-60', description: 'Maintenance-free car battery', boughtPrice: 8500, sellingPrice: 12000, quantity: 10, lowStockThreshold: 3, supplierName: 'Exide Lanka' },
        { name: 'Alternator Belt', serialNumber: 'BLT-ALT-01', description: 'V-belt for alternator', boughtPrice: 450, sellingPrice: 800, quantity: 20, lowStockThreshold: 5, supplierName: 'Gates Lanka' },
        { name: 'Brake Pad Set (Front)', serialNumber: 'BP-FRT-01', description: 'Front disc brake pads', boughtPrice: 1800, sellingPrice: 3200, quantity: 15, lowStockThreshold: 4, supplierName: 'Bosch Lanka' },
        { name: 'Brake Pad Set (Rear)', serialNumber: 'BP-RER-01', description: 'Rear disc brake pads', boughtPrice: 1600, sellingPrice: 2800, quantity: 12, lowStockThreshold: 4, supplierName: 'Bosch Lanka' },
        { name: 'Engine Oil Filter', serialNumber: 'FLT-OIL-01', description: 'Standard engine oil filter', boughtPrice: 350, sellingPrice: 650, quantity: 30, lowStockThreshold: 8, supplierName: 'Toyota Spare Parts' },
        { name: 'Air Filter', serialNumber: 'FLT-AIR-01', description: 'Engine air intake filter', boughtPrice: 500, sellingPrice: 900, quantity: 25, lowStockThreshold: 6, supplierName: 'Toyota Spare Parts' },
        { name: 'Spark Plug (NGK)', serialNumber: 'SPK-NGK-01', description: 'NGK standard spark plug', boughtPrice: 280, sellingPrice: 500, quantity: 50, lowStockThreshold: 10, supplierName: 'NGK Lanka' },
        { name: 'Ignition Coil', serialNumber: 'IGN-COIL-01', description: 'Direct ignition coil', boughtPrice: 2200, sellingPrice: 3800, quantity: 8, lowStockThreshold: 2, supplierName: 'Bosch Lanka' },
        { name: 'Fuse Box Set', serialNumber: 'FUSE-BOX-01', description: 'Assorted fuse set 5A-30A', boughtPrice: 120, sellingPrice: 250, quantity: 40, lowStockThreshold: 10, supplierName: 'Local Supplier' },
        { name: 'Wiper Blade (600mm)', serialNumber: 'WPR-600-01', description: '600mm universal wiper blade', boughtPrice: 380, sellingPrice: 700, quantity: 18, lowStockThreshold: 4, supplierName: 'Bosch Lanka' },
        { name: 'Radiator Coolant 1L', serialNumber: 'RAD-COOL-1L', description: 'Antifreeze coolant concentrate', boughtPrice: 600, sellingPrice: 1000, quantity: 22, lowStockThreshold: 5, supplierName: 'Total Lanka' },
        { name: 'Engine Oil 5W-30 4L', serialNumber: 'OIL-5W30-4L', description: 'Synthetic engine oil 4 litre', boughtPrice: 3200, sellingPrice: 5500, quantity: 15, lowStockThreshold: 4, supplierName: 'Mobil Lanka' },
        { name: 'Power Steering Fluid', serialNumber: 'PSF-01', description: 'Power steering hydraulic fluid', boughtPrice: 450, sellingPrice: 800, quantity: 12, lowStockThreshold: 3, supplierName: 'Total Lanka' },
        { name: 'Brake Fluid DOT4', serialNumber: 'BRK-FLD-DOT4', description: 'DOT4 brake fluid 500ml', boughtPrice: 380, sellingPrice: 700, quantity: 20, lowStockThreshold: 5, supplierName: 'Bosch Lanka' },
        { name: 'Headlight Bulb H4', serialNumber: 'BULB-H4-01', description: 'H4 halogen headlight bulb 60/55W', boughtPrice: 350, sellingPrice: 650, quantity: 24, lowStockThreshold: 6, supplierName: 'Philips Lanka' },
        { name: 'Starter Motor', serialNumber: 'STR-MOT-01', description: '12V starter motor', boughtPrice: 7500, sellingPrice: 12000, quantity: 4, lowStockThreshold: 1, supplierName: 'Denso Lanka' },
        { name: 'Wheel Bearing (Front)', serialNumber: 'WHL-BRG-FRT', description: 'Front wheel hub bearing', boughtPrice: 1200, sellingPrice: 2200, quantity: 8, lowStockThreshold: 2, supplierName: 'NSK Lanka' },
        { name: 'Timing Belt', serialNumber: 'TMG-BLT-01', description: 'Engine timing belt', boughtPrice: 1800, sellingPrice: 3200, quantity: 6, lowStockThreshold: 2, supplierName: 'Gates Lanka' },
        { name: 'Voltage Regulator', serialNumber: 'VOLT-REG-01', description: 'Alternator voltage regulator', boughtPrice: 950, sellingPrice: 1800, quantity: 7, lowStockThreshold: 2, supplierName: 'Bosch Lanka' },
        { name: 'Car Horn 12V', serialNumber: 'HORN-12V-01', description: 'Dual tone electric horn', boughtPrice: 450, sellingPrice: 850, quantity: 10, lowStockThreshold: 3, supplierName: 'Local Supplier' },
    ];

    const result = await prisma.sparePart.createMany({ data: parts, skipDuplicates: true });
    console.log(`[SEED] Inserted ${result.count} sample spare parts into inventory`);
}

// ── Server Start ──────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
    console.log(`🚗 TrackNFix API running on http://localhost:${PORT}`);
    await seedInventoryIfEmpty();
});

export default app;
