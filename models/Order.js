// models/Order.js
const mongoose = require('mongoose');

const OrderItemSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    price: {
        type: Number,
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 1
    },
    comment: {
        type: String,
        default: ''
    }
});

const OrderSchema = new mongoose.Schema({
    number: {
        type: Number,
        required: true
    },
    table: {
        type: String,
        required: true
    },
    items: [OrderItemSchema],
    status: {
        type: String,
        required: true,
        enum: ['pending', 'in-progress', 'completed', 'cancelled'],
        default: 'pending'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    completedAt: {
        type: Date,
        default: null
    }
}, { timestamps: true });

// Auto-increment order number
OrderSchema.pre('validate', async function(next) {
    if (this.isNew && !this.number) {
        try {
            const lastOrder = await this.constructor.findOne({}, {}, { sort: { 'number': -1 } });
            this.number = lastOrder ? lastOrder.number + 1 : 1;
            next();
        } catch (error) {
            next(error);
        }
    } else {
        next();
    }
});

module.exports = mongoose.model('Order', OrderSchema);