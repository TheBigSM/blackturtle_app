// create-user.js
// Seeds a test waiter, bartender and admin user. Run with: node create-user.js
const dotenv = require('dotenv');
dotenv.config();

const sequelize = require('./models/db');
const User = require('./models/User');

const createUsers = async () => {
    try {
        await sequelize.sync();
        await User.destroy({ where: {}, truncate: true });

        await User.create({
            name: 'Test Waiter',
            username: 'waiter',
            password: 'waiter123',
            role: 'waiter'
        });

        await User.create({
            name: 'Test Bartender',
            username: 'bartender',
            password: 'bar123',
            role: 'bartender'
        });

        await User.create({
            name: 'Admin User',
            username: 'admin',
            password: 'admin123',
            role: 'admin'
        });

        console.log('Users created successfully');
        process.exit();
    } catch (err) {
        console.error('Error creating users:', err);
        process.exit(1);
    }
};

createUsers();
