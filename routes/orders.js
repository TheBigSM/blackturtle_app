// routes/orders.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Order = require('../models/Order');
const User = require('../models/User');

// Middleware to authenticate JWT
// Middleware to authenticate JWT
const auth = (req, res, next) => {
    const token = req.header('x-auth-token');
    
    if (!token) {
        return res.status(401).json({ msg: 'No token, authorization denied' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        req.user = decoded.user;
        console.log('Authenticated user:', req.user); // Add this for debugging
        next();
    } catch (err) {
        res.status(401).json({ msg: 'Token is not valid' });
    }
};

// @route   POST /api/orders
// @desc    Create a new order
// @access  Private (waiter only)
router.post('/', auth, async (req, res) => {
    try {
        // Debug authentication info
        console.log('POST /api/orders - User info:', {
            id: req.user.id,
            name: req.user.name,
            role: req.user.role,
            isWaiter: req.user.role === 'waiter',
            roleType: typeof req.user.role
        });
        
        // More flexible role check
        const userRole = String(req.user.role).trim().toLowerCase();
        console.log('Normalized role:', userRole);
        
        if (userRole !== 'waiter') {
            console.log('Authorization failed: Expected "waiter", got:', userRole);
            return res.status(403).json({ msg: 'Not authorized - waiter role required' });
        }
        
        const { table, items } = req.body;
        
        // Validate input
        if (!table || !items || items.length === 0) {
            return res.status(400).json({ msg: 'Please provide table number and items' });
        }
        
        // Create new order
        const newOrder = new Order({
            table,
            items,
            createdBy: req.user.id
        });
        
        // Save to database
        const order = await newOrder.save();
        console.log('Order saved successfully:', order._id);
        
        res.json(order);
    } catch (err) {
        console.error('Order creation error:', err);
        res.status(500).json({ msg: 'Server error', error: err.message });
    }
});

// @route   GET /api/orders
// @desc    Get all orders (with optional filters)
// @access  Private
router.get('/', auth, async (req, res) => {
    try {
        const { status, table, limit = 50 } = req.query;
        
        // Build query object
        const queryObj = {};
        
        // Add filters if provided
        if (status) queryObj.status = status;
        if (table) queryObj.table = table;
        
        // Add role-based restrictions
        if (req.user.role === 'waiter') {
            queryObj.createdBy = req.user.id;
        } else if (req.user.role === 'bartender') {
            // Bartenders can only see pending and completed orders
            if (queryObj.status) {
                if (!['pending', 'completed'].includes(queryObj.status)) {
                    return res.status(403).json({ msg: 'Not authorized to view these orders' });
                }
            } else {
                queryObj.status = { $in: ['pending', 'completed'] };
            }
        }
        
        // Fetch orders
        const orders = await Order.find(queryObj)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit));
        
        res.json(orders);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// @route   GET /api/orders/:id
// @desc    Get order by ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        
        if (!order) {
            return res.status(404).json({ msg: 'Order not found' });
        }
        
        // Check if user has access to this order
        if (req.user.role === 'waiter' && order.createdBy.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'Not authorized to view this order' });
        }
        
        res.json(order);
    } catch (err) {
        console.error(err.message);
        
        if (err.kind === 'ObjectId') {
            return res.status(404).json({ msg: 'Order not found' });
        }
        
        res.status(500).send('Server error');
    }
});

// @route   PUT /api/orders/:id/status
// @desc    Update order status
// @access  Private
router.put('/:id/status', auth, async (req, res) => {
    try {
        const { status } = req.body;
        
        // Debug authentication info
        console.log('PUT /api/orders/:id/status - User info:', {
            id: req.user.id,
            name: req.user.name,
            role: req.user.role,
            requestedStatus: status
        });
        
        if (!status) {
            return res.status(400).json({ msg: 'Please provide status' });
        }
        
        // Normalize role for comparison (to handle case sensitivity or whitespace)
        const userRole = String(req.user.role).trim().toLowerCase();
        
        // Validate status based on normalized role
        if (userRole === 'bartender') {
            if (!['in-progress', 'completed'].includes(status)) {
                return res.status(403).json({ 
                    msg: 'Bartenders can only set orders to in-progress or completed',
                    debug: { role: userRole, status }
                });
            }
        } else if (userRole === 'waiter') {
            if (!['cancelled'].includes(status)) {
                return res.status(403).json({ 
                    msg: 'Waiters can only cancel orders',
                    debug: { role: userRole, status }
                });
            }
        } else {
            console.log('Unknown role:', userRole);
            return res.status(403).json({ 
                msg: 'Role not recognized',
                debug: { role: userRole, status }
            });
        }
        
        // Find order
        const order = await Order.findById(req.params.id);
        
        if (!order) {
            return res.status(404).json({ msg: 'Order not found' });
        }
        
        // Check if waiter is the creator of the order (only applies to waiters)
        if (userRole === 'waiter' && order.createdBy.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'Not authorized to update this order' });
        }
        
        // Update order status
        order.status = status;
        order.updatedAt = Date.now();
        
        // If status is completed, set completedAt
        if (status === 'completed') {
            order.completedAt = Date.now();
        }
        
        await order.save();
        console.log(`Order ${order._id} status updated to ${status} by ${userRole}`);
        
        res.json(order);
    } catch (err) {
        console.error('Error updating order status:', err.message);
        
        if (err.kind === 'ObjectId') {
            return res.status(404).json({ msg: 'Order not found' });
        }
        
        res.status(500).json({ msg: 'Server error', error: err.message });
    }
});

// @route   GET /api/orders/stats/summary
// @desc    Get order statistics
// @access  Private (admin only)
router.get('/stats/summary', auth, async (req, res) => {
    try {
        // Only admins can access stats
        if (req.user.role !== 'admin') {
            return res.status(403).json({ msg: 'Not authorized' });
        }
        
        const { startDate, endDate } = req.query;
        
        // Build date filter
        const dateFilter = {};
        if (startDate) {
            dateFilter.createdAt = { $gte: new Date(startDate) };
        }
        if (endDate) {
            if (!dateFilter.createdAt) dateFilter.createdAt = {};
            dateFilter.createdAt.$lte = new Date(endDate);
        }
        
        // Get total orders
        const totalOrders = await Order.countDocuments(dateFilter);
        
        // Get orders by status
        const pendingOrders = await Order.countDocuments({ ...dateFilter, status: 'pending' });
        const completedOrders = await Order.countDocuments({ ...dateFilter, status: 'completed' });
        const cancelledOrders = await Order.countDocuments({ ...dateFilter, status: 'cancelled' });
        
        // Get average completion time
        const completedOrdersWithTime = await Order.find({
            ...dateFilter,
            status: 'completed',
            completedAt: { $exists: true }
        });
        
        let avgCompletionTime = 0;
        if (completedOrdersWithTime.length > 0) {
            const totalTime = completedOrdersWithTime.reduce((acc, order) => {
                return acc + (order.completedAt - order.createdAt);
            }, 0);
            avgCompletionTime = totalTime / completedOrdersWithTime.length / 1000 / 60; // in minutes
        }
        
        res.json({
            totalOrders,
            pendingOrders,
            completedOrders,
            cancelledOrders,
            avgCompletionTime: parseFloat(avgCompletionTime.toFixed(2))
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

module.exports = router;