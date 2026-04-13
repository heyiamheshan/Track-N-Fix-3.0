import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// Setup storage
const uploadsDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${uuidv4()}${ext}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only images allowed'));
    },
});

// POST /api/images/upload - upload images for a job
router.post('/upload', authenticate, upload.array('images', 20), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { jobId, phase, captions } = req.body;
        const files = req.files as Express.Multer.File[];

        if (!files || files.length === 0) {
            res.status(400).json({ error: 'No files uploaded' });
            return;
        }
        if (!jobId || !phase) {
            res.status(400).json({ error: 'jobId and phase are required' });
            return;
        }

        const parsedCaptions: string[] = captions
            ? Array.isArray(captions) ? captions : JSON.parse(captions)
            : [];

        const images = await Promise.all(
            files.map((file, i) =>
                prisma.jobImage.create({
                    data: {
                        jobId,
                        phase: phase as 'BEFORE' | 'AFTER' | 'PART',
                        url: `/uploads/${file.filename}`,
                        caption: parsedCaptions[i] || null,
                    },
                })
            )
        );

        res.status(201).json(images);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// DELETE /api/images/:id - delete an image
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const image = await prisma.jobImage.findUnique({ where: { id: req.params.id } });
        if (!image) { res.status(404).json({ error: 'Image not found' }); return; }

        // Delete file
        const filePath = path.join(uploadsDir, path.basename(image.url));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        await prisma.jobImage.delete({ where: { id: req.params.id } });
        res.json({ message: 'Image deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Delete failed' });
    }
});

export default router;
