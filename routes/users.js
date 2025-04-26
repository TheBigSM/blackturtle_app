const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Middleware to authenticate JWT
const auth = (req, res, next) => {
    const token = req.header('x-auth-token');
    
    if (!token) {
        return res.status(401).json({ msg: 'No token, authorization denied' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ msg: 'Token is not valid' });
    }
};

// Admin-only middleware
const adminOnly = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ msg: 'Authentication required' });
    }
    
    if (req.user.role !== 'admin') {
        return res.status(403).json({ msg: 'Admin access required' });
    }
    next();
};

// IMPORTANT: Define all non-ID routes BEFORE the ID routes!

// @route   GET /api/users/stats
// @desc    Get user statistics
// @access  Private (admin only)
router.get('/stats', auth, adminOnly, async (req, res) => {
    try {
        // Get counts by role
        const adminCount = await User.countDocuments({ role: 'admin' });
        const waiterCount = await User.countDocuments({ role: 'waiter' });
        const bartenderCount = await User.countDocuments({ role: 'bartender' });
        
        // Get active vs inactive counts
        const activeCount = await User.countDocuments({ active: true });
        const inactiveCount = await User.countDocuments({ active: false });
        
        // Get recently created users
        const recentUsers = await User.find()
            .select('-password -accessCode')
            .sort({ createdAt: -1 })
            .limit(5);
        
        res.json({
            totalUsers: adminCount + waiterCount + bartenderCount,
            byRole: {
                admin: adminCount,
                waiter: waiterCount,
                bartender: bartenderCount
            },
            byStatus: {
                active: activeCount,
                inactive: inactiveCount
            },
            recentUsers
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// @route   GET /api/users
// @desc    Get all users
// @access  Private (admin only)
router.get('/', auth, adminOnly, async (req, res) => {
    try {
        const users = await User.find()
            .select('-password -accessCode')
            .sort({ createdAt: -1 });
            
        res.json(users);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// @route   GET /api/users/names
// @desc    Get all user names (minimal info)
// @access  Private (any authenticated user)
router.get('/names', auth, async (req, res) => {
    try {
        // Only return minimal user info (id, name, username)
        const users = await User.find()
            .select('name username')
            .sort({ name: 1 });
            
        // Map to a simple format with just what's needed
        const userNames = users.map(user => ({
            _id: user._id,
            name: user.name || user.username
        }));
        
        res.json(userNames);
    } catch (err) {
        console.error('Error getting user names:', err.message);
        res.status(500).send('Server error');
    }
});

// NOW DEFINE ID-BASED ROUTES

// @route   GET /api/users/:id
// @desc    Get user by ID
// @access  Private (admin only)
router.get('/:id', auth, adminOnly, async (req, res) => {
    try {
        const user = await User.findById(req.params.id)
            .select('-password -accessCode');
        
        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }
        
        res.json(user);
    } catch (err) {
        console.error(err.message);
        
        if (err.kind === 'ObjectId') {
            return res.status(404).json({ msg: 'User not found' });
        }
        
        res.status(500).send('Server error');
    }
});

// @route   PUT /api/users/:id/status
// @desc    Update user active status
// @access  Private (admin only)
router.put('/:id/status', auth, adminOnly, async (req, res) => {
    try {
        const { active } = req.body;
        
        console.log(`Updating status for user ${req.params.id}: active=${active}`);
        
        if (typeof active !== 'boolean') {
            return res.status(400).json({ msg: 'Please provide active status (true/false)' });
        }
        
        // First check if user exists
        const user = await User.findById(req.params.id);
        
        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }
        
        // Get ID of logged-in admin from the token
        const adminId = req.user.id;
        console.log(`Admin ${adminId} is trying to update status of user ${user._id} (${user.username})`);
        
        // Only check for last admin if we're deactivating an admin
        if (user.role === 'admin' && active === false) {
            // Count active admins excluding the one we're trying to update
            const activeAdminsCount = await User.countDocuments({ 
                role: 'admin', 
                active: true,
                _id: { $ne: user._id }
            });
            
            console.log(`Found ${activeAdminsCount} other active admins`);
            
            if (activeAdminsCount === 0) {
                return res.status(400).json({ 
                    msg: 'Cannot deactivate the last admin user' 
                });
            }
        }
        
        // Update status
        user.active = active;
        await user.save();
        console.log(`User ${user.username} status updated to: active=${active}`);
        
        // Return user without password
        const updatedUser = await User.findById(user._id).select('-password -accessCode');
        
        res.json(updatedUser);
    } catch (err) {
        console.error('Error updating user status:', err);
        
        if (err.kind === 'ObjectId') {
            return res.status(404).json({ msg: 'User not found' });
        }
        
        res.status(500).json({ msg: 'Server error', error: err.message });
    }
});


// @route   DELETE /api/users/:id
// @desc    Delete a user
// @access  Private (admin only)
router.delete('/:id', auth, adminOnly, async (req, res) => {
    try {
        // Get ID of logged-in admin from the token
        const adminId = req.user.id;
        console.log(`Admin ${adminId} is attempting to delete user ${req.params.id}`);
        
        // Find the user
        const user = await User.findById(req.params.id);
        
        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }
        
        console.log(`Found user ${user.username} with role ${user.role}`);
        
        // Don't allow deleting the last admin
        if (user.role === 'admin') {
            // Count total admin users
            const adminCount = await User.countDocuments({ role: 'admin' });
            console.log(`Total admin count: ${adminCount}`);
            
            if (adminCount <= 1) {
                return res.status(400).json({ 
                    msg: 'Cannot delete the last admin user' 
                });
            }
        }
        
        // Delete the user
        await User.findByIdAndDelete(req.params.id);
        console.log(`User ${user.username} (${user._id}) deleted successfully`);
        
        res.json({ msg: 'User deleted successfully' });
    } catch (err) {
        console.error('Error deleting user:', err);
        
        if (err.kind === 'ObjectId') {
            return res.status(404).json({ msg: 'User not found' });
        }
        
        res.status(500).json({ msg: 'Server error', error: err.message });
    }
});

// @route   POST /api/users
// @desc    Create a new user
// @access  Private (admin only)
router.post('/', auth, adminOnly, async (req, res) => {
    try {
        const { name, username, password, role } = req.body;
        
        // Validate input
        if (!name || !username || !password || !role) {
            return res.status(400).json({ msg: 'Please provide all required fields' });
        }
        
        // Check if role is valid
        if (!['admin', 'waiter', 'bartender'].includes(role)) {
            return res.status(400).json({ msg: 'Invalid role' });
        }
        
        // Check if username already exists
        let user = await User.findOne({ username });
        if (user) {
            return res.status(400).json({ msg: 'Username already exists' });
        }
        
        // Create new user
        user = new User({
            name,
            username,
            password,
            role
        });
        
        // If user is bartender, generate an access code
        if (role === 'bartender') {
            // Generate a random 4-digit access code
            const accessCode = Math.floor(1000 + Math.random() * 9000).toString();
            user.accessCode = accessCode;
        }
        
        // Save user
        await user.save();
        
        // Return user without password
        const newUser = await User.findById(user._id).select('-password -accessCode');
        
        res.json(newUser);
    } catch (err) {
        console.error('User creation error:', err.message);
        res.status(500).send('Server error');
    }
});

module.exports = router;