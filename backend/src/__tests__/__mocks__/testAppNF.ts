/**
 * testAppNF.ts — Express app for non-functional tests
 *
 * Identical to testApp.ts but also mounts the attendance route,
 * which is needed for the non-functional security/role checks.
 */

import express from 'express';
import authRoutes       from '../../routes/auth';
import jobRoutes        from '../../routes/jobs';
import quotationRoutes  from '../../routes/quotations';
import vehicleRoutes    from '../../routes/vehicles';
import employeeRoutes   from '../../routes/employees';
import inventoryRoutes  from '../../routes/inventory';
import notificationRoutes from '../../routes/notifications';
import voiceRoutes      from '../../routes/voice';
import analyticsRoutes  from '../../routes/analytics';
import searchRoutes     from '../../routes/search';
import attendanceRoutes from '../../routes/attendance';

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth',          authRoutes);
app.use('/api/jobs',          jobRoutes);
app.use('/api/quotations',    quotationRoutes);
app.use('/api/vehicles',      vehicleRoutes);
app.use('/api/employees',     employeeRoutes);
app.use('/api/inventory',     inventoryRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/voice',         voiceRoutes);
app.use('/api/analytics',     analyticsRoutes);
app.use('/api/search',        searchRoutes);
app.use('/api/attendance',    attendanceRoutes);

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
});

export default app;
