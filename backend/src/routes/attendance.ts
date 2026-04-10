import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// ==== EMPLOYEE ====

// GET /today — today's attendance status for the logged-in employee
router.get('/today', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const empId = req.user!.id;

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

// GET /my — full attendance history for the logged-in employee
router.get('/my', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const empId = req.user!.id;
        const requests = await prisma.attendanceRequest.findMany({ where: { employeeId: empId }, orderBy: { createdAt: 'desc' } });
        const leaves = await prisma.leave.findMany({ where: { employeeId: empId }, orderBy: { createdAt: 'desc' } });
        const overtimes = await prisma.overtime.findMany({ where: { employeeId: empId }, orderBy: { createdAt: 'desc' } });
        const holidays = await prisma.holiday.findMany({ where: { employeeId: empId }, orderBy: { createdAt: 'desc' } });
        const attendance = await prisma.attendance.findMany({ where: { employeeId: empId }, orderBy: { date: 'desc' } });

        res.json({ requests, leaves, overtimes, holidays, attendance });
    } catch (err) {
        console.error('[GET /my]', err);
        res.status(500).json({ error: 'Error fetching attendance records' });
    }
});

// POST /checkin
router.post('/checkin', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        // Check if a PENDING CHECKIN request already exists for today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
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

// POST /checkout
router.post('/checkout', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { reason } = req.body;
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        const isEarly = currentMinutes < 1110; // before 18:30
        const type = isEarly ? 'EARLY_CHECKOUT' : 'CHECKOUT';

        const request = await prisma.attendanceRequest.create({
            data: { employeeId: req.user!.id, type, requestedTime: now, reason: isEarly ? reason : null, status: 'PENDING' }
        });
        res.status(201).json(request);
    } catch (err) {
        console.error('[POST /checkout]', err);
        res.status(500).json({ error: 'Error submitting checkout request' });
    }
});

// POST /overtime/start
router.post('/overtime/start', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const request = await prisma.attendanceRequest.create({
            data: { employeeId: req.user!.id, type: 'OVERTIME_START', requestedTime: new Date(), reason: req.body.reason, status: 'PENDING' }
        });
        res.status(201).json(request);
    } catch (err) {
        console.error('[POST /overtime/start]', err);
        res.status(500).json({ error: 'Error requesting overtime' });
    }
});

// POST /overtime/end
router.post('/overtime/end', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const request = await prisma.attendanceRequest.create({
            data: { employeeId: req.user!.id, type: 'OVERTIME_END', requestedTime: new Date(), status: 'PENDING' }
        });
        res.status(201).json(request);
    } catch (err) {
        console.error('[POST /overtime/end]', err);
        res.status(500).json({ error: 'Error confirming overtime end' });
    }
});

// POST /leave
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

// POST /leave/confirm-end
router.post('/leave/confirm-end', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const request = await prisma.attendanceRequest.create({
            data: { employeeId: req.user!.id, type: 'LEAVE_END', requestedTime: new Date(), status: 'PENDING' }
        });
        res.status(201).json(request);
    } catch (err) {
        console.error('[POST /leave/confirm-end]', err);
        res.status(500).json({ error: 'Error confirming leave end' });
    }
});

// POST /holiday
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


// ==== ADMIN ====

// GET /admin/pending — all pending requests for admin to review
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

// PUT /admin/request/:id/approve  or  /admin/request/:id/reject
router.put('/admin/request/:id/:action', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
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

            if (request.type === 'CHECKIN') {
                const existing = await prisma.attendance.findFirst({ where: { employeeId: request.employeeId, date: { gte: day } } });
                if (!existing) {
                    await prisma.attendance.create({
                        data: { employeeId: request.employeeId, date: day, checkInTime: request.requestedTime, status: 'PRESENT' }
                    });
                }
            } else if (request.type === 'CHECKOUT') {
                await prisma.attendance.updateMany({
                    where: { employeeId: request.employeeId, date: { gte: day } },
                    data: { checkOutTime: request.requestedTime }
                });
            } else if (request.type === 'EARLY_CHECKOUT') {
                await prisma.attendance.updateMany({
                    where: { employeeId: request.employeeId, date: { gte: day } },
                    data: { checkOutTime: request.requestedTime, status: 'EARLY_CHECKOUT' }
                });
            } else if (request.type === 'LEAVE_END') {
                const activeLeaves = await prisma.leave.findMany({
                    where: { employeeId: request.employeeId, status: 'APPROVED', leaveEndConfirmed: false, leaveFrom: { lte: new Date() } },
                    orderBy: { leaveTo: 'desc' }
                });
                for (const leave of activeLeaves) {
                    if (leave.leaveTo > new Date()) {
                        await prisma.leave.update({
                            where: { id: leave.id },
                            data: { leaveTo: new Date(), leaveEndConfirmed: true }
                        });
                    } else {
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

// PUT /admin/overtime/:id/approve  or  /admin/overtime/:id/reject
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
                await prisma.overtime.create({
                    data: { employeeId: request.employeeId, overtimeStart: request.requestedTime, status: 'APPROVED', reason: request.reason || '' }
                });
                await prisma.attendance.updateMany({
                    where: { employeeId: request.employeeId, date: { gte: day } },
                    data: { overtimeStart: request.requestedTime }
                });
            } else if (request.type === 'OVERTIME_END') {
                const activeOT = await prisma.overtime.findFirst({ where: { employeeId: request.employeeId, status: 'APPROVED' } });
                if (activeOT) {
                    await prisma.overtime.update({
                        where: { id: activeOT.id },
                        data: { overtimeEnd: request.requestedTime, status: 'COMPLETED', endConfirmed: true }
                    });
                }
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

// PUT /admin/leave/:id/approve  or  /admin/leave/:id/reject
router.put('/admin/leave/:id/:action', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const newStatus = req.params.action === 'approve' ? 'APPROVED' : 'REJECTED';
        const leave = await prisma.leave.update({
            where: { id: req.params.id },
            data: { status: newStatus, adminId: req.user!.id }
        });
        if (newStatus === 'APPROVED') {
            await prisma.notification.create({
                data: { fromRole: 'ADMIN', toRole: 'EMPLOYEE', userId: leave.employeeId, message: 'Your leave request has been approved.' }
            });
        }
        res.json({ message: 'Processed', leave });
    } catch (err) {
        console.error('[PUT /admin/leave/:id/:action]', err);
        res.status(500).json({ error: 'Error processing leave request' });
    }
});

// PUT /admin/holiday/:id/approve  or  /admin/holiday/:id/reject
router.put('/admin/holiday/:id/:action', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const newStatus = req.params.action === 'approve' ? 'APPROVED' : 'REJECTED';
        const holiday = await prisma.holiday.update({
            where: { id: req.params.id },
            data: { status: newStatus, declaredBy: req.user!.id }
        });
        if (newStatus === 'APPROVED') {
            // Notify employee of approval
            await prisma.notification.create({
                data: { fromRole: 'ADMIN', toRole: 'EMPLOYEE', userId: holiday.employeeId, message: `Your holiday on ${new Date(holiday.holidayDate).toLocaleDateString()} has been approved.` }
            });
        }
        res.json({ message: 'Processed', holiday });
    } catch (err) {
        console.error('[PUT /admin/holiday/:id/:action]', err);
        res.status(500).json({ error: 'Error processing holiday request' });
    }
});


// ==== MANAGER ====

// GET /manager/overview
router.get('/manager/overview', authenticate, requireRole('MANAGER'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const period = (req.query.period as string) || 'weekly';
        const now = new Date();
        const startDate = new Date();
        if (period === 'weekly') {
            startDate.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
            startDate.setHours(0, 0, 0, 0);
        } else if (period === 'monthly') {
            startDate.setDate(1); // Start of month
            startDate.setHours(0, 0, 0, 0);
        }
        const endDate = new Date();
        endDate.setHours(23, 59, 59, 999);

        // 1. Initialize map with ALL employees
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

        // 2. Add Attendance Metrics
        const attendances = await prisma.attendance.findMany({
            where: { date: { gte: startDate, lte: endDate } }
        });

        const todayStr = new Date().toDateString();

        for (const a of attendances) {
            if (!overviewMap[a.employeeId]) continue;
            overviewMap[a.employeeId].daysPresent++;
            if (a.status === 'EARLY_CHECKOUT') overviewMap[a.employeeId].earlyCheckouts++;
            if (a.overtimeStart && a.overtimeEnd) {
                overviewMap[a.employeeId].overtimeHours +=
                    (new Date(a.overtimeEnd).getTime() - new Date(a.overtimeStart).getTime()) / 3600000;
            }
            if (a.date.toDateString() === todayStr) {
                overviewMap[a.employeeId].currentStatus = a.status;
            }
        }

        // 3. Add Leave Metrics
        const leaves = await prisma.leave.findMany({
            where: { status: 'APPROVED', leaveFrom: { lte: endDate }, leaveTo: { gte: startDate } }
        });
        for (const l of leaves) {
            if (!overviewMap[l.employeeId]) continue;
            const intersectStart = l.leaveFrom > startDate ? l.leaveFrom : startDate;
            const intersectEnd = l.leaveTo < endDate ? l.leaveTo : endDate;
            const days = Math.ceil((intersectEnd.getTime() - intersectStart.getTime()) / (1000 * 3600 * 24));
            overviewMap[l.employeeId].leaveDays += isNaN(days) ? 0 : Math.max(1, days);

            // If they have an active leave today, set status
            if (l.leaveFrom <= new Date() && !l.leaveEndConfirmed) {
                overviewMap[l.employeeId].currentStatus = 'ON_LEAVE';
            }
        }

        // 4. Add Holiday Metrics
        const holidays = await prisma.holiday.findMany({
            where: { status: 'APPROVED', holidayDate: { gte: startDate, lte: endDate } }
        });
        for (const h of holidays) {
            if (!overviewMap[h.employeeId]) continue;
            overviewMap[h.employeeId].holidayDays++;

            if (h.holidayDate.toDateString() === todayStr) {
                overviewMap[h.employeeId].currentStatus = 'HOLIDAY';
            }
        }

        // 5. Calculate Conflicts (If daysPresent > 0 and (leaveDays > Math.expected or whatever), but simpler: if today they checked in BUT they are on leave/holiday)
        // Just evaluating if they have a weird status combination:
        for (const id in overviewMap) {
            const m = overviewMap[id];
            if (m.currentStatus === 'PRESENT' && (leaves.some((l: any) => l.employeeId === id && l.leaveFrom.toDateString() === todayStr) || holidays.some((h: any) => h.employeeId === id && h.holidayDate.toDateString() === todayStr))) {
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

// POST /manager/archive
router.post('/manager/archive', authenticate, requireRole('MANAGER'), async (_req: Request, res: Response): Promise<void> => {
    try {
        const records = await prisma.attendance.findMany({ include: { employee: true } });
        for (const att of records) {
            await prisma.attendanceHistory.create({
                data: {
                    employeeId: att.employeeId,
                    employeeName: att.employee.name,
                    date: att.date,
                    checkInTime: att.checkInTime,
                    checkOutTime: att.checkOutTime,
                    attendanceStatus: att.status,
                    archivedAt: new Date()
                }
            });
        }
        await prisma.attendance.deleteMany({});
        res.json({ archived: records.length });
    } catch (err) {
        console.error('[POST /manager/archive]', err);
        res.status(500).json({ error: 'Error archiving attendance' });
    }
});

// GET /manager/history
router.get('/manager/history', authenticate, requireRole('MANAGER'), async (_req: Request, res: Response): Promise<void> => {
    try {
        const history = await prisma.attendanceHistory.findMany({ orderBy: { archivedAt: 'desc' } });
        res.json(history);
    } catch (err) {
        console.error('[GET /manager/history]', err);
        res.status(500).json({ error: 'Error fetching history' });
    }
});

// GET /manager/employees
router.get('/manager/employees', authenticate, requireRole('MANAGER'), async (_req: Request, res: Response): Promise<void> => {
    try {
        const employees = await prisma.user.findMany({ where: { role: 'EMPLOYEE' } });

        const now = new Date();
        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);

        // Fetch all of today's live states
        const attendances = await prisma.attendance.findMany({
            where: { date: { gte: startOfDay, lte: endOfDay } }
        });
        const leaves = await prisma.leave.findMany({
            where: { status: 'APPROVED', leaveFrom: { lte: now }, leaveEndConfirmed: false }
        });
        const holidays = await prisma.holiday.findMany({
            where: { status: 'APPROVED', holidayDate: { gte: startOfDay, lte: endOfDay } }
        });

        const list = employees.map(e => {
            let status = 'Not Checked In';

            const att = attendances.find(a => a.employeeId === e.id);
            const lv = leaves.find(l => l.employeeId === e.id && l.leaveTo > now);
            const hol = holidays.find(h => h.employeeId === e.id);

            // Determine snapshot priority
            if (lv) status = 'ON_LEAVE';
            else if (hol) status = 'HOLIDAY';
            else if (att && att.status) status = att.status;

            return { id: e.id, name: e.name, todayStatus: status };
        });

        res.json(list);
    } catch (err: any) {
        console.error('[GET /manager/employees]', err);
        res.status(500).json({ error: 'Error fetching snapshot employees', details: err.message, stack: err.stack });
    }
});

export default router;
