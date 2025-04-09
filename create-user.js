// create-user.js
const mongoose = require('mongoose');
const User = require('./models/User');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

const createUsers = async () => {
    try {
        // Delete existing users
        await User.deleteMany({});
        
        // Create waiter user
        const waiter = new User({
            name: 'Test Waiter',
            accessCode: 'waiter123',
            role: 'waiter'
        });
        
        // Create bartender user
        const bartender = new User({
            name: 'Test Bartender',
            accessCode: 'bar123',
            role: 'bartender'
        });
        
        // Create admin user
        const admin = new User({
            name: 'Admin User',
            accessCode: 'admin123',
            role: 'admin'
        });
        
        await waiter.save();
        await bartender.save();
        await admin.save();
        
        console.log('Users created successfully');
        process.exit();
    } catch (err) {
        console.error('Error creating users:', err);
        process.exit(1);
    }
};

createUsers();