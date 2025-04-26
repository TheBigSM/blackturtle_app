// migrate-users.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
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

// Define the User schema (old version)
const OldUserSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    accessCode: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['admin', 'waiter', 'bartender'],
        required: true
    },
    active: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Define the User schema (new version)
const NewUserSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    username: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    accessCode: {
        type: String
    },
    role: {
        type: String,
        enum: ['admin', 'waiter', 'bartender'],
        required: true
    },
    active: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Create models
const OldUser = mongoose.model('User', OldUserSchema, 'users');
const NewUserModel = mongoose.model('NewUser', NewUserSchema, 'users_new');

// Migration function
async function migrateUsers() {
    try {
        // Get all users from old collection
        const oldUsers = await OldUser.find();
        
        console.log(`Found ${oldUsers.length} users to migrate`);
        
        // Create an admin user
        const salt = await bcrypt.genSalt(10);
        const adminPassword = await bcrypt.hash('admin123', salt);
        
        const adminUser = new NewUserModel({
            name: 'Admin User',
            username: 'admin',
            password: adminPassword,
            role: 'admin',
            active: true,
            createdAt: new Date()
        });
        
        await adminUser.save();
        console.log('Admin user created');
        
        // Migrate each user
        for (const oldUser of oldUsers) {
            // Generate username from name
            let username = oldUser.name.toLowerCase().replace(/\s+/g, '.');
            
            // Check if username already exists
            let usernameExists = await NewUserModel.findOne({ username });
            let counter = 1;
            
            // If username exists, append a number
            while (usernameExists) {
                username = `${username}${counter}`;
                usernameExists = await NewUserModel.findOne({ username });
                counter++;
            }
            
            // Create a simple password based on role
            let password = `${oldUser.role}123`;
            
            // Hash the password
            const hashedPassword = await bcrypt.hash(password, salt);
            
            // Create new user
            const newUser = new NewUserModel({
                name: oldUser.name,
                username: username,
                password: hashedPassword,
                role: oldUser.role,
                active: oldUser.active,
                createdAt: oldUser.createdAt
            });
            
            // If bartender, keep the access code
            if (oldUser.role === 'bartender') {
                newUser.accessCode = oldUser.accessCode;
            }
            
            await newUser.save();
            console.log(`Migrated user: ${oldUser.name} -> ${username}`);
        }
        
        console.log('Migration completed successfully');
        
        // Print usernames and passwords for reference
        const allUsers = await NewUserModel.find();
        
        console.log('\nUser Credentials:');
        console.log('------------------');
        console.log('Admin User:');
        console.log('Username: admin');
        console.log('Password: admin123');
        console.log('\nMigrated Users:');
        
        for (const user of allUsers) {
            if (user.username !== 'admin') {
                console.log(`${user.name} (${user.role}):`);
                console.log(`Username: ${user.username}`);
                console.log(`Password: ${user.role}123`);
                console.log('------------------');
            }
        }
        
    } catch (error) {
        console.error('Migration error:', error);
    } finally {
        mongoose.disconnect();
    }
}

// Run migration
migrateUsers();