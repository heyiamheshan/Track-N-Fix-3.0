/**
 * auth.ts — Authentication & Authorization Middleware
 *
 * Provides two reusable Express middleware functions:
 *
 *  1. `authenticate`  – Verifies the JWT bearer token on every protected route.
 *                       Attaches the decoded user payload to `req.user`.
 *
 *  2. `requireRole`   – Guards routes to specific roles (ADMIN, MANAGER, EMPLOYEE).
 *                       Must be chained AFTER `authenticate`.
 *
 * Usage example:
 *   router.get('/admin-only', authenticate, requireRole('ADMIN'), handler);
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

/**
 * Extends the Express Request interface to carry the authenticated user's
 * identity after the JWT has been verified by `authenticate`.
 */
export interface AuthRequest extends Request {
    user?: {
        id: string;
        role: string;
        email: string;
    };
}

/**
 * authenticate
 *
 * Reads the `Authorization: Bearer <token>` header, verifies the JWT signature
 * against JWT_SECRET, and attaches the decoded payload to `req.user`.
 *
 * Responds with 401 if the token is missing or invalid, so downstream handlers
 * can safely assume `req.user` is populated.
 */
export const authenticate = (req: AuthRequest, res: Response, next: NextFunction): void => {
    // Extract token from the Authorization header (strip "Bearer " prefix)
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
        res.status(401).json({ error: 'No token provided' });
        return;
    }

    try {
        // Verify signature and decode the payload
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as {
            id: string;
            role: string;
            email: string;
        };

        // Attach user identity so route handlers can use req.user
        req.user = decoded;
        next();
    } catch {
        // Token is expired, tampered with, or otherwise invalid
        res.status(401).json({ error: 'Invalid token' });
    }
};

/**
 * requireRole
 *
 * Factory that returns an Express middleware restricting access to one or
 * more roles.  Pass any number of allowed roles as arguments.
 *
 * @param roles - One or more role strings (e.g. 'ADMIN', 'MANAGER')
 *
 * Example:
 *   requireRole('ADMIN', 'MANAGER')  // allows both roles
 *   requireRole('EMPLOYEE')          // employees only
 */
export const requireRole = (...roles: string[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction): void => {
        // Block request if user is not authenticated or their role is not in the allowed list
        if (!req.user || !roles.includes(req.user.role)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        next();
    };
};
