// models/Order.js
const { DataTypes } = require('sequelize');
const sequelize = require('./db');
const User = require('./User');

const Order = sequelize.define('Order', {
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
    number: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        allowNull: false
    },
    table: {
        type: DataTypes.STRING,
        allowNull: false
    },
    items: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
    },
    status: {
        type: DataTypes.ENUM('pending', 'in-progress', 'completed', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending'
    },
    createdBy: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: User,
            key: 'id'
        }
    },
    completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null
    },
    completedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: User,
            key: 'id'
        }
    }
}, {
    timestamps: true
});

Order.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

// Turn a fetched order into the API shape the frontend expects:
// _id instead of id, and createdBy as a populated { _id, name, username } object
// when the 'creator' association was included, otherwise left as the raw id.
Order.present = function (order) {
    const o = order.toJSON();
    if (o.creator) {
        o.createdBy = {
            _id: o.createdBy,
            name: o.creator.name,
            username: o.creator.username
        };
        delete o.creator;
    }
    return o;
};

module.exports = Order;
