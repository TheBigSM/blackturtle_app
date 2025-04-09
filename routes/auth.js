// routes/auth.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// @route   POST /api/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post('/login', async (req, res) => {
    const { accessCode, role } = req.body;
    
    try {
        // Find user by role
        const user = await User.findOne({ role, active: true });
        
        if (!user) {
            return res.status(400).json({ msg: 'Invalid credentials' });
        }
        
        // Check access code
        const isMatch = await user.checkAccessCode(accessCode);
        
        if (!isMatch) {
            return res.status(400).json({ msg: 'Invalid credentials' });
        }
        
        // Create JWT payload
        const payload = {
            user: {
                id: user.id,
                name: user.name,
                role: user.role
            }
        };
        
        // Sign token
        jwt.sign(
            payload,
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '12h' },
            (err, token) => {
                if (err) throw err;
                res.json({ token });
            }
        );
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', async (req, res) => {
    try {
        // Get user from JWT token
        const token = req.header('x-auth-token');
        
        if (!token) {
            return res.status(401).json({ msg: 'No token, authorization denied' });
        }
        
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
            
            // Find user
            const user = await User.findById(decoded.user.id).select('-accessCode');
            
            if (!user) {
                return res.status(404).json({ msg: 'User not found' });
            }
            
            res.json(user);
        } catch (err) {
            res.status(401).json({ msg: 'Token is not valid' });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

module.exports = router;