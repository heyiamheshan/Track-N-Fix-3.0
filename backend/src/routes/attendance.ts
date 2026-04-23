/**
 * attendance.ts — Attendance, Leave, Overtime & Holiday Routes
 *
 * Manages all employee time-tracking workflows with a three-layer architecture:
 *
 * ── EMPLOYEE endpoints ────────────────────────────────────────────────────────
 *   GET  /today                  – Current day attendance snapshot for the logged-in employee
 *   GET  /my                     – Full attendance history (requests, leaves, overtime, holidays)
 *   POST /checkin                – Submit a check-in request (requires admin approval)
 *   POST /checkout               – Submit a checkout request (auto-detects early checkout before 18:30)
 *   POST /overtime/start         – Request overtime approval
 *   POST /overtime/end           – Confirm end of overtime
 *   POST /leave                  – Apply for leave with date range
 *   POST /leave/confirm-end      – Confirm return from leave
 *   POST /holiday                – Request a personal holiday day
 *
 * ── ADMIN endpoints ───────────────────────────────────────────────────────────
 *   GET  /admin/pending                      – All pending requests for review
 *   PUT  /admin/request/:id/:action          – Approve/reject a check-in, checkout, or leave-end
 *   PUT  /admin/overtime/:id/:action         – Approve/reject overtime requests
 *   PUT  /admin/leave/:id/:action            – Approve/reject leave applications
 *   PUT  /admin/holiday/:id/:action          – Approve/reject holiday requests
 *
 * ── MANAGER endpoints ─────────────────────────────────────────────────────────
 *   GET  /manager/overview                   – Aggregated team attendance metrics (weekly/monthly)
 *   POST /manager/archive                    – Archive current attendance to history table
 *   GET  /manager/history                    – View archived attendance records
 *   GET  /manager/employees                  – Live status snapshot for all employees
 *
 * Design notes:
 *   - All check-in/checkout actions go through a PENDING → APPROVED/REJECTED approval flow.
 *   - Attendance records are only written when the admin approves a request.
 *   - Early checkout is defined as leaving before 18:30 (1110 minutes past midnight).
 */

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// ════════════════════════════════════════════════════════════════════════════════
// EMPLOYEE ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════════

// ── GET /today ────────────────────────────────────────────────────────────────
/**
 * Returns the logged-in employee's complete status for today:
 *  - attendance record (check-in/out times and status)
 *  - any pending approval requests
 *  - active leave (if on leave and not yet confirmed end)
 *  - active overtime (if overtime is currently approved)
 *  - approved holiday for today
 *
 * The frontend uses this to render the correct action buttons (check in, check out, etc.).
 */
router.get('/today', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        // Build a date range covering exactly today (midnight to midnight)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const empId = req.user!.id;

        // Fetch all status-related records for today in parallel would be ideal;
        // kept sequential here for clarity and to match original query ordering.
        const attendance = await prisma.attendance.findFirst({
            where: { employeeId: empId, date: { gte: today, lt: tomorrow } }
        });
        const pendingRequests = await prisma.attendanceRequest.findMany({
            where: { employeeId: empId, status: 'PENDING' }
        });
        const activeLeave = await prisma.leave.findFirst({
            where: { employeeId: empId, status: 'APPROVED', leaveEndConfirmed: false, leaveFrom: { lte: new Date() } }
        });
        const activeOvertime = await prisma.overtime.findFirst({
            where: { employeeId: empId, status: 'APPROVED' }
        });
        const holiday = await prisma.holiday.findFirst({
            where: { employeeId: empId, holidayDate: { gte: today, lt: tomorrow }, status: 'APPROVED' }
        });

        res.json({ attendance, pendingRequests, activeLeave, activeOvertime, holiday });
    } catch (err) {
        console.error('[GET /today]', err);
        res.status(500).json({ error: 'Error fetching today status' });
    }
});

// ── GET /my ───────────────────────────────────────────────────────────────────
/**
 * Returns the complete attendance history for the logged-in employee.
 * Includes all attendance requests, leave applications, overtime records,
 * holiday requests, and raw attendance check-in/out records.
 */
router.get('/my', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const empId = req.user!.id;
        const requests  = await prisma.attendanceRequest.findMany({ where: { employeeId: empId }, orderBy: { createdAt: 'desc' } });
        const leaves    = await prisma.leave.findMany({ where: { employeeId: empId }, orderBy: { createdAt: 'desc' } });
        const overtimes = await prisma.overtime.findMany({ where: { employeeId: empId }, orderBy: { createdAt: 'desc' } });
        const holidays  = await prisma.holiday.findMany({ where: { employeeId: empId }, orderBy: { createdAt: 'desc' } });
        const attendance = await prisma.attendance.findMany({ where: { employeeId: empId }, orderBy: { date: 'desc' } });

        res.json({ requests, leaves, overtimes, holidays, attendance });
    } catch (err) {
        console.error('[GET /my]', err);
        res.status(500).json({ error: 'Error fetching attendance records' });
    }
});

// ── POST /checkin ─────────────────────────────────────────────────────────────
/**
 * Submits a check-in request for admin approval.
 * Prevents duplicate requests — only one PENDING CHECKIN request per employee per day.
 * The actual attendance record is created when the admin approves the request.
 */
router.post('/checkin', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Guard against duplicate check-in requests on the same day
        const existing = await prisma.attendanceRequest.findFirst({
            where: { employeeId: req.user!.id, type: 'CHECKIN', status: 'PENDING', createdAt: { gte: today } }
        });
        if (existing) {
            res.status(400).json({ error: 'A check-in request is already pending.' });
            return;
        }

        const request = await prisma.attendanceRequest.create({
            data: { employeeId: req.user!.id, type: 'CHECKIN', requestedTime: new Date(), status: 'PENDING' }
        });
        res.status(201).json(request);
    } catch (err) {
        console.error('[POST /checkin]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /checkout ────────────────────────────────────────────────────────────
/**
 * Submits a checkout request for admin approval.
 * Automatically classifies the request as EARLY_CHECKOUT if it occurs before 18:30.
 * Early checkouts require a reason and will be flagged for the admin.
 */
router.post('/checkout', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { reason } = req.body;
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        // 18:30 = 18 × 60 + 30 = 1110 minutes past midnight
        const isEarly = currentMinutes < 1110;
        const type = isEarly ? 'EARLY_CHECKOUT' : 'CHECKOUT';

        const request = await prisma.attendanceRequest.create({
            data: {
                employeeId: req.user!.id,
                type,
                requestedTime: now,
                reason: isEarly ? reason : null, // Only attach reason for early checkouts
                status: 'PENDING'
            }
        });
        res.status(201).json(request);
    } catch (err) {
        console.error('[POST /checkout]', err);
        res.status(500).json({ error: 'Error submitting checkout request' });
    }
});

// ── POST /overtime/start ──────────────────────────────────────────────────────
/**
 * Requests admin approval to begin overtime.
 * The admin must approve before overtime is officially recorded.
 */
router.post('/overtime/start', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const request = await prisma.attendanceRequest.create({
            data: {
                employeeId: req.user!.id,
                type: 'OVERTIME_START',
                requestedTime: new Date(),
                reason: req.body.reason,
                status: 'PENDING'
            }
        });
        res.status(201).json(request);
    } catch (err) {
        console.error('[POST /overtime/start]', err);
        res.status(500).json({ error: 'Error requesting overtime' });
    }
});

// ── POST /overtime/end ────────────────────────────────────────────────────────
/**
 * Signals the end of overtime, pending admin confirmation.
 * When approved, the overtime end time is recorded and total overtime is calculated.
 */
router.post('/overtime/end', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const request = await prisma.attendanceRequest.create({
            data: {
                employeeId: req.user!.id,
                type: 'OVERTIME_END',
                requestedTime: new Date(),
                status: 'PENDING'
            }
        });
        res.status(201).json(request);
    } catch (err) {
        console.error('[POST /overtime/end]', err);
        res.status(500).json({ error: 'Error confirming overtime end' });
    }
});

// ── POST /leave ───────────────────────────────────────────────────────────────
/**
 * Submits a leave application covering a date range (leaveFrom → leaveTo).
 * The leave stays in PENDING status until an admin approves or rejects it.
 */
router.post('/leave', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { leaveFrom, leaveTo, reason } = req.body;
        if (!leaveFrom || !leaveTo) {
            res.status(400).json({ error: 'leaveFrom and leaveTo are required' });
            return;
        }

        const leave = await prisma.leave.create({
            data: {
                employeeId: req.user!.id,
                leaveFrom: new Date(leaveFrom),
                leaveTo: new Date(leaveTo),
                reason: reason || null,
                status: 'PENDING'
            }
        });
        res.status(201).json(leave);
    } catch (err) {
        console.error('[POST /leave]', err);
        res.status(500).json({ error: 'Error submitting leave request' });
    }
});

// ── POST /leave/confirm-end ───────────────────────────────────────────────────
/**
 * Employee signals they have returned from leave.
 * Creates a LEAVE_END request; admin approval sets leaveEndConfirmed = true,
 * which removes the "ON_LEAVE" status from the employee's dashboard.
 */
router.post('/leave/confirm-end', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const request = await prisma.attendanceRequest.create({
            data: {
                employeeId: req.user!.id,
                type: 'LEAVE_END',
                requestedTime: new Date(),
                status: 'PENDING'
            }
        });
        res.status(201).json(request);
    } catch (err) {
        console.error('[POST /leave/confirm-end]', err);
        res.status(500).json({ error: 'Error confirming leave end' });
    }
});

// ── POST /holiday ─────────────────────────────────────────────────────────────
/**
 * Requests a personal holiday day (e.g., public holiday not covered by standard leave).
 * holidayDate must be provided; description is optional.
 */
router.post('/holiday', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { holidayDate, description } = req.body;
        if (!holidayDate) {
            res.status(400).json({ error: 'holidayDate is required' });
            return;
        }

        const holiday = await prisma.holiday.create({
            data: {
                employeeId: req.user!.id,
                holidayDate: new Date(holidayDate),
                description: description || null,
                status: 'PENDING'
            }
        });
        res.status(201).json(holiday);
    } catch (err) {
        console.error('[POST /holiday]', err);
        res.status(500).json({ error: 'Error submitting holiday request' });
    }
});


// ════════════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════════

// ── GET /admin/pending ────────────────────────────────────────────────────────
/**
 * Returns all pending items waiting for admin/manager action, split into four groups:
 *  - requests:  CHECKIN, CHECKOUT, EARLY_CHECKOUT, LEAVE_END
 *  - overtimes: OVERTIME_START, OVERTIME_END
 *  - leaves:    Leave applications
 *  - holidays:  Holiday requests
 */
router.get('/admin/pending', authenticate, requireRole('ADMIN', 'MANAGER'), async (_req: Request, res: Response): Promise<void> => {
    try {
        const requests = await prisma.attendanceRequest.findMany({
            where: { status: 'PENDING', type: { in: ['CHECKIN', 'CHECKOUT', 'EARLY_CHECKOUT', 'LEAVE_END'] } },
            include: { employee: { select: { name: true, email: true } } },
            orderBy: { createdAt: 'desc' }
        });
        const overtimes = await prisma.attendanceRequest.findMany({
            where: { status: 'PENDING', type: { in: ['OVERTIME_START', 'OVERTIME_END'] } },
            include: { employee: { select: { name: true, email: true } } },
            orderBy: { createdAt: 'desc' }
        });
        const leaves = await prisma.leave.findMany({
            where: { status: 'PENDING' },
            include: { employee: { select: { name: true, email: true } } },
            orderBy: { createdAt: 'desc' }
        });
        const holidays = await prisma.holiday.findMany({
            where: { status: 'PENDING' },
            include: { employee: { select: { name: true, email: true } } },
            orderBy: { createdAt: 'desc' }
        });

        res.json({ requests, overtimes, leaves, holidays });
    } catch (err) {
        console.error('[GET /admin/pending]', err);
        res.status(500).json({ error: 'Error fetching pending requests' });
    }
});

// ── PUT /admin/request/:id/:action ────────────────────────────────────────────
/**
 * Approves or rejects a check-in, checkout, early-checkout, or leave-end request.
 *
 * On APPROVE, the corresponding attendance record is updated:
 *  - CHECKIN      → creates an Attendance row with checkInTime
 *  - CHECKOUT     → sets checkOutTime on today's attendance
 *  - EARLY_CHECKOUT → sets checkOutTime and marks attendance status as EARLY_CHECKOUT
 *  - LEAVE_END    → confirms the employee's active leave as ended
 */
router.put('/admin/request/:id/:action', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { action } = req.params;
        const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';

        // Update the request record first so both approve and reject paths are covered
        const request = await prisma.attendanceRequest.update({
            where: { id: req.params.id },
            data: { status: newStatus, adminId: req.user!.id, reviewedAt: new Date() }
        });

        if (action === 'approve') {
            // Normalise to the start of the day for attendance record lookup
            const day = new Date(request.requestedTime);
            day.setHours(0, 0, 0, 0);

            if (request.type === 'CHECKIN') {
                // Only create attendance record if one doesn't already exist for today (safety guard)
                const existing = await prisma.attendance.findFirst({
                    where: { employeeId: request.employeeId, date: { gte: day } }
                });
                if (!existing) {
                    await prisma.attendance.create({
                        data: { employeeId: request.employeeId, date: day, checkInTime: request.requestedTime, status: 'PRESENT' }
                    });
                }
            } else if (request.type === 'CHECKOUT') {
                // Record the exact checkout time on the existing attendance record
                await prisma.attendance.updateMany({
                    where: { employeeId: request.employeeId, date: { gte: day } },
                    data: { checkOutTime: request.requestedTime }
                });
            } else if (request.type === 'EARLY_CHECKOUT') {
                // Mark attendance status as EARLY_CHECKOUT so it appears differently in reports
                await prisma.attendance.updateMany({
                    where: { employeeId: request.employeeId, date: { gte: day } },
                    data: { checkOutTime: request.requestedTime, status: 'EARLY_CHECKOUT' }
                });
            } else if (request.type === 'LEAVE_END') {
                // Find the employee's active leave and confirm it has ended
                const activeLeaves = await prisma.leave.findMany({
                    where: { employeeId: request.employeeId, status: 'APPROVED', leaveEndConfirmed: false, leaveFrom: { lte: new Date() } },
                    orderBy: { leaveTo: 'desc' }
                });
                for (const leave of activeLeaves) {
                    if (leave.leaveTo > new Date()) {
                        // Employee returned early — truncate the leave end date to now
                        await prisma.leave.update({
                            where: { id: leave.id },
                            data: { leaveTo: new Date(), leaveEndConfirmed: true }
                        });
                    } else {
                        // Leave period has already passed — simply confirm the end
                        await prisma.leave.update({
                            where: { id: leave.id },
                            data: { leaveEndConfirmed: true }
                        });
                    }
                }
            }
        }

        res.json({ message: 'Processed', request });
    } catch (err) {
        console.error('[PUT /admin/request/:id/:action]', err);
        res.status(500).json({ error: 'Error processing request' });
    }
});

// ── PUT /admin/overtime/:id/:action ──────────────────────────────────────────
/**
 * Approves or rejects overtime requests.
 *
 * On APPROVE:
 *  - OVERTIME_START → creates an Overtime record and sets overtimeStart on attendance
 *  - OVERTIME_END   → updates the active Overtime record with end time and duration,
 *                     sets overtimeEnd on attendance
 */
router.put('/admin/overtime/:id/:action', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { action } = req.params;
        const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';

        const request = await prisma.attendanceRequest.update({
            where: { id: req.params.id },
            data: { status: newStatus, adminId: req.user!.id, reviewedAt: new Date() }
        });

        if (action === 'approve') {
            const day = new Date(request.requestedTime);
            day.setHours(0, 0, 0, 0);

            if (request.type === 'OVERTIME_START') {
                // Create an in-progress overtime record and stamp the attendance row
                await prisma.overtime.create({
                    data: {
                        employeeId: request.employeeId,
                        overtimeStart: request.requestedTime,
                        status: 'APPROVED',
                        reason: request.reason || ''
                    }
                });
                await prisma.attendance.updateMany({
                    where: { employeeId: request.employeeId, date: { gte: day } },
                    data: { overtimeStart: request.requestedTime }
                });
            } else if (request.type === 'OVERTIME_END') {
                // Find the open overtime record and close it
                const activeOT = await prisma.overtime.findFirst({
                    where: { employeeId: request.employeeId, status: 'APPROVED' }
                });
                if (activeOT) {
                    await prisma.overtime.update({
                        where: { id: activeOT.id },
                        data: { overtimeEnd: request.requestedTime, status: 'COMPLETED', endConfirmed: true }
                    });
                }
                // Also stamp the attendance row with the overtime end time
                await prisma.attendance.updateMany({
                    where: { employeeId: request.employeeId, date: { gte: day } },
                    data: { overtimeEnd: request.requestedTime }
                });
            }
        }

        res.json({ message: 'Processed', request });
    } catch (err) {
        console.error('[PUT /admin/overtime/:id/:action]', err);
        res.status(500).json({ error: 'Error processing overtime request' });
    }
});

// ── PUT /admin/leave/:id/:action ──────────────────────────────────────────────
/**
 * Approves or rejects a leave application.
 * Sends an in-app notification to the employee when their leave is approved.
 */
router.put('/admin/leave/:id/:action', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const newStatus = req.params.action === 'approve' ? 'APPROVED' : 'REJECTED';
        const leave = await prisma.leave.update({
            where: { id: req.params.id },
            data: { status: newStatus, adminId: req.user!.id }
        });

        if (newStatus === 'APPROVED') {
            // Notify the employee so they can see the outcome in their notification feed
            await prisma.notification.create({
                data: {
                    fromRole: 'ADMIN',
                    toRole: 'EMPLOYEE',
                    userId: leave.employeeId,
                    message: 'Your leave request has been approved.'
                }
            });
        }

        res.json({ message: 'Processed', leave });
    } catch (err) {
        console.error('[PUT /admin/leave/:id/:action]', err);
        res.status(500).json({ error: 'Error processing leave request' });
    }
});

// ── PUT /admin/holiday/:id/:action ────────────────────────────────────────────
/**
 * Approves or rejects a holiday request.
 * Notifies the employee with the specific holiday date on approval.
 */
router.put('/admin/holiday/:id/:action', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const newStatus = req.params.action === 'approve' ? 'APPROVED' : 'REJECTED';
        const holiday = await prisma.holiday.update({
            where: { id: req.params.id },
            data: { status: newStatus, declaredBy: req.user!.id }
        });

        if (newStatus === 'APPROVED') {
            // Notify employee of approval with the holiday date for clarity
            await prisma.notification.create({
                data: {
                    fromRole: 'ADMIN',
                    toRole: 'EMPLOYEE',
                    userId: holiday.employeeId,
                    message: `Your holiday on ${new Date(holiday.holidayDate).toLocaleDateString()} has been approved.`
                }
            });
        }

        res.json({ message: 'Processed', holiday });
    } catch (err) {
        console.error('[PUT /admin/holiday/:id/:action]', err);
        res.status(500).json({ error: 'Error processing holiday request' });
    }
});


// ════════════════════════════════════════════════════════════════════════════════
// MANAGER ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════════

// ── GET /manager/overview ─────────────────────────────────────────────────────
/**
 * Returns an aggregated attendance overview for all employees over a period.
 * Supports 'weekly' (current week) and 'monthly' (current month) ranges.
 *
 * For each employee the response includes:
 *  - daysPresent, leaveDays, overtimeHours, earlyCheckouts, holidayDays
 *  - currentStatus: today's live status (PRESENT, ON_LEAVE, HOLIDAY, etc.)
 *  - conflict: true if the employee is marked PRESENT but also on leave/holiday today
 *
 * Algorithm: initialises a map with all employees then merges attendance, leave,
 * and holiday records into per-employee metrics in a single pass each.
 */
router.get('/manager/overview', authenticate, requireRole('MANAGER'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const period = (req.query.period as string) || 'weekly';
        const now = new Date();
        const startDate = new Date();

        // Calculate period start date
        if (period === 'weekly') {
            startDate.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
            startDate.setHours(0, 0, 0, 0);
        } else if (period === 'monthly') {
            startDate.setDate(1); // First day of current month
            startDate.setHours(0, 0, 0, 0);
        }
        const endDate = new Date();
        endDate.setHours(23, 59, 59, 999);

        // Step 1: Initialise the overview map with ALL employees (ensures zero-value entries)
        const employees = await prisma.user.findMany({
            where: { role: 'EMPLOYEE' },
            select: { id: true, name: true, email: true }
        });

        const overviewMap: Record<string, any> = {};
        for (const e of employees) {
            overviewMap[e.id] = {
                employee: e,
                daysPresent: 0, leaveDays: 0, overtimeHours: 0,
                earlyCheckouts: 0, holidayDays: 0,
                currentStatus: 'Not Checked In',
                conflict: false
            };
        }

        // Step 2: Merge attendance records — count days present, early checkouts, and overtime hours
        const attendances = await prisma.attendance.findMany({
            where: { date: { gte: startDate, lte: endDate } }
        });
        const todayStr = new Date().toDateString();

        for (const a of attendances) {
            if (!overviewMap[a.employeeId]) continue;
            overviewMap[a.employeeId].daysPresent++;
            if (a.status === 'EARLY_CHECKOUT') overviewMap[a.employeeId].earlyCheckouts++;

            // Calculate overtime hours if both start and end are recorded
            if (a.overtimeStart && a.overtimeEnd) {
                overviewMap[a.employeeId].overtimeHours +=
                    (new Date(a.overtimeEnd).getTime() - new Date(a.overtimeStart).getTime()) / 3600000;
            }

            // Set today's live status from the attendance record
            if (a.date.toDateString() === todayStr) {
                overviewMap[a.employeeId].currentStatus = a.status;
            }
        }

        // Step 3: Merge leave records — count leave days and set ON_LEAVE status if active today
        const leaves = await prisma.leave.findMany({
            where: { status: 'APPROVED', leaveFrom: { lte: endDate }, leaveTo: { gte: startDate } }
        });
        for (const l of leaves) {
            if (!overviewMap[l.employeeId]) continue;

            // Calculate intersection of leave period with the selected reporting window
            const intersectStart = l.leaveFrom > startDate ? l.leaveFrom : startDate;
            const intersectEnd   = l.leaveTo   < endDate   ? l.leaveTo   : endDate;
            const days = Math.ceil((intersectEnd.getTime() - intersectStart.getTime()) / (1000 * 3600 * 24));
            overviewMap[l.employeeId].leaveDays += isNaN(days) ? 0 : Math.max(1, days);

            // Override current status if employee is actively on leave today
            if (l.leaveFrom <= new Date() && !l.leaveEndConfirmed) {
                overviewMap[l.employeeId].currentStatus = 'ON_LEAVE';
            }
        }

        // Step 4: Merge holiday records
        const holidays = await prisma.holiday.findMany({
            where: { status: 'APPROVED', holidayDate: { gte: startDate, lte: endDate } }
        });
        for (const h of holidays) {
            if (!overviewMap[h.employeeId]) continue;
            overviewMap[h.employeeId].holidayDays++;

            // Override current status if today is a holiday day
            if (h.holidayDate.toDateString() === todayStr) {
                overviewMap[h.employeeId].currentStatus = 'HOLIDAY';
            }
        }

        // Step 5: Flag conflicts where an employee is marked PRESENT but also on leave/holiday
        for (const id in overviewMap) {
            const m = overviewMap[id];
            const onLeaveToday    = leaves.some((l: any)   => l.employeeId === id && l.leaveFrom.toDateString() === todayStr);
            const onHolidayToday  = holidays.some((h: any) => h.employeeId === id && h.holidayDate.toDateString() === todayStr);
            if (m.currentStatus === 'PRESENT' && (onLeaveToday || onHolidayToday)) {
                m.conflict = true;
            }
        }

        res.json({
            period,
            startDate,
            endDate,
            overview: Object.values(overviewMap)
        });
    } catch (err: any) {
        console.error('[GET /manager/overview]', err);
        res.status(500).json({ error: 'Error fetching overview', details: err.message, stack: err.stack });
    }
});

// ── POST /manager/archive ─────────────────────────────────────────────────────
/**
 * Archives all current attendance records into the attendanceHistory table,
 * then clears the live attendance table.
 * This is typically run at the end of a pay period so historical records are
 * preserved separately from the active working table.
 */
router.post('/manager/archive', authenticate, requireRole('MANAGER'), async (_req: Request, res: Response): Promise<void> => {
    try {
        const records = await prisma.attendance.findMany({ include: { employee: true } });

        // Copy each record to the history table with a snapshot of the employee name
        for (const att of records) {
            await prisma.attendanceHistory.create({
                data: {
                    employeeId: att.employeeId,
                    employeeName: att.employee.name,  // Denormalised for historical accuracy
                    date: att.date,
                    checkInTime: att.checkInTime,
                    checkOutTime: att.checkOutTime,
                    attendanceStatus: att.status,
                    archivedAt: new Date()
                }
            });
        }

        // Clear the live attendance table after archiving
        await prisma.attendance.deleteMany({});
        res.json({ archived: records.length });
    } catch (err) {
        console.error('[POST /manager/archive]', err);
        res.status(500).json({ error: 'Error archiving attendance' });
    }
});

// ── GET /manager/history ──────────────────────────────────────────────────────
/**
 * Returns archived attendance history records, most recently archived first.
 * Used by the manager to review past attendance after the active table has been cleared.
 */
router.get('/manager/history', authenticate, requireRole('MANAGER'), async (_req: Request, res: Response): Promise<void> => {
    try {
        const history = await prisma.attendanceHistory.findMany({ orderBy: { archivedAt: 'desc' } });
        res.json(history);
    } catch (err) {
        console.error('[GET /manager/history]', err);
        res.status(500).json({ error: 'Error fetching history' });
    }
});

// ── GET /manager/employees ────────────────────────────────────────────────────
/**
 * Returns a live status snapshot for every employee for today.
 * Status priority: ON_LEAVE > HOLIDAY > attendance status > "Not Checked In"
 * Used by the manager dashboard's real-time employee monitor.
 */
router.get('/manager/employees', authenticate, requireRole('MANAGER'), async (_req: Request, res: Response): Promise<void> => {
    try {
        const employees = await prisma.user.findMany({ where: { role: 'EMPLOYEE' } });

        const now = new Date();
        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
        const endOfDay   = new Date(); endOfDay.setHours(23, 59, 59, 999);

        // Fetch all relevant records for today in three queries
        const attendances = await prisma.attendance.findMany({
            where: { date: { gte: startOfDay, lte: endOfDay } }
        });
        const leaves = await prisma.leave.findMany({
            where: { status: 'APPROVED', leaveFrom: { lte: now }, leaveEndConfirmed: false }
        });
        const holidays = await prisma.holiday.findMany({
            where: { status: 'APPROVED', holidayDate: { gte: startOfDay, lte: endOfDay } }
        });

        // Map each employee to their current status using the priority rule above
        const list = employees.map(e => {
            let status = 'Not Checked In';

            const att = attendances.find(a => a.employeeId === e.id);
            const lv  = leaves.find(l => l.employeeId === e.id && l.leaveTo > now);
            const hol = holidays.find(h => h.employeeId === e.id);

            // Apply priority: leave > holiday > attendance record
            if (lv)            status = 'ON_LEAVE';
            else if (hol)      status = 'HOLIDAY';
            else if (att?.status) status = att.status;

            return { id: e.id, name: e.name, todayStatus: status };
        });

        res.json(list);
    } catch (err: any) {
        console.error('[GET /manager/employees]', err);
        res.status(500).json({ error: 'Error fetching snapshot employees', details: err.message, stack: err.stack });
    }
});

export default router;
