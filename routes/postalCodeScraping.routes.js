// routes/postalCodeScraping.routes.js
const express = require("express");
const router = express.Router();
const {
    auth,
    checkRole,
    updateLastLogin,
} = require("../middleware/auth");
const postalCodeScrapingController = require("../controllers/postalCodeScraping.controller");

// Middleware to log API usage for monitoring
const logApiUsage = (req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - User: ${req.user?.email || 'Anonymous'}`);
    next();
};

// Apply auth and logging to all routes
router.use(auth);
router.use(updateLastLogin);
router.use(logApiUsage);

// Job Management Routes
// =====================

/**
 * @route   POST /api/postal-scraping/start
 * @desc    Start a new postal code scraping job
 * @access  Private (All authenticated users)
 * @body    {
 *   postal_code: string (required) - 5-digit postal code
 *   max_restaurants: number (optional) - Maximum establishments to scrape
 *   max_menu_items: number (optional) - Maximum menu items per establishment
 *   visible: boolean (optional) - Run browser in visible mode (default: false)
 *   llm_config: object (optional) - LLM configuration for categorization
 * }
 */
router.post("/start", postalCodeScrapingController.startPostalCodeScraping);

/**
 * @route   GET /api/postal-scraping/jobs
 * @desc    List all scraping jobs with filtering and pagination
 * @access  Private (Role-based filtering)
 * @query   {
 *   page: number (default: 1)
 *   limit: number (default: 20)
 *   status: string (pending|running|completed|failed|stopped)
 *   postal_code: string
 *   user_id: string (admin/manager only)
 *   sort_by: string (default: createdAt)
 *   sort_order: string (asc|desc, default: desc)
 * }
 */
router.get("/jobs", postalCodeScrapingController.listJobs);

/**
 * @route   GET /api/postal-scraping/jobs/:jobId
 * @desc    Get detailed job status and information
 * @access  Private (Job creator, or admin/manager)
 */
router.get("/jobs/:jobId", postalCodeScrapingController.getJobStatus);

/**
 * @route   GET /api/postal-scraping/jobs/:jobId/progress
 * @desc    Get real-time job progress updates
 * @access  Private (Job creator, or admin/manager)
 */
router.get("/jobs/:jobId/progress", postalCodeScrapingController.getJobProgress);

/**
 * @route   GET /api/postal-scraping/jobs/:jobId/results
 * @desc    Get job results and download links for output files
 * @access  Private (Job creator, or admin/manager)
 */
router.get("/jobs/:jobId/results", postalCodeScrapingController.getJobResults);

/**
 * @route   POST /api/postal-scraping/jobs/:jobId/stop
 * @desc    Stop a running scraping job
 * @access  Private (Job creator, admin, or sales_manager)
 */
router.post("/jobs/:jobId/stop",
    checkRole(["admin", "sales_manager"]),
    postalCodeScrapingController.stopJob
);

/**
 * @route   DELETE /api/postal-scraping/jobs/:jobId
 * @desc    Delete a completed or failed job
 * @access  Private (Job creator or admin)
 */
router.delete("/jobs/:jobId", postalCodeScrapingController.deleteJob);

/**
 * @route   GET /api/postal-scraping/jobs/:jobId/data
 * @desc    Get scraped data for a specific job
 * @access  Private (Job creator, or admin/manager)
 * @query   {
 *   page: number (default: 1)
 *   limit: number (default: 20)
 *   establishment_type: string (restaurant|store|grocery|convenience)
 *   search: string
 *   sort_by: string (default: scraped_at)
 *   sort_order: string (asc|desc, default: desc)
 * }
 */
router.get("/jobs/:jobId/data", postalCodeScrapingController.getJobScrapedData);

/**
 * @route   GET /api/postal-scraping/jobs/:jobId/data-progress
 * @desc    Get real-time scraped data progress for a running job
 * @access  Private (Job creator, or admin/manager)
 */
router.get("/jobs/:jobId/data-progress", postalCodeScrapingController.getJobDataProgress);

/**
 * @route   POST /api/postal-scraping/jobs/:jobId/link-data
 * @desc    Manually link scraped data to a job based on postal code and timing
 * @access  Private (Job creator or admin)
 */
router.post("/jobs/:jobId/link-data", postalCodeScrapingController.linkScrapedDataToJob);
// Statistics and Monitoring Routes
// =================================

/**
 * @route   GET /api/postal-scraping/statistics
 * @desc    Get scraping statistics and analytics
 * @access  Private (All authenticated users - role-based filtering)
 * @query   {
 *   timeframe: string (24h|7d|30d|all, default: 30d)
 *   user_id: string (admin/manager only)
 * }
 */
router.get("/statistics", postalCodeScrapingController.getScrapingStatistics);

/**
 * @route   GET /api/postal-scraping/health
 * @desc    Check health status of the scraper API service
 * @access  Private (Admin and sales_manager only)
 */
router.get("/health",
    checkRole(["admin", "sales_manager"]),
    postalCodeScrapingController.getScraperHealthStatus
);

// Convenience Routes for Quick Access
// ===================================

/**
 * @route   GET /api/postal-scraping/active-jobs
 * @desc    Get all currently running jobs (quick access)
 * @access  Private (Admin and sales_manager only)
 */
router.get("/active-jobs",
    checkRole(["admin", "sales_manager"]),
    async (req, res, next) => {
        req.query.status = 'running';
        req.query.limit = '100';
        next();
    },
    postalCodeScrapingController.listJobs
);

/**
 * @route   GET /api/postal-scraping/my-jobs
 * @desc    Get current user's jobs (quick access)
 * @access  Private (All authenticated users)
 */
router.get("/my-jobs",
    async (req, res, next) => {
        req.query.user_id = req.user._id.toString();
        req.query.limit = '50';
        next();
    },
    postalCodeScrapingController.listJobs
);

/**
 * @route   GET /api/postal-scraping/recent
 * @desc    Get recent jobs from last 24 hours
 * @access  Private (Admin and sales_manager only)
 */
router.get("/recent",
    checkRole(["admin", "sales_manager"]),
    async (req, res, next) => {
        req.query.timeframe = '24h';
        req.query.limit = '20';
        next();
    },
    postalCodeScrapingController.listJobs
);

// Administrative Routes
// =====================

/**
 * @route   POST /api/postal-scraping/admin/cleanup
 * @desc    Clean up old completed jobs (admin only)
 * @access  Private (Admin only)
 */
router.post("/admin/cleanup",
    checkRole(["admin"]),
    async (req, res) => {
        try {
            const { older_than_days = 30, keep_successful = true } = req.body;

            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - older_than_days);

            let query = {
                createdAt: { $lt: cutoffDate },
                status: { $in: keep_successful ? ['failed'] : ['completed', 'failed'] }
            };

            const PostalCodeScraping = require("../models/PostalCodeScraping");
            const result = await PostalCodeScraping.deleteMany(query);

            res.json({
                success: true,
                message: `Cleaned up ${result.deletedCount} old jobs`,
                deletedCount: result.deletedCount,
                criteria: {
                    olderThanDays: older_than_days,
                    keepSuccessful: keep_successful
                }
            });

        } catch (error) {
            console.error("Error in cleanup:", error);
            res.status(500).json({
                success: false,
                message: "Error during cleanup",
                error: error.message
            });
        }
    }
);

/**
 * @route   GET /api/postal-scraping/admin/system-stats
 * @desc    Get system-wide statistics (admin only)
 * @access  Private (Admin only)
 */
router.get("/admin/system-stats",
    checkRole(["admin"]),
    async (req, res) => {
        try {
            const PostalCodeScraping = require("../models/PostalCodeScraping");

            const systemStats = await PostalCodeScraping.aggregate([
                {
                    $group: {
                        _id: null,
                        totalJobs: { $sum: 1 },
                        totalEstablishments: { $sum: '$progress.establishmentsScraped' },
                        totalItems: {
                            $sum: {
                                $add: ['$progress.totalMenuItems', '$progress.totalProducts']
                            }
                        },
                        avgJobDuration: { $avg: '$runtimeSeconds' },
                        llmJobsCount: {
                            $sum: { $cond: [{ $ne: ['$llmConfig.provider', null] }, 1, 0] }
                        }
                    }
                }
            ]);

            const statusBreakdown = await PostalCodeScraping.aggregate([
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 }
                    }
                }
            ]);

            const topUsers = await PostalCodeScraping.aggregate([
                {
                    $group: {
                        _id: '$createdBy',
                        jobCount: { $sum: 1 },
                        totalEstablishments: { $sum: '$progress.establishmentsScraped' }
                    }
                },
                { $sort: { jobCount: -1 } },
                { $limit: 5 },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'user'
                    }
                }
            ]);

            res.json({
                success: true,
                systemStats: systemStats[0] || {},
                statusBreakdown: statusBreakdown.reduce((acc, curr) => {
                    acc[curr._id] = curr.count;
                    return acc;
                }, {}),
                topUsers: topUsers.map(user => ({
                    userId: user._id,
                    name: user.user[0] ?
                        `${user.user[0].firstName} ${user.user[0].lastName}` :
                        'Unknown User',
                    email: user.user[0]?.email || 'Unknown',
                    jobCount: user.jobCount,
                    totalEstablishments: user.totalEstablishments
                }))
            });

        } catch (error) {
            console.error("Error getting system stats:", error);
            res.status(500).json({
                success: false,
                message: "Error retrieving system statistics",
                error: error.message
            });
        }
    }
);

// Error handling middleware for this router
router.use((error, req, res, next) => {
    console.error(`Postal Code Scraping API Error:`, {
        url: req.originalUrl,
        method: req.method,
        user: req.user?.email,
        error: error.message,
        stack: error.stack
    });

    // Don't expose internal errors to client
    if (error.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            message: "Validation error",
            details: Object.values(error.errors).map(err => err.message)
        });
    }

    if (error.name === 'CastError') {
        return res.status(400).json({
            success: false,
            message: "Invalid ID format"
        });
    }

    res.status(500).json({
        success: false,
        message: "Internal server error",
        error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});

module.exports = router;