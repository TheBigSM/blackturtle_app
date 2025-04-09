// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Import Order model for socket.io events
const Order = require('./models/Order');

// Import routes
const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/orders');

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);

// Serve the frontend pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/work', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'work.html'));
});

app.get('/work/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/work/waiter', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'waiter.html'));
});

app.get('/work/bartender', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'bartender.html'));
});

// Socket.io for real-time communication
io.on('connection', (socket) => {
    console.log('New client connected');
    
    // Join a room based on role
    socket.on('join', (role) => {
        socket.join(role);
        console.log(`Socket joined ${role} room`);
    });
    
    // New order event
    socket.on('new_order', async (orderData) => {
        try {
            // Save order to database
            const order = new Order(orderData);
            await order.save();
            
            // Broadcast to all bartenders
            io.to('bartender').emit('order_received', order);
            
            // Acknowledge the order was received
            socket.emit('order_confirmation', { 
                success: true, 
                orderId: order._id 
            });
        } catch (error) {
            console.error('Error saving order:', error);
            socket.emit('order_confirmation', { 
                success: false, 
                error: 'Failed to save order' 
            });
        }
    });
    
    // Order status update
    socket.on('update_order_status', async (data) => {
        try {
            const { orderId, status } = data;
            
            // Update order in database
            const order = await Order.findByIdAndUpdate(
                orderId,
                { status, updatedAt: Date.now() },
                { new: true }
            );
            
            if (!order) {
                return socket.emit('status_update_confirmation', {
                    success: false,
                    error: 'Order not found'
                });
            }
            
            // Broadcast to specific waiter room
            io.to(`waiter_${order.createdBy}`).emit('order_status_changed', {
                orderId: order._id,
                status: order.status,
                table: order.table
            });
            
            // Acknowledge the status was updated
            socket.emit('status_update_confirmation', { 
                success: true 
            });
        } catch (error) {
            console.error('Error updating order:', error);
            socket.emit('status_update_confirmation', { 
                success: false, 
                error: 'Failed to update order' 
            });
        }
    });
    
    // Disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});