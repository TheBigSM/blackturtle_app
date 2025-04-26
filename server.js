// server.js
const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const fs = require('fs');

// Load environment variables
dotenv.config();

const DOMAIN = process.env.DOMAIN;
const PORT = process.env.PORT;
const BASE_URL = `https://${DOMAIN}:${PORT}`;

// HTTPS options
const httpsOptions = {
    key: fs.readFileSync(path.join(__dirname, 'certs/privkey.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'certs/fullchain.pem'))
};

// Initialize Express app
const app = express();
const server = https.createServer(httpsOptions, app); 
const io = socketIo(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
});

// Enable CORS for REST endpoints
app.use(cors());

app.use((req, res, next) => {
    const originalSend = res.send;
    
    res.send = function(body) {
      if (typeof body === 'string') {
        body = body.replace(/{{DOMAIN}}/gi, DOMAIN);
        body = body.replace(/{{PORT}}/gi, PORT);
        body = body.replace(/{{BASE_URL}}/gi, BASE_URL);
      }
      return originalSend.call(this, body);
    };
    
    next();
});

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
const userRoutes = require('./routes/users'); // Add user routes

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/users', userRoutes); // Use user routes

// Serve the frontend pages
app.get('/', (req, res) => {
    res.redirect('/work');
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

app.get('/work/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Add a config endpoint to provide environment variables to the frontend
app.get('/config.js', (req, res) => {
    res.set('Content-Type', 'application/javascript');
    res.send(`
        // App configuration from server environment
        const CONFIG = {
            domain: "${DOMAIN}",
            port: "${PORT}",
            baseUrl: "${BASE_URL}"
        };
        console.log('Config loaded from server:', CONFIG);
    `);
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
            
            // Broadcast to admins
            io.to('admin').emit('order_received', order);
            
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
            
            // Broadcast to all waiters
            io.to('waiter').emit('order_status_changed', {
                orderId: order._id,
                status: order.status,
                table: order.table
            });
            
            // Broadcast to admins
            io.to('admin').emit('order_status_changed', {
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
    
    // User update event
    socket.on('user_updated', async (userData) => {
        try {
            // Broadcast to admins
            io.to('admin').emit('user_updated', userData);
        } catch (error) {
            console.error('Error broadcasting user update:', error);
        }
    });
    
    // Disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Create an initial admin user if none exists
const User = require('./models/User');

async function createInitialAdmin() {
    console.log('Starting admin user creation check...');
    try {
        const adminCount = await User.countDocuments({ role: 'admin' });
        console.log(`Found ${adminCount} admin users in database`);
        
        if (adminCount === 0) {
            console.log('No admin users found. Creating initial admin user...');
            
            const adminUser = new User({
                name: 'Admin User',
                username: 'admin',
                password: 'admin123',
                role: 'admin'
            });
            
            await adminUser.save();
            console.log('Initial admin user created successfully.');
        } else {
            // Reset admin password to ensure it's correct
            console.log('Looking for admin user to reset password...');
            const adminUser = await User.findOne({ username: 'admin', role: 'admin' });
            
            if (adminUser) {
                console.log(`Found admin user with ID: ${adminUser._id}`);
                // This will trigger the pre-save hook to hash the password
                adminUser.password = 'admin123';
                await adminUser.save();
                console.log('Admin password reset successfully.');
            } else {
                console.log('Admin role exists but no user with username "admin" found');
            }
        }
    } catch (error) {
        console.error('Error creating/updating admin user:', error);
    }
    console.log('Admin user setup complete');
}

// Update the health check route to include the new DELETE endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'API server is running',
        time: new Date().toISOString(),
        routes: {
            auth: ['/api/auth/login', '/api/auth/me'],
            users: [
                '/api/users', 
                '/api/users/:id', 
                '/api/users/:id/status', 
                '/api/users/stats',
                'DELETE /api/users/:id'
            ],
            orders: [
                '/api/orders', 
                '/api/orders/:id', 
                '/api/orders/:id/status', 
                '/api/orders/stats/summary'
            ]
        }
    });
});

// Start server
server.listen(PORT, '0.0.0.0', async () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`DOMAIN: ${DOMAIN}`);
    
    try {
        console.log('Initializing admin user...');
        await createInitialAdmin();
        console.log('Admin user initialization complete');
    } catch (err) {
        console.error('Failed to initialize admin user:', err);
    }
});