// models/User.js
const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const sequelize = require('./db');

const User = sequelize.define('User', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    _id: {
        type: DataTypes.VIRTUAL,
        get() {
            return this.id;
        }
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false
    },
    accessCode: {
        type: DataTypes.STRING,
        allowNull: true
    },
    role: {
        type: DataTypes.ENUM('admin', 'waiter', 'bartender'),
        allowNull: false
    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    timestamps: true,
    updatedAt: false,
    hooks: {
        beforeSave: async (user) => {
            const salt = await bcrypt.genSalt(10);

            if (user.changed('password')) {
                user.password = await bcrypt.hash(user.password, salt);
            }

            if (user.accessCode && user.changed('accessCode')) {
                user.accessCode = await bcrypt.hash(user.accessCode, salt);
            }
        }
    }
});

// Method to check if password is valid
User.prototype.checkPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// Method to check if access code is valid
User.prototype.checkAccessCode = async function (enteredAccessCode) {
    if (this.accessCode) {
        return await bcrypt.compare(enteredAccessCode, this.accessCode);
    } else if (this.password) {
        return await bcrypt.compare(enteredAccessCode, this.password);
    }
    return false;
};

module.exports = User;
