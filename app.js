require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const jwt = require('jsonwebtoken');
const textRoutes = require('./routes/textRoutes');
const authRoutes = require('./routes/authRoutes');

const app = express();

const mongoURI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;

mongoose.connect(mongoURI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('Failed to connect to MongoDB', err));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to verify JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        req.user = null;
        return next();
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            req.user = null;
            return next();
        }
        req.user = user;
        next();
    });
}

app.use(authenticateToken);

// Saved texts are user content, so keep them and the API out of search results.
app.use('/api', (req, res, next) => {
    res.set('X-Robots-Tag', 'noindex');
    next();
});

app.use('/api/texts', textRoutes);
app.use('/api/auth', authRoutes);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

const Text = require('./models/Text');

async function deleteExpiredTexts() {
    try {
        const now = new Date();
        const result = await Text.deleteMany({ expireAt: { $lte: now } });
        if (result.deletedCount > 0) {
            console.log(`${result.deletedCount} expired text(s) deleted`);
        }
    } catch (error) {
        // An unhandled failure here would crash the server.
        console.error('Failed to delete expired texts', error);
    }
}

setInterval(deleteExpiredTexts, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, (error) => {
    if (error) throw error;
    console.log(`Server is running on port ${PORT}`);
});