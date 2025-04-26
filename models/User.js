// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
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

// Hash password before saving
UserSchema.pre('save', async function(next) {
    // Only hash if password is modified or it's a new user
    if (!this.isModified('password') && !this.isModified('accessCode')) {
        return next();
    }
    
    try {
        const salt = await bcrypt.genSalt(10);
        
        // Hash password if it exists and was modified
        if (this.isModified('password')) {
            this.password = await bcrypt.hash(this.password, salt);
        }
        
        // Hash accessCode if it exists and was modified
        if (this.accessCode && this.isModified('accessCode')) {
            this.accessCode = await bcrypt.hash(this.accessCode, salt);
        }
        
        next();
    } catch (error) {
        next(error);
    }
});

// Method to check if password is valid
UserSchema.methods.checkPassword = async function(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// Method to check if access code is valid
UserSchema.methods.checkAccessCode = async function(enteredAccessCode) {
    // Handle both password and accessCode authentication methods
    if (this.accessCode) {
        return await bcrypt.compare(enteredAccessCode, this.accessCode);
    } else if (this.password) {
        return await bcrypt.compare(enteredAccessCode, this.password);
    }
    return false;
};

module.exports = mongoose.model('User', UserSchema);