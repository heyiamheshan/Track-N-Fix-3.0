import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import FormData from 'form-data';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';

// In development, bypass SSL cert verification (handles VPN/proxy cert issues)
const httpsAgent = new https.Agent({ rejectUnauthorized: process.env.NODE_ENV === 'production' });

const router = Router();

// ── Storage setup ─────────────────────────────────────────────────────────────

const uploadsDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
        let ext = path.extname(file.originalname);
        if (!ext) ext = file.mimetype.includes('mp4') ? '.mp4' : '.webm';
        cb(null, `${uuidv4()}${ext}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/')) cb(null, true);
        else cb(new Error('Only audio allowed'));
    },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDateRange(range: string): { start: Date; end: Date } {
    const ref = new Date();
    ref.setHours(0, 0, 0, 0);

    if (range === 'daily') {
        const end = new Date(ref);
        end.setHours(23, 59, 59, 999);
        return { start: ref, end };
    }
    if (range === 'weekly') {
        const day = ref.getDay();
        const diffToMon = day === 0 ? -6 : 1 - day;
        const start = new Date(ref);
        start.setDate(ref.getDate() + diffToMon);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        return { start, end };
    }
    // monthly
    const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
}

async function groqTranscribe(filePath: string, mimeType: string): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY not set');

    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath), {
        filename: path.basename(filePath),
        contentType: mimeType,
    });
    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'en');
    formData.append('response_format', 'json');

    const res = await axios.post<{ text: string }>(
        'https://api.groq.com/openai/v1/audio/transcriptions',
        formData,
        {
            headers: { Authorization: `Bearer ${apiKey}`, ...formData.getHeaders() },
            httpsAgent,
        }
    );

    return res.data.text?.trim() || '';
}

async function groqChat(systemPrompt: string, userMessage: string): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY not set');

    const res = await axios.post<{ choices: { message: { content: string } }[] }>(
        'https://api.groq.com/openai/v1/chat/completions',
        {
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            temperature: 0.3,
            max_tokens: 600,
        },
        {
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            httpsAgent,
        }
    );

    return res.data.choices?.[0]?.message?.content?.trim() || '{}';
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/voice/upload  (existing – for job voice note attachment)
router.post('/upload', authenticate, upload.single('voice'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        if (!req.file) { res.status(400).json({ error: 'No audio file uploaded' }); return; }
        const url = `/uploads/${req.file.filename}`;
        res.status(201).json({ url });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// POST /api/voice/query  (AI assistant – manager only)
// Accepts multipart with optional "audio" file + "text" field + "context" JSON string
// OR application/json with { text, context }
router.post('/query', authenticate, requireRole('MANAGER'), upload.single('audio'), async (req: AuthRequest, res: Response): Promise<void> => {
    let tempFilePath: string | null = null;

    try {
        if (!process.env.GROQ_API_KEY) {
            res.status(503).json({ error: 'AI assistant not configured (GROQ_API_KEY missing)' });
            return;
        }

        // 1. Get transcript ─────────────────────────────────────────────────
        let transcript = '';

        if (req.file) {
            tempFilePath = req.file.path;
            transcript = await groqTranscribe(req.file.path, req.file.mimetype);
        } else {
            transcript = (req.body.text as string)?.trim() || '';
        }

        if (!transcript) {
            res.status(400).json({ error: 'No audio or text provided' });
            return;
        }

        let context: Record<string, string> = {};
        try { context = req.body.context ? JSON.parse(req.body.context) : {}; } catch { /* ignore */ }

        // 2. Classify intent with LLaMA-3 ───────────────────────────────────
        const today = new Date().toISOString().split('T')[0];
        const systemPrompt = `You are an AI assistant for TrackNFix, a vehicle service management system for Jayakody Auto Electrical workshop. Today is ${today}.

Analyze the user query and respond with ONLY valid JSON (no markdown, no code fences):
{
  "response": "<brief 1-2 sentence spoken reply>",
  "intent": "<one of: vehicle_history | print_report | inventory_query | employee_status | financial_query | general>",
  "params": {
    "vehicleNumber": "<extract from query or use context if intent is vehicle_history/print_report, else null>",
    "partName": "<specific part name if intent is inventory_query, else null>",
    "employeeName": "<employee name if intent is employee_status, else null>",
    "period": "<today | this_week | this_month — if intent is financial_query>",
    "category": "<ACCIDENT_RECOVERY | SERVICE | REPAIR — if intent is financial_query and user specifies, else null>"
  }
}

Current page context: ${JSON.stringify(context)}`;

        const llmRaw = await groqChat(systemPrompt, transcript);

        let parsed: { response: string; intent: string; params: Record<string, string | null> } = {
            response: llmRaw,
            intent: 'general',
            params: {},
        };
        try { parsed = JSON.parse(llmRaw); } catch { /* fallback already set */ }

        const { intent, params } = parsed;

        // 3. Execute read-only DB queries based on intent ───────────────────
        let data: unknown = null;

        // ── Vehicle history / Print report ──────────────────────────────────
        if (intent === 'vehicle_history' || intent === 'print_report') {
            const vehicleNumber = params.vehicleNumber || context.vehicleNumber;
            if (vehicleNumber) {
                const vehicle = await prisma.vehicle.findUnique({
                    where: { vehicleNumber },
                    include: {
                        jobs: {
                            orderBy: { createdAt: 'desc' },
                            include: {
                                employee: { select: { name: true } },
                                images: true,
                                quotations: {
                                    include: { items: true },
                                },
                            },
                        },
                    },
                });
                data = vehicle;
                if (!vehicle) {
                    parsed.response = `No records found for vehicle number ${vehicleNumber}.`;
                } else {
                    parsed.response = `Found ${vehicle.jobs.length} service record${vehicle.jobs.length !== 1 ? 's' : ''} for ${vehicleNumber}${vehicle.ownerName ? `, owned by ${vehicle.ownerName}` : ''}.`;
                }
            } else {
                parsed.response = 'Please specify the vehicle registration number.';
            }

        // ── Inventory query ─────────────────────────────────────────────────
        } else if (intent === 'inventory_query') {
            if (params.partName) {
                const items = await prisma.sparePart.findMany({
                    where: { name: { contains: params.partName, mode: 'insensitive' } },
                });
                data = items;
                if (items.length === 0) {
                    parsed.response = `No parts matching "${params.partName}" found in inventory.`;
                } else {
                    const total = items.reduce((s: number, p: { quantity: number }) => s + p.quantity, 0);
                    const low = items.filter((p: { quantity: number; lowStockThreshold: number }) => p.quantity <= p.lowStockThreshold);
                    parsed.response = `Found ${items.length} part type${items.length > 1 ? 's' : ''} matching "${params.partName}" with ${total} units total.${low.length ? ` Warning: ${low.length} item${low.length > 1 ? 's are' : ' is'} at or below low-stock threshold.` : ''}`;
                }
            } else {
                const allParts = await prisma.sparePart.findMany();
                const lowStock = allParts.filter((p: { quantity: number; lowStockThreshold: number }) => p.quantity <= p.lowStockThreshold);
                const totalValue = allParts.reduce((s: number, p: { boughtPrice: number; quantity: number }) => s + p.boughtPrice * p.quantity, 0);
                data = { total: allParts.length, lowStockCount: lowStock.length, lowStockItems: lowStock, totalInventoryValue: totalValue };
                parsed.response = `Inventory has ${allParts.length} part types. ${lowStock.length > 0 ? `${lowStock.length} item${lowStock.length > 1 ? 's are' : ' is'} low on stock.` : 'All items are adequately stocked.'} Total inventory value is LKR ${totalValue.toLocaleString()}.`;
            }

        // ── Employee status ─────────────────────────────────────────────────
        } else if (intent === 'employee_status') {
            const now = new Date();
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            const employee = await prisma.user.findFirst({
                where: {
                    name: { contains: params.employeeName || '', mode: 'insensitive' },
                    role: 'EMPLOYEE',
                },
            });

            if (!employee) {
                parsed.response = `No employee found matching "${params.employeeName || 'that name'}".`;
            } else {
                // Run attendance, leave, and holiday queries in parallel
                const [attendance, activeLeaves, todayHolidays] = await Promise.all([
                    prisma.attendance.findFirst({
                        where: { employeeId: employee.id, date: todayStart },
                    }),
                    prisma.leave.findMany({
                        where: {
                            employeeId: employee.id,
                            status: 'APPROVED',
                            leaveFrom: { lte: now },
                            leaveTo: { gte: now },
                        },
                    }),
                    prisma.holiday.findMany({
                        where: {
                            employeeId: employee.id,
                            status: 'APPROVED',
                            holidayDate: todayStart,
                        },
                    }),
                ]);

                data = { employee, attendance, activeLeaves, todayHolidays };

                if (!employee.isActive) {
                    parsed.response = `${employee.name} is currently inactive.`;
                } else if (activeLeaves.length > 0) {
                    parsed.response = `${employee.name} is on approved leave today.`;
                } else if (todayHolidays.length > 0) {
                    parsed.response = `${employee.name} is on a holiday today.`;
                } else if (!attendance?.checkInTime) {
                    parsed.response = `${employee.name} has not checked in today.`;
                } else if (attendance.checkInTime && !attendance.checkOutTime) {
                    const timeStr = new Date(attendance.checkInTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                    parsed.response = `${employee.name} is currently at work — checked in at ${timeStr}.`;
                } else {
                    parsed.response = `${employee.name} has checked out for today.`;
                }
            }

        // ── Financial query ─────────────────────────────────────────────────
        } else if (intent === 'financial_query') {
            const rangeMap: Record<string, string> = { today: 'daily', this_week: 'weekly', this_month: 'monthly' };
            const range = rangeMap[params.period || ''] || 'monthly';
            const { start, end } = getDateRange(range);

            const jobWhere = params.category
                ? { jobType: params.category as 'SERVICE' | 'REPAIR' | 'ACCIDENT_RECOVERY' }
                : undefined;

            const finalized = await prisma.quotation.findMany({
                where: {
                    status: 'FINALIZED',
                    updatedAt: { gte: start, lte: end },
                    ...(jobWhere ? { job: jobWhere } : {}),
                },
                include: { job: { select: { jobType: true } } },
            });

            const revenue = finalized.reduce((s, q) => s + (q.totalAmount || 0), 0);

            // COGS via stock ledger (negative entries = consumption), same method as analytics
            const ledger = await prisma.stockLedger.findMany({
                where: { createdAt: { gte: start, lte: end }, change: { lt: 0 } },
                include: { sparePart: { select: { boughtPrice: true } } },
            });
            const cogs = ledger.reduce((s: number, e: { change: number; sparePart: { boughtPrice: number } }) => s + Math.abs(e.change) * e.sparePart.boughtPrice, 0);

            const grossProfit = revenue - cogs;
            const margin = revenue > 0 ? ((grossProfit / revenue) * 100).toFixed(1) : '0';

            data = { revenue, cogs, grossProfit, margin: parseFloat(margin), jobCount: finalized.length, range, period: params.period };

            const periodLabel = params.period === 'today' ? 'today' : params.period === 'this_week' ? 'this week' : 'this month';
            parsed.response = `For ${periodLabel}${params.category ? ` (${params.category.replace(/_/g, ' ').toLowerCase()})` : ''}: revenue is LKR ${revenue.toLocaleString()}, gross profit is LKR ${grossProfit.toLocaleString()} (${margin}% margin) from ${finalized.length} finalized job${finalized.length !== 1 ? 's' : ''}.`;
        }

        res.json({
            transcript,
            response: parsed.response,
            intent,
            params,
            data,
        });

    } catch (error) {
        console.error('[Voice Query]', error);
        res.status(500).json({
            error: 'Voice query failed',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    } finally {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try { fs.unlinkSync(tempFilePath); } catch { /* ignore */ }
        }
    }
});

export default router;
