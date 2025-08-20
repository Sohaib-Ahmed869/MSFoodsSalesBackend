// models/PostalCodeScraping.js
const mongoose = require("mongoose");

const postalCodeScrapingSchema = new mongoose.Schema({
    // Job identification
    jobId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    // Request parameters
    postalCode: {
        type: String,
        required: true,
        index: true
    },
    maxRestaurants: {
        type: Number,
        default: null
    },
    maxMenuItems: {
        type: Number,
        default: null
    },
    visible: {
        type: Boolean,
        default: false
    },

    // LLM Configuration
    llmConfig: {
        provider: {
            type: String,
            enum: ['openai', 'anthropic', 'local'],
            default: null
        },
        apiKey: {
            type: String,
            default: null
        },
        model: {
            type: String,
            default: null
        },
        baseUrl: {
            type: String,
            default: null
        }
    },

    // Job status and progress
    status: {
        type: String,
        enum: ['pending', 'running', 'completed', 'failed', 'stopped'],
        default: 'pending',
        index: true
    },

    // Progress tracking
    progress: {
        establishmentsScraped: {
            type: Number,
            default: 0
        },
        currentEstablishment: {
            type: String,
            default: ""
        },
        currentType: {
            type: String,
            default: ""
        },
        restaurantsFound: {
            type: Number,
            default: 0
        },
        storesFound: {
            type: Number,
            default: 0
        },
        totalMenuItems: {
            type: Number,
            default: 0
        },
        totalProducts: {
            type: Number,
            default: 0
        },
        pagesProcessed: {
            type: Number,
            default: 0
        },
        duplicatesPrevented: {
            type: Number,
            default: 0
        },
        storeDuplicatesPrevented: {
            type: Number,
            default: 0
        },
        llmCategorizationUsed: {
            type: Boolean,
            default: false
        },
        error: {
            type: String,
            default: null
        }
    },

    // Results
    results: {
        success: {
            type: Boolean,
            default: false
        },
        scrapingResults: {
            pagesProcessed: {
                type: Number,
                default: 0
            },
            establishmentsScraped: {
                type: Number,
                default: 0
            },
            restaurantsScraped: {
                type: Number,
                default: 0
            },
            storesScraped: {
                type: Number,
                default: 0
            },
            llmCategorizationUsed: {
                type: Boolean,
                default: false
            }
        },
        categorizationStats: {
            restaurants: {
                count: { type: Number, default: 0 },
                totalMenuItems: { type: Number, default: 0 },
                avgMenuItems: { type: Number, default: 0 },
                categories: { type: Map, of: Number, default: new Map() }
            },
            stores: {
                count: { type: Number, default: 0 },
                totalProducts: { type: Number, default: 0 },
                avgProducts: { type: Number, default: 0 },
                categories: { type: Map, of: Number, default: new Map() }
            },
            totals: {
                establishments: { type: Number, default: 0 },
                totalItems: { type: Number, default: 0 },
                menuItems: { type: Number, default: 0 },
                products: { type: Number, default: 0 }
            },
            categoryDistribution: { type: Map, of: Number, default: new Map() },
            topCategories: [{
                category: String,
                count: Number
            }]
        },
        outputFiles: {
            restaurants: {
                type: String,
                default: null
            },
            stores: {
                type: String,
                default: null
            }
        },
        timing: {
            pageLoadTime: { type: Number, default: 0 },
            searchTime: { type: Number, default: 0 },
            scrapingTime: { type: Number, default: 0 },
            totalTime: { type: Number, default: 0 }
        },
        message: {
            type: String,
            default: null
        },
        error: {
            type: String,
            default: null
        }
    },

    // Metadata
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    // Timestamps
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },

    startedAt: {
        type: Date,
        default: null
    },

    completedAt: {
        type: Date,
        default: null
    },

    updatedAt: {
        type: Date,
        default: Date.now
    },

    // Runtime tracking
    runtimeSeconds: {
        type: Number,
        default: 0
    },

    // Additional metadata
    estimatedTimeRemaining: {
        type: String,
        default: null
    },

    featuresUsed: [{
        type: String
    }],

    // Error details
    errorDetails: {
        code: {
            type: String,
            default: null
        },
        stack: {
            type: String,
            default: null
        },
        timestamp: {
            type: Date,
            default: null
        }
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes for better performance
postalCodeScrapingSchema.index({ postalCode: 1, status: 1 });
postalCodeScrapingSchema.index({ createdBy: 1, createdAt: -1 });
postalCodeScrapingSchema.index({ status: 1, createdAt: -1 });

// Virtual for runtime calculation
postalCodeScrapingSchema.virtual('currentRuntimeMinutes').get(function () {
    if (this.startedAt) {
        const now = this.completedAt || new Date();
        return Math.round((now - this.startedAt) / (1000 * 60));
    }
    return 0;
});

// Methods
postalCodeScrapingSchema.methods.updateProgress = function (progressData) {
    Object.assign(this.progress, progressData);
    this.updatedAt = new Date();
    return this.save();
};

postalCodeScrapingSchema.methods.setResults = function (resultsData) {
    Object.assign(this.results, resultsData);
    this.status = resultsData.success ? 'completed' : 'failed';
    this.completedAt = new Date();
    this.updatedAt = new Date();
    return this.save();
};

postalCodeScrapingSchema.methods.markAsStarted = function () {
    this.status = 'running';
    this.startedAt = new Date();
    this.updatedAt = new Date();
    return this.save();
};

postalCodeScrapingSchema.methods.markAsFailed = function (error) {
    this.status = 'failed';
    this.progress.error = error.message || error;
    this.results.error = error.message || error;
    this.results.success = false;
    this.completedAt = new Date();
    this.updatedAt = new Date();

    if (error.stack) {
        this.errorDetails = {
            code: error.code || 'UNKNOWN_ERROR',
            stack: error.stack,
            timestamp: new Date()
        };
    }

    return this.save();
};

postalCodeScrapingSchema.methods.markAsStopped = function () {
    this.status = 'stopped';
    this.completedAt = new Date();
    this.updatedAt = new Date();
    return this.save();
};

// Static methods
postalCodeScrapingSchema.statics.getActiveJobs = function () {
    return this.find({
        status: { $in: ['pending', 'running'] }
    }).sort({ createdAt: -1 });
};

postalCodeScrapingSchema.statics.getJobsByUser = function (userId, limit = 20) {
    return this.find({ createdBy: userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('createdBy', 'firstName lastName email');
};

postalCodeScrapingSchema.statics.getJobsByPostalCode = function (postalCode) {
    return this.find({ postalCode })
        .sort({ createdAt: -1 })
        .populate('createdBy', 'firstName lastName email');
};

// Pre-save middleware
postalCodeScrapingSchema.pre('save', function (next) {
    this.updatedAt = new Date();

    // Calculate runtime if job is running or completed
    if (this.startedAt) {
        const endTime = this.completedAt || new Date();
        this.runtimeSeconds = Math.round((endTime - this.startedAt) / 1000);
    }

    next();
});

// Post-save middleware for logging
postalCodeScrapingSchema.post('save', function (doc) {
    console.log(`Postal code scraping job ${doc.jobId} updated: ${doc.status}`);
});

module.exports = mongoose.model("PostalCodeScraping", postalCodeScrapingSchema);