// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const cors = require('cors');

// Load environment variables
dotenv.config();

if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
    process.exit(1);
}

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

// Import routes
const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/orders');
const userRoutes = require('./routes/users'); // Add user routes

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/users', userRoutes); // Use user routes

// Serve the frontend pages. This is registered before express.static so it
// takes priority over public/index.html (leftover placeholder marketing
// content) and actually sends visitors to the staff portal.
app.get('/', (req, res) => {
    res.redirect('/work');
});

app.use(express.static(path.join(__dirname, 'public')));

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

// Socket.io for real-time communication.
// All order/user mutations happen over the authenticated REST API (see
// routes/orders.js and routes/users.js), which then broadcasts over these
// sockets - the sockets here are read-only fan-out, not a second write path.
io.on('connection', (socket) => {
    console.log('New client connected');

    // Join a room based on role. Requires a valid JWT whose role matches the
    // room being requested, so a socket can't eavesdrop on rooms (e.g. 'admin')
    // it isn't authorized for without ever logging in.
    socket.on('join', ({ role, token } = {}) => {
        if (!token) {
            console.log('Socket join rejected: no token provided');
            return;
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            if (decoded.role !== role) {
                console.log(`Socket join rejected: token role "${decoded.role}" does not match requested room "${role}"`);
                return;
            }

            socket.join(decoded.role);
            console.log(`Socket joined ${decoded.role} room`);
        } catch (err) {
            console.log('Socket join rejected: invalid token');
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

            console.log('Initial admin user created successfully. Default login: admin / admin123 - change this password after first login.');
        } else {
            console.log('Admin user(s) already exist, skipping initial admin creation.');
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