// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const dotenv = require('dotenv');
const cors = require('cors');

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
});
app.io = io;

// Trust the host's reverse proxy so req.protocol reflects the original https request
app.set('trust proxy', 1);

// Enable CORS for REST endpoints
app.use(cors());

// Connect to the database
const sequelize = require('./models/db');

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

// Add a config endpoint to provide the frontend with the origin it's running on
app.get('/config.js', (req, res) => {
    res.set('Content-Type', 'application/javascript');
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.send(`
        // App configuration from server environment
        const CONFIG = {
            baseUrl: "${baseUrl}"
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
            const order = await Order.create(orderData);

            // Broadcast to all bartenders
            io.to('bartender').emit('order_received', Order.present(order));

            // Broadcast to admins
            io.to('admin').emit('order_received', Order.present(order));

            // Acknowledge the order was received
            socket.emit('order_confirmation', {
                success: true,
                orderId: order.id
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
            const order = await Order.findByPk(orderId);

            if (!order) {
                return socket.emit('status_update_confirmation', {
                    success: false,
                    error: 'Order not found'
                });
            }

            order.status = status;
            await order.save();

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
        const adminCount = await User.count({ where: { role: 'admin' } });
        console.log(`Found ${adminCount} admin users in database`);

        if (adminCount === 0) {
            console.log('No admin users found. Creating initial admin user...');

            await User.create({
                name: 'Admin User',
                username: 'admin',
                password: 'admin123',
                role: 'admin'
            });

            console.log('Initial admin user created successfully.');
        } else {
            // Reset admin password to ensure it's correct
            console.log('Looking for admin user to reset password...');
            const adminUser = await User.findOne({ where: { username: 'admin', role: 'admin' } });

            if (adminUser) {
                console.log(`Found admin user with ID: ${adminUser.id}`);
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

// Connect to the database, then start the server once the schema is ready
sequelize.authenticate()
    .then(() => {
        console.log('Database connected');
        return sequelize.sync();
    })
    .then(async () => {
        console.log('Database schema synced');

        console.log('Initializing admin user...');
        await createInitialAdmin();
        console.log('Admin user initialization complete');

        server.listen(PORT, '0.0.0.0', () => {
            console.log(`Server running on port ${PORT}`);
        });
    })
    .catch(err => {
        console.error('Database connection error:', err);
        process.exit(1);
    });