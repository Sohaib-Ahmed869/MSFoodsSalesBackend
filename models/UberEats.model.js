const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        default: ''
    },
    price: {
        type: String,
        default: 'N/A'
    },
    category: {
        type: String,
        default: ''
    },
    image_url: {
        type: String,
        default: ''
    },
    available: {
        type: Boolean,
        default: true
    }
}, { _id: false });

const uberEatsDataSchema = new mongoose.Schema({
    url: {
        type: String,
        required: true,
        trim: true
    },
    postal_code: {
        type: String,
        required: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    header: {
        type: String,
        default: ''
    },
    establishment_type: {
        type: String,
        enum: ['restaurant', 'store', 'grocery', 'convenience', 'pharmacy', 'other'],
        default: 'restaurant',
        index: true
    },
    location: {
        type: String,
        default: 'N/A'
    },
    email: {
        type: String,
        default: 'N/A'
    },
    phone: {
        type: String,
        default: 'N/A'
    },
    registration_number: {
        type: String,
        default: 'N/A'
    },
    menu_items: [menuItemSchema],
    menu_items_count: {
        type: Number,
        default: 0
    },
    categories: [{
        type: String,
        trim: true
    }],
    scraped_at: {
        type: Date,
        default: Date.now,
        index: true
    },
    scraped_timestamp: {
        type: Number,
        default: () => Math.floor(Date.now() / 1000)
    },
    scraping_job_id: {
        type: String,
        default: null,
        index: true
    },
    created_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    // Additional metadata for tracking
    source: {
        type: String,
        default: 'ubereats',
        enum: ['ubereats', 'doordash', 'grubhub', 'other']
    },
    rating: {
        type: Number,
        min: 0,
        max: 5,
        default: null
    },
    total_reviews: {
        type: Number,
        default: 0
    },
    delivery_fee: {
        type: String,
        default: 'N/A'
    },
    estimated_delivery_time: {
        type: String,
        default: 'N/A'
    },
    is_active: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true,
    collection: 'UberEatsData'
});

// Indexes for performance
uberEatsDataSchema.index({ postal_code: 1, establishment_type: 1 });
uberEatsDataSchema.index({ scraping_job_id: 1, scraped_at: -1 });
uberEatsDataSchema.index({ name: 'text', header: 'text' });

// Virtual for menu items count
uberEatsDataSchema.virtual('actualMenuItemsCount').get(function () {
    return this.menu_items ? this.menu_items.length : 0;
});

// Pre-save middleware to update menu_items_count
uberEatsDataSchema.pre('save', function (next) {
    if (this.menu_items) {
        this.menu_items_count = this.menu_items.length;
    }
    next();
});

// Static methods
uberEatsDataSchema.statics.findByJobId = function (jobId) {
    return this.find({ scraping_job_id: jobId }).sort({ scraped_at: -1 });
};

uberEatsDataSchema.statics.findByPostalCode = function (postalCode) {
    return this.find({ postal_code: postalCode }).sort({ scraped_at: -1 });
};

uberEatsDataSchema.statics.findByJobPostalCode = function (postalCode, startTime, endTime) {
    const query = { postal_code: postalCode };
    if (startTime && endTime) {
        query.scraped_at = { $gte: startTime, $lte: endTime };
    }
    return this.find(query).sort({ scraped_at: -1 });
};

uberEatsDataSchema.statics.getStatsByJobId = function (jobId) {
    return this.aggregate([
        { $match: { scraping_job_id: jobId } },
        {
            $group: {
                _id: null,
                totalEstablishments: { $sum: 1 },
                restaurants: {
                    $sum: { $cond: [{ $eq: ['$establishment_type', 'restaurant'] }, 1, 0] }
                },
                stores: {
                    $sum: { $cond: [{ $ne: ['$establishment_type', 'restaurant'] }, 1, 0] }
                },
                totalMenuItems: { $sum: '$menu_items_count' },
                avgMenuItemsPerEstablishment: { $avg: '$menu_items_count' },
                categories: { $push: '$categories' }
            }
        }
    ]);
};

uberEatsDataSchema.statics.getStatsByPostalCodeAndTime = function (postalCode, startTime, endTime) {
    const matchQuery = { postal_code: postalCode };
    if (startTime && endTime) {
        matchQuery.scraped_at = { $gte: startTime, $lte: endTime };
    }

    return this.aggregate([
        { $match: matchQuery },
        {
            $group: {
                _id: null,
                totalEstablishments: { $sum: 1 },
                restaurants: {
                    $sum: { $cond: [{ $eq: ['$establishment_type', 'restaurant'] }, 1, 0] }
                },
                stores: {
                    $sum: { $cond: [{ $ne: ['$establishment_type', 'restaurant'] }, 1, 0] }
                },
                totalMenuItems: { $sum: '$menu_items_count' },
                avgMenuItemsPerEstablishment: { $avg: '$menu_items_count' },
                categories: { $push: '$categories' }
            }
        }
    ]);
};

module.exports = mongoose.model('UberEatsData', uberEatsDataSchema);