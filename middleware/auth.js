const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../database');

function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const token = header.split(' ')[1];

    try {
        const decoded = jwt.verify(token, config.jwtSecret);
        const user = db.getUser(decoded.userId);

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        if (user.is_banned) {
            return res.status(403).json({ error: 'Account is banned' });
        }

        req.user = user;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// Socket.io auth middleware
function socketAuth(socket, next) {
    const token = socket.handshake.auth?.token;
    if (!token) {
        return next(new Error('No token'));
    }

    try {
        const decoded = jwt.verify(token, config.jwtSecret);
        const user = db.getUser(decoded.userId);
        if (!user) return next(new Error('User not found'));
        if (user.is_banned) return next(new Error('Banned'));

        socket.userId = user.id;
        socket.user = user;
        next();
    } catch (err) {
        next(new Error('Invalid token'));
    }
}

module.exports = { authMiddleware, socketAuth };
