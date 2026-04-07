import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

import authRoutes from './routes/auth';
import jobRoutes from './routes/jobs';
import imageRoutes from './routes/images';
import quotationRoutes from './routes/quotations';
import vehicleRoutes from './routes/vehicles';
import searchRoutes from './routes/search';
import notificationRoutes from './routes/notifications';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
    origin: 'http://localhost:3000',
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

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', message: 'TrackNFix API running', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🚗 TrackNFix API running on http://localhost:${PORT}`);
});

export default app;
