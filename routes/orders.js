// routes/orders.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Order = require('../models/Order');
const User = require('../models/User');

// Middleware to authenticate JWT
const auth = (req, res, next) => {
    const token = req.header('x-auth-token');
    
    if (!token) {
        return res.status(401).json({ msg: 'No token, authorization denied' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        // The decoded token contains id and role directly, not inside a user object
        req.user = decoded;  // <-- CHANGED: use decoded directly, not decoded.user
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
// @route   POST /api/orders
// @desc    Create a new order
// @access  Private (waiter only)
router.post('/', auth, async (req, res) => {
    try {
        // Verify waiter role
        if (req.user.role !== 'waiter') {
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
        const { status, table, waiter, startDate, endDate, limit = 50 } = req.query;
        
        // Build query object
        const queryObj = {};
        
        // Add filters if provided
        if (status) queryObj.status = status;
        if (table) queryObj.table = table;
        if (waiter) queryObj.createdBy = waiter;
        
        // Add date range filter if provided
        if (startDate || endDate) {
            queryObj.createdAt = {};
            if (startDate) queryObj.createdAt.$gte = new Date(startDate);
            if (endDate) {
                // Set endDate to end of day
                const endDateTime = new Date(endDate);
                endDateTime.setHours(23, 59, 59, 999);
                queryObj.createdAt.$lte = endDateTime;
            }
        }
        
        // Add role-based restrictions (admin can see all orders)
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
        
        // Fetch orders with user information
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
        
        if (!status) {
            return res.status(400).json({ msg: 'Please provide status' });
        }
        
        // Validate status based on role
        if (req.user.role === 'bartender') {
            if (!['in-progress', 'completed'].includes(status)) {
                return res.status(403).json({ 
                    msg: 'Bartenders can only set orders to in-progress or completed'
                });
            }
        } else if (req.user.role === 'waiter') {
            if (!['cancelled'].includes(status)) {
                return res.status(403).json({ 
                    msg: 'Waiters can only cancel orders'
                });
            }
        } else if (req.user.role === 'admin') {
            // Admin can set any status
            if (!['pending', 'in-progress', 'completed', 'cancelled'].includes(status)) {
                return res.status(400).json({ 
                    msg: 'Invalid status value'
                });
            }
        } else {
            return res.status(403).json({ 
                msg: 'Role not recognized'
            });
        }
        
        // Find order
        const order = await Order.findById(req.params.id);
        
        if (!order) {
            return res.status(404).json({ msg: 'Order not found' });
        }
        
        // Check if waiter is the creator of the order (only applies to waiters)
        if (req.user.role === 'waiter' && order.createdBy.toString() !== req.user.id) {
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
// @desc    Get order statistics summary
// @access  Private (admin only)
router.get('/stats/summary', auth, adminOnly, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        // Build date filter
        const dateFilter = {};
        if (startDate || endDate) {
            dateFilter.createdAt = {};
            if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
            if (endDate) {
                // Set endDate to end of day
                const endDateTime = new Date(endDate);
                endDateTime.setHours(23, 59, 59, 999);
                dateFilter.createdAt.$lte = endDateTime;
            }
        }
        
        // Get total orders
        const totalOrders = await Order.countDocuments(dateFilter);
        
        // Get orders by status
        const pendingOrders = await Order.countDocuments({ ...dateFilter, status: 'pending' });
        const inProgressOrders = await Order.countDocuments({ ...dateFilter, status: 'in-progress' });
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
        
        // Get orders by waiter
        const ordersByWaiter = await Order.aggregate([
            { $match: dateFilter },
            { $group: {
                _id: '$createdBy',
                count: { $sum: 1 },
                completed: { 
                    $sum: { 
                        $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] 
                    } 
                },
                cancelled: { 
                    $sum: { 
                        $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] 
                    } 
                }
            }}
        ]);
        
        // Get orders by table
        const ordersByTable = await Order.aggregate([
            { $match: dateFilter },
            { $group: {
                _id: '$table',
                count: { $sum: 1 }
            }},
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);
        
        // Get orders by day (for chart)
        const ordersByDay = await Order.aggregate([
            { $match: dateFilter },
            {
                $group: {
                    _id: { 
                        $dateToString: { 
                            format: '%Y-%m-%d', 
                            date: '$createdAt' 
                        } 
                    },
                    count: { $sum: 1 },
                    completed: { 
                        $sum: { 
                            $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] 
                        } 
                    },
                    cancelled: { 
                        $sum: { 
                            $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] 
                        } 
                    }
                }
            },
            { $sort: { _id: 1 } }
        ]);
        
        res.json({
            totalOrders,
            pendingOrders,
            inProgressOrders,
            completedOrders,
            cancelledOrders,
            avgCompletionTime: parseFloat(avgCompletionTime.toFixed(2)),
            ordersByWaiter,
            ordersByTable,
            ordersByDay
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// @route   GET /api/orders/popular-items
// @desc    Get popular items statistics
// @access  Private (admin only)
router.get('/popular-items', auth, adminOnly, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        // Build date filter
        const dateFilter = {};
        if (startDate || endDate) {
            dateFilter.createdAt = {};
            if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
            if (endDate) {
                // Set endDate to end of day
                const endDateTime = new Date(endDate);
                endDateTime.setHours(23, 59, 59, 999);
                dateFilter.createdAt.$lte = endDateTime;
            }
        }
        
        // Get popular items
        const popularItems = await Order.aggregate([
            { $match: dateFilter },
            { $unwind: '$items' },
            { $group: {
                _id: '$items.name',
                totalQuantity: { $sum: '$items.quantity' },
                totalRevenue: { 
                    $sum: { 
                        $multiply: ['$items.price', '$items.quantity'] 
                    } 
                },
                itemCount: { $sum: 1 }
            }},
            { $sort: { totalQuantity: -1 } },
            { $limit: 20 }
        ]);
        
        res.json(popularItems);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

module.exports = router;