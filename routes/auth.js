// routes/auth.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// @route   POST /api/auth/login
// @desc    Authenticate user with username/password & get token
// @access  Public
router.post('/login', async (req, res) => {
    try {
        const { username, password, accessCode, role } = req.body;
        
        // Debug log - what credentials are coming in
        console.log('Login attempt:', { 
            username, 
            role, 
            hasPassword: !!password, 
            hasAccessCode: !!accessCode 
        });
        
        let user;
        
        // For bartender role using access code
        if (role === 'bartender' && accessCode) {
            user = await User.findOne({ role: 'bartender' });
            
            // Debug - bartender found?
            console.log('Bartender login:', { found: !!user, userId: user?._id });
            
            if (!user || !(await user.checkAccessCode(accessCode))) {
                // Debug - access code valid?
                console.log('Access code check failed');
                return res.status(400).json({ msg: 'Invalid credentials' });
            }
        } 
        // For other roles using username/password
        else if (username && password) {
            user = await User.findOne({ username });
            
            // Debug - user found?
            console.log('Username login:', { 
                found: !!user, 
                userId: user?._id,
                requestedRole: role,
                actualRole: user?.role
            });
            
            // Check if user exists and password is correct
            if (!user || !(await user.checkPassword(password))) {
                // Debug - which check failed?
                console.log('Login failed:', { 
                    userExists: !!user, 
                    passwordCheck: user ? 'failed' : 'not attempted'
                });
                return res.status(400).json({ msg: 'Invalid credentials' });
            }
            
            // Check if role matches (if role is specified)
            if (role && user.role !== role) {
                console.log('Role mismatch:', { requested: role, actual: user.role });
                return res.status(401).json({ msg: 'Unauthorized for this role' });
            }
        } else {
            // Debug - missing credentials
            console.log('Missing credentials');
            return res.status(400).json({ msg: 'Please provide valid credentials' });
        }
        
        // Create JWT token
        const payload = {
            id: user.id,
            role: user.role
        };
        
        // Sign token
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
        
        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ msg: 'Server error' });
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
            const user = await User.findById(decoded.user.id).select('-password -accessCode');
            
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