// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
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

// Hash access code before saving
UserSchema.pre('save', async function(next) {
    if (!this.isModified('accessCode')) {
        return next();
    }
    
    try {
        const salt = await bcrypt.genSalt(10);
        this.accessCode = await bcrypt.hash(this.accessCode, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Method to check if access code is valid
UserSchema.methods.checkAccessCode = async function(enteredAccessCode) {
    return await bcrypt.compare(enteredAccessCode, this.accessCode);
};

module.exports = mongoose.model('User', UserSchema);