// routes/orders.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
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

// Treat a malformed id (not a valid UUID) as "not found" rather than a 500
const notFoundOnBadId = (err, res) => {
    if (err.name === 'SequelizeDatabaseError') {
        return res.status(404).json({ msg: 'Order not found' });
    }
    return null;
};

// @route   POST /api/orders
// @desc    Create a new order
// @access  Private (waiter only)
router.post('/', auth, async (req, res) => {
    try {
        console.log('Order being created by user:', req.user.id);

        const order = await Order.create({
            table: req.body.table,
            items: req.body.items,
            status: 'pending',
            createdBy: req.user.id
        });

        // Get the populated order to return
        const populatedOrder = await Order.findByPk(order.id, {
            include: [{ model: User, as: 'creator', attributes: ['name', 'username'] }]
        });

        console.log('Created order with creator:', populatedOrder.creator);

        // Emit socket event
        if (req.app.io) {
            req.app.io.to('bartender').emit('order_received', Order.present(populatedOrder));
        }

        res.json(Order.present(populatedOrder));
    } catch (err) {
        console.error('Error creating order:', err);
        res.status(500).send('Server Error');
    }
});


// @route   GET /api/orders
// @desc    Get all orders (with optional filters)
// @access  Private
router.get('/', auth, async (req, res) => {
    try {
        // Build query object
        const where = {};

        // Filter by status if provided
        if (req.query.status) {
            // Handle comma-separated status values
            if (req.query.status.includes(',')) {
                where.status = { [Op.in]: req.query.status.split(',') };
            } else {
                where.status = req.query.status;
            }
        }

        // Add role-based restrictions
        if (req.user.role === 'waiter') {
            // Waiters can only see their own orders
            where.createdBy = req.user.id;
        } else if (req.user.role === 'bartender') {
            // If no status filter provided, show pending and recently completed
            if (!req.query.status) {
                where.status = { [Op.in]: ['pending', 'completed'] };
            }
        }

        console.log('Orders query:', where);

        // Get orders with populated creator information
        const orders = await Order.findAll({
            where,
            include: [{ model: User, as: 'creator', attributes: ['name', 'username'] }],
            order: [['createdAt', 'DESC']],
            limit: 100
        });

        const result = orders.map(Order.present);

        // Debug log to see if populate is working
        if (result.length > 0) {
            console.log('First order createdBy:', result[0].createdBy);
        }

        res.json(result);
    } catch (err) {
        console.error('Error fetching orders:', err);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/orders/clear/:period
// @desc    Clear completed orders older than or all completed orders
// @access  Private (admin only)
router.delete('/clear/:period', auth, adminOnly, async (req, res) => {
    try {
        const { period } = req.params;

        // Build the base query - always target completed orders
        const where = { status: 'completed' };

        // Only add date filtering if not 'all'
        if (period !== 'all') {
            const daysAgo = parseInt(period);
            if (isNaN(daysAgo)) {
                return res.status(400).json({ msg: 'Invalid period provided' });
            }

            const dateThreshold = new Date();
            dateThreshold.setDate(dateThreshold.getDate() - daysAgo);

            // For orders created before the threshold date
            where.createdAt = { [Op.lt]: dateThreshold };

            console.log(`Admin ${req.user.id} is clearing completed orders older than ${daysAgo} days`);
            console.log('Date threshold:', dateThreshold);
        } else {
            console.log(`Admin ${req.user.id} is clearing ALL completed orders`);
        }

        // Count all completed orders for reference
        const totalCompleted = await Order.count({ where: { status: 'completed' } });
        console.log(`Total completed orders in system: ${totalCompleted}`);

        // Count matching orders
        const matchCount = await Order.count({ where });
        console.log(`Found ${matchCount} orders matching the deletion query`);

        // Only proceed with deletion if we have matches
        if (matchCount === 0) {
            return res.json({
                success: true,
                count: 0,
                message: 'No orders found matching the criteria'
            });
        }

        // Delete the orders
        const deletedCount = await Order.destroy({ where });

        console.log(`Deleted ${deletedCount} completed orders`);

        res.json({
            success: true,
            count: deletedCount,
            message: `Successfully deleted ${deletedCount} completed orders`
        });
    } catch (err) {
        console.error('Error clearing orders:', err);
        res.status(500).json({ msg: 'Server error', error: err.message });
    }
});

// @route   GET /api/orders/:id
// @desc    Get order by ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
    try {
        const order = await Order.findByPk(req.params.id, {
            include: [{ model: User, as: 'creator', attributes: ['name', 'username'] }]
        });

        if (!order) {
            return res.status(404).json({ msg: 'Order not found' });
        }

        // Check if user has access to this order (for waiters)
        if (req.user.role === 'waiter' && order.createdBy !== req.user.id) {
            return res.status(403).json({ msg: 'Not authorized to view this order' });
        }

        res.json(Order.present(order));
    } catch (err) {
        console.error(err.message);

        if (notFoundOnBadId(err, res)) return;

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
        const order = await Order.findByPk(req.params.id);

        if (!order) {
            return res.status(404).json({ msg: 'Order not found' });
        }

        // Check if waiter is the creator of the order (only applies to waiters)
        if (req.user.role === 'waiter' && order.createdBy !== req.user.id) {
            return res.status(403).json({ msg: 'Not authorized to update this order' });
        }

        // Update order status
        order.status = status;

        // IMPORTANT: If status is completed, set completedAt
        if (status === 'completed') {
            order.completedAt = new Date();
            console.log(`Order ${order.id} marked as completed at ${order.completedAt}`);
        }

        await order.save();

        // For debugging
        if (status === 'completed') {
            console.log(`After save, order has completedAt: ${order.completedAt}`);
        }

        const updatedOrder = Order.present(order);

        // Push the status change out immediately instead of waiting for the next poll
        if (req.app.io) {
            req.app.io.to('waiter').emit('order_status_updated', updatedOrder);
            req.app.io.to('bartender').emit('order_status_updated', updatedOrder);
            req.app.io.to('admin').emit('order_status_updated', updatedOrder);
        }

        res.json(updatedOrder);
    } catch (err) {
        console.error('Error updating order status:', err.message);

        if (notFoundOnBadId(err, res)) return;

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
            if (startDate) dateFilter.createdAt[Op.gte] = new Date(startDate);
            if (endDate) {
                // Set endDate to end of day
                const endDateTime = new Date(endDate);
                endDateTime.setHours(23, 59, 59, 999);
                dateFilter.createdAt[Op.lte] = endDateTime;
            }
        }

        // Get total orders
        const totalOrders = await Order.count({ where: dateFilter });

        // Get orders by status
        const pendingOrders = await Order.count({ where: { ...dateFilter, status: 'pending' } });
        const inProgressOrders = await Order.count({ where: { ...dateFilter, status: 'in-progress' } });
        const completedOrders = await Order.count({ where: { ...dateFilter, status: 'completed' } });
        const cancelledOrders = await Order.count({ where: { ...dateFilter, status: 'cancelled' } });

        // Get average completion time
        const completedOrdersWithTime = await Order.findAll({
            where: {
                ...dateFilter,
                status: 'completed',
                completedAt: { [Op.ne]: null }
            }
        });

        let avgCompletionTime = 0;
        if (completedOrdersWithTime.length > 0) {
            const totalTime = completedOrdersWithTime.reduce((acc, order) => {
                return acc + (new Date(order.completedAt) - new Date(order.createdAt));
            }, 0);
            avgCompletionTime = totalTime / completedOrdersWithTime.length / 1000 / 60; // in minutes
        }

        // Get orders by waiter and by table (computed in JS from the matching rows)
        const allMatching = await Order.findAll({ where: dateFilter, attributes: ['createdBy', 'status', 'table', 'createdAt'] });

        const byWaiter = new Map();
        const byTable = new Map();
        const byDay = new Map();

        for (const order of allMatching) {
            // by waiter
            const waiterEntry = byWaiter.get(order.createdBy) || { _id: order.createdBy, count: 0, completed: 0, cancelled: 0 };
            waiterEntry.count += 1;
            if (order.status === 'completed') waiterEntry.completed += 1;
            if (order.status === 'cancelled') waiterEntry.cancelled += 1;
            byWaiter.set(order.createdBy, waiterEntry);

            // by table
            const tableEntry = byTable.get(order.table) || { _id: order.table, count: 0 };
            tableEntry.count += 1;
            byTable.set(order.table, tableEntry);

            // by day
            const day = new Date(order.createdAt).toISOString().slice(0, 10);
            const dayEntry = byDay.get(day) || { _id: day, count: 0, completed: 0, cancelled: 0 };
            dayEntry.count += 1;
            if (order.status === 'completed') dayEntry.completed += 1;
            if (order.status === 'cancelled') dayEntry.cancelled += 1;
            byDay.set(day, dayEntry);
        }

        const ordersByWaiter = Array.from(byWaiter.values());
        const ordersByTable = Array.from(byTable.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
        const ordersByDay = Array.from(byDay.values())
            .sort((a, b) => a._id.localeCompare(b._id));

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
            if (startDate) dateFilter.createdAt[Op.gte] = new Date(startDate);
            if (endDate) {
                // Set endDate to end of day
                const endDateTime = new Date(endDate);
                endDateTime.setHours(23, 59, 59, 999);
                dateFilter.createdAt[Op.lte] = endDateTime;
            }
        }

        const orders = await Order.findAll({ where: dateFilter, attributes: ['items'] });

        const byItem = new Map();
        for (const order of orders) {
            for (const item of (order.items || [])) {
                const entry = byItem.get(item.name) || { _id: item.name, totalQuantity: 0, totalRevenue: 0, itemCount: 0 };
                entry.totalQuantity += item.quantity;
                entry.totalRevenue += item.price * item.quantity;
                entry.itemCount += 1;
                byItem.set(item.name, entry);
            }
        }

        const popularItems = Array.from(byItem.values())
            .sort((a, b) => b.totalQuantity - a.totalQuantity)
            .slice(0, 20);

        res.json(popularItems);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

module.exports = router;
