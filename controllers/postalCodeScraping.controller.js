// controllers/postalCodeScraping.controller.js
const PostalCodeScraping = require("../models/PostalCodeScraping");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const UberEatsData = require('../models/UberEats.model')

// Configuration
const SCRAPER_API_URL = process.env.SCRAPER_API_URL || "https://hfs-ws.onrender.com";
const SCRAPER_API_TIMEOUT = 300000; // 30 seconds

/**
 * Start a new postal code scraping job
 */
exports.startPostalCodeScraping = async (req, res) => {
    try {
        const {
            postal_code,
            max_restaurants,
            max_menu_items,
            visible = false
        } = req.body;

        const llm_config = {
            provider: 'openai',
            api_key: process.env.NEW_OPENAI_API_KEY,
            model: 'gpt-4o-mini'
        };

        // Validate required fields
        if (!postal_code) {
            return res.status(400).json({
                success: false,
                message: "Postal code is required",
            });
        }

        // Validate postal code format (basic validation)
        if (!/^\d{5}$/.test(postal_code)) {
            return res.status(400).json({
                success: false,
                message: "Invalid postal code format. Expected 5 digits.",
            });
        }

        // Validate optional parameters
        if (max_restaurants !== undefined && (!Number.isInteger(max_restaurants) || max_restaurants <= 0)) {
            return res.status(400).json({
                success: false,
                message: "max_restaurants must be a positive integer",
            });
        }

        if (max_menu_items !== undefined && (!Number.isInteger(max_menu_items) || max_menu_items <= 0)) {
            return res.status(400).json({
                success: false,
                message: "max_menu_items must be a positive integer",
            });
        }

        // Validate LLM configuration if provided
        // Validate LLM configuration
        if (!process.env.NEW_OPENAI_API_KEY) {
            return res.status(500).json({
                success: false,
                message: "OpenAI API key not configured in environment variables",
            });
        }

        console.log(`Starting postal code scraping for: ${postal_code}`);
        console.log(`User: ${req.user.firstName} ${req.user.lastName} (${req.user.email})`);
        console.log(`Parameters:`, {
            max_restaurants,
            max_menu_items,
            visible,
            llm_enabled: !!llm_config
        });

        // Generate unique job ID
        const jobId = uuidv4().split('-')[0]; // Short job ID

        // Create job record in database
        const scrapingJob = new PostalCodeScraping({
            jobId,
            postalCode: postal_code,
            maxRestaurants: max_restaurants,
            maxMenuItems: max_menu_items,
            visible,
           llmConfig: {
                provider: llm_config.provider,
                apiKey: llm_config.api_key,
                model: llm_config.model
            },
            status: 'pending',
            createdBy: req.user._id,
            featuresUsed: [
                'postal_code_scraping',
                'dual_file_output',
                'real_time_monitoring',
                'llm_categorization',
                'store_carousel_navigation',
                'duplicate_prevention'
            ]
        });

        await scrapingJob.save();

        // Prepare request payload for scraper API
        const scrapingPayload = {
            postal_code,
            visible,
            llm_config,
            ...(max_restaurants && { max_restaurants }),
            ...(max_menu_items && { max_menu_items })
        };
        console.log(`Sending request to scraper API:`, {
            url: `${SCRAPER_API_URL}/scrape`,
            payload: { ...scrapingPayload, llm_config: llm_config ? '[REDACTED]' : undefined }
        });

        // Start the scraping job
        try {
            const response = await axios.post(
                `${SCRAPER_API_URL}/scrape`,
                scrapingPayload,
                {
                    timeout: SCRAPER_API_TIMEOUT,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (response.data.success) {
                // Update job with external job ID and mark as started
                scrapingJob.jobId = response.data.job_id; // Use the external job ID
                await scrapingJob.markAsStarted();

                console.log(`Scraping job started successfully:`, {
                    internalJobId: jobId,
                    externalJobId: response.data.job_id,
                    postal_code,
                    features: response.data.features || []
                });

                // Start background monitoring (don't await this)
                monitorScrapingJob(scrapingJob._id, response.data.job_id)
                    .catch(error => {
                        console.error(`Error in background monitoring for job ${jobId}:`, error);
                    });

                res.status(202).json({
                    success: true,
                    job_id: jobId, // Return our internal job ID
                    external_job_id: response.data.job_id,
                    postal_code,
                    message: response.data.message,
                    status_url: `/api/postal-scraping/jobs/${jobId}`,
                    estimated_time: response.data.estimated_time,
                    features: response.data.features || [],
                   llm_categorization: {
                        enabled: true,
                        provider: llm_config.provider,
                        model: llm_config.model
                    },
                    monitoring: {
                        job_status: `/api/postal-scraping/jobs/${jobId}`,
                        live_progress: `/api/postal-scraping/jobs/${jobId}/progress`
                    }
                });

            } else {
                // Scraper API returned error
                await scrapingJob.markAsFailed(new Error(response.data.error || response.data.message || 'Unknown scraper API error'));

                res.status(400).json({
                    success: false,
                    message: "Failed to start scraping",
                    error: response.data.error || response.data.message || 'Unknown error from scraper API',
                });
            }

        } catch (apiError) {
            console.error(`Scraper API error for job ${jobId}:`, apiError.message);

            // Mark job as failed
            await scrapingJob.markAsFailed(apiError);

            // Handle different types of API errors
            if (apiError.code === 'ECONNABORTED') {
                return res.status(408).json({
                    success: false,
                    message: "Scraper API request timeout",
                    error: "The scraping service is currently slow. Please try again later.",
                });
            }

            if (apiError.response) {
                return res.status(apiError.response.status || 500).json({
                    success: false,
                    message: "Error from scraping service",
                    error: apiError.response.data?.error || "External service error",
                });
            }

            res.status(500).json({
                success: false,
                message: "Failed to connect to scraping service",
                error: "Please check if the scraping service is running",
            });
        }

    } catch (error) {
        console.error("Error starting postal code scraping:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    }
};

/**
 * Get job status and progress
 */
exports.getJobStatus = async (req, res) => {
    try {
        const { jobId } = req.params;

        const job = await PostalCodeScraping.findOne({ jobId }).populate('createdBy', 'firstName lastName email');

        if (!job) {
            return res.status(404).json({
                success: false,
                message: "Job not found",
            });
        }

        // Check if user has permission to view this job
        if (req.user.role !== 'admin' &&
            req.user.role !== 'sales_manager' &&
            job.createdBy._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized to view this job",
            });
        }

        // If job is still running, try to get latest status from scraper API
        if (job.status === 'running' || job.status === 'pending') {
            try {
                await updateJobStatusFromAPI(job);
            } catch (error) {
                console.error(`Error updating job status from API:`, error.message);
                // Continue with existing data
            }
        }

        res.json({
            success: true,
            job: {
                id: job._id,
                jobId: job.jobId,
                postalCode: job.postalCode,
                status: job.status,
                progress: job.progress,
                results: job.results,
                timing: job.results.timing,
                runtimeMinutes: job.currentRuntimeMinutes,
                createdAt: job.createdAt,
                startedAt: job.startedAt,
                completedAt: job.completedAt,
                createdBy: job.createdBy,
                featuresUsed: job.featuresUsed,
                llmCategorization: {
                    enabled: !!job.llmConfig.provider,
                    provider: job.llmConfig.provider,
                    model: job.llmConfig.model
                }
            }
        });

    } catch (error) {
        console.error("Error getting job status:", error);
        res.status(500).json({
            success: false,
            message: "Error retrieving job status",
            error: error.message,
        });
    }
};

/**
 * Get detailed job progress with real-time data
 */
exports.getJobProgress = async (req, res) => {
    try {
        const { jobId } = req.params;

        const job = await PostalCodeScraping.findOne({ jobId });
        if (!job) {
            return res.status(404).json({
                success: false,
                message: "Job not found",
            });
        }

        // Update from API if still running
        if (job.status === 'running' || job.status === 'pending') {
            try {
                await updateJobStatusFromAPI(job);
            } catch (error) {
                console.error(`Error updating job progress:`, error.message);
            }
        }

        res.json({
            success: true,
            progress: {
                jobId: job.jobId,
                status: job.status,
                runtimeMinutes: job.currentRuntimeMinutes,
                currentStep: job.progress.currentEstablishment || 'Initializing...',
                establishments: {
                    total: job.progress.establishmentsScraped,
                    restaurants: job.progress.restaurantsFound,
                    stores: job.progress.storesFound
                },
                items: {
                    menuItems: job.progress.totalMenuItems,
                    products: job.progress.totalProducts,
                    total: job.progress.totalMenuItems + job.progress.totalProducts
                },
                efficiency: {
                    pagesProcessed: job.progress.pagesProcessed,
                    duplicatesPrevented: job.progress.duplicatesPrevented,
                    storeDuplicatesPrevented: job.progress.storeDuplicatesPrevented
                },
                categorization: {
                    llmUsed: job.progress.llmCategorizationUsed,
                    provider: job.llmConfig.provider
                },
                estimatedTimeRemaining: job.estimatedTimeRemaining,
                error: job.progress.error
            }
        });

    } catch (error) {
        console.error("Error getting job progress:", error);
        res.status(500).json({
            success: false,
            message: "Error retrieving job progress",
            error: error.message,
        });
    }
};

/**
 * Stop a running job
 */
exports.stopJob = async (req, res) => {
    try {
        const { jobId } = req.params;

        const job = await PostalCodeScraping.findOne({ jobId });
        if (!job) {
            return res.status(404).json({
                success: false,
                message: "Job not found",
            });
        }

        // Check permissions
        if (req.user.role !== 'admin' &&
            req.user.role !== 'sales_manager' &&
            job.createdBy.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized to stop this job",
            });
        }

        if (job.status !== 'running' && job.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: `Cannot stop job with status: ${job.status}`,
            });
        }

        // Try to stop the job via scraper API
        try {
            await axios.post(
                `${SCRAPER_API_URL}/stop/${job.jobId}`,
                {},
                { timeout: 10000 }
            );
            console.log(`Successfully sent stop request to scraper API for job ${jobId}`);
        } catch (apiError) {
            console.error(`Error stopping job via API:`, apiError.message);
            // Continue with local update even if API call fails
        }

        // Update local job status
        await job.markAsStopped();

        res.json({
            success: true,
            message: "Job stop request sent",
            job: {
                id: job._id,
                jobId: job.jobId,
                status: job.status,
                runtimeMinutes: job.currentRuntimeMinutes
            }
        });

    } catch (error) {
        console.error("Error stopping job:", error);
        res.status(500).json({
            success: false,
            message: "Error stopping job",
            error: error.message,
        });
    }
};

/**
 * List all jobs with filtering and pagination
 */
exports.listJobs = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const { status, postal_code, user_id, sort_by = 'createdAt', sort_order = 'desc' } = req.query;

        // Build query
        let query = {};

        // Role-based filtering
        if (req.user.role === 'sales_agent') {
            query.createdBy = req.user._id;
        } else if (req.user.role === 'sales_manager') {
            // Sales managers can see jobs from their team (implement team logic if needed)
            // For now, they can see all jobs
        }
        // Admins can see all jobs

        // Apply filters
        if (status) {
            query.status = status;
        }

        if (postal_code) {
            query.postalCode = postal_code;
        }

        if (user_id && req.user.role !== 'sales_agent') {
            query.createdBy = user_id;
        }

        // Build sort object
        const sortDirection = sort_order === 'desc' ? -1 : 1;
        const sortObj = { [sort_by]: sortDirection };

        // Execute query
        const [jobs, totalCount] = await Promise.all([
            PostalCodeScraping.find(query)
                .populate('createdBy', 'firstName lastName email role')
                .sort(sortObj)
                .skip(skip)
                .limit(limit),
            PostalCodeScraping.countDocuments(query)
        ]);

        // Get summary statistics
        const summaryStats = await PostalCodeScraping.aggregate([
            { $match: query },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    totalEstablishments: { $sum: '$progress.establishmentsScraped' },
                    totalRestaurants: { $sum: '$progress.restaurantsFound' },
                    totalStores: { $sum: '$progress.storesFound' }
                }
            }
        ]);

        const summary = {
            total: totalCount,
            byStatus: {},
            totalEstablishments: 0,
            totalRestaurants: 0,
            totalStores: 0
        };

        summaryStats.forEach(stat => {
            summary.byStatus[stat._id] = stat.count;
            summary.totalEstablishments += stat.totalEstablishments;
            summary.totalRestaurants += stat.totalRestaurants;
            summary.totalStores += stat.totalStores;
        });

        res.json({
            success: true,
            jobs: jobs.map(job => ({
                id: job._id,
                jobId: job.jobId,
                postalCode: job.postalCode,
                status: job.status,
                progress: {
                    establishmentsScraped: job.progress.establishmentsScraped,
                    restaurantsFound: job.progress.restaurantsFound,
                    storesFound: job.progress.storesFound,
                    totalItems: job.progress.totalMenuItems + job.progress.totalProducts
                },
                runtimeMinutes: job.currentRuntimeMinutes,
                createdAt: job.createdAt,
                createdBy: job.createdBy,
                featuresUsed: job.featuresUsed,
                llmEnabled: !!job.llmConfig.provider
            })),
            pagination: {
                page,
                limit,
                total: totalCount,
                pages: Math.ceil(totalCount / limit)
            },
            summary
        });

    } catch (error) {
        console.error("Error listing jobs:", error);
        res.status(500).json({
            success: false,
            message: "Error retrieving jobs",
            error: error.message,
        });
    }
};

/**
 * Manually link scraped data to a job (useful for cleanup)
 */
exports.linkScrapedDataToJob = async (req, res) => {
    try {
        const { jobId } = req.params;

        const job = await PostalCodeScraping.findOne({ jobId });

        if (!job) {
            return res.status(404).json({
                success: false,
                message: "Job not found",
            });
        }

        // Check permissions
        if (req.user.role !== 'admin' &&
            job.createdBy.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized to link data for this job",
            });
        }

        const jobStartTime = job.startedAt || job.createdAt;
        const jobEndTime = job.completedAt || new Date();
        const searchStartTime = new Date(jobStartTime.getTime() - 5 * 60 * 1000);

        console.log(UberEatsData.find({ postal_code: job.postalCode }))
        // Link unlinked data from this postal code and time period
        const result = await UberEatsData.updateMany(
            {
                postal_code: job.postalCode,

            },
            { $set: { scraping_job_id: job.jobId } }
        );

        console.log(result)

        res.json({
            success: true,
            message: `Linked ${result.modifiedCount} establishments to job ${job.jobId}`,
            linkedCount: result.modifiedCount
        });

    } catch (error) {
        console.error("Error linking scraped data to job:", error);
        res.status(500).json({
            success: false,
            message: "Error linking scraped data",
            error: error.message,
        });
    }
};

/**
 * Get job results and files
 */
exports.getJobResults = async (req, res) => {
    try {
        const { jobId } = req.params;

        const job = await PostalCodeScraping.findOne({ jobId }).populate('createdBy', 'firstName lastName email');

        if (!job) {
            return res.status(404).json({
                success: false,
                message: "Job not found",
            });
        }

        if (job.status !== 'completed') {
            return res.status(400).json({
                success: false,
                message: `Job is not completed. Current status: ${job.status}`,
            });
        }

        res.json({
            success: true,
            results: {
                jobId: job.jobId,
                postalCode: job.postalCode,
                status: job.status,
                summary: {
                    totalEstablishments: job.results.categorizationStats.totals.establishments,
                    restaurants: job.results.categorizationStats.restaurants.count,
                    stores: job.results.categorizationStats.stores.count,
                    totalItems: job.results.categorizationStats.totals.totalItems,
                    pagesProcessed: job.results.scrapingResults.pagesProcessed
                },
                categorization: {
                    llmUsed: job.results.scrapingResults.llmCategorizationUsed,
                    categoryDistribution: Object.fromEntries(job.results.categorizationStats.categoryDistribution),
                    topCategories: job.results.categorizationStats.topCategories
                },
                performance: {
                    totalTimeSeconds: job.results.timing.totalTime,
                    scrapingTimeSeconds: job.results.timing.scrapingTime,
                    runtimeMinutes: job.currentRuntimeMinutes
                },
                outputFiles: job.results.outputFiles,
                createdBy: job.createdBy,
                completedAt: job.completedAt
            }
        });

    } catch (error) {
        console.error("Error getting job results:", error);
        res.status(500).json({
            success: false,
            message: "Error retrieving job results",
            error: error.message,
        });
    }
};

/**
 * Get scraped data for a specific job (based on postal code and timing)
 */
exports.getJobScrapedData = async (req, res) => {
    try {
        const { jobId } = req.params;
        const {
            page = 1,
            limit = 20,
            establishment_type,
            search,
            sort_by = 'scraped_at',
            sort_order = 'desc'
        } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Find the job first to verify access
        const job = await PostalCodeScraping.findOne({ jobId });

        if (!job) {
            return res.status(404).json({
                success: false,
                message: "Job not found",
            });
        }

        // Check permissions
        if (req.user.role !== 'admin' &&
            req.user.role !== 'sales_manager' &&
            job.createdBy.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized to view this job data",
            });
        }

        // Calculate time window for the job (job start time + buffer)
        const jobStartTime = job.startedAt || job.createdAt;
        const jobEndTime = job.completedAt || new Date();

        // Add 5 minute buffer before job start to catch any data
        const searchStartTime = new Date(jobStartTime.getTime() - 5 * 60 * 1000);

        // Build query for scraped data based on postal code and time window
        let query = {
            postal_code: job.postalCode,
            scraped_at: {
                $gte: searchStartTime,
                $lte: jobEndTime
            }
        };

        if (establishment_type) {
            query.establishment_type = establishment_type;
        }

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { header: { $regex: search, $options: 'i' } },
                { location: { $regex: search, $options: 'i' } }
            ];
        }

        // Build sort object
        const sortDirection = sort_order === 'desc' ? -1 : 1;
        const sortObj = { [sort_by]: sortDirection };

        // Execute queries
        const [scrapedData, totalCount, stats] = await Promise.all([
            UberEatsData.find(query)
                .sort(sortObj)
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            UberEatsData.countDocuments(query),
            UberEatsData.getStatsByPostalCodeAndTime(job.postalCode, searchStartTime, jobEndTime)
        ]);

        // Update scraped data with job ID for future reference
        if (scrapedData.length > 0) {
            await UberEatsData.updateMany(
                {
                    postal_code: job.postalCode,
                    scraped_at: { $gte: searchStartTime, $lte: jobEndTime },
                    scraping_job_id: null
                },
                { $set: { scraping_job_id: job.jobId } }
            );
        }

        // Get category distribution
        const categoryDistribution = await UberEatsData.aggregate([
            { $match: query },
            { $unwind: '$categories' },
            {
                $group: {
                    _id: '$categories',
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);

        const statistics = stats[0] || {
            totalEstablishments: 0,
            restaurants: 0,
            stores: 0,
            totalMenuItems: 0,
            avgMenuItemsPerEstablishment: 0
        };

        res.json({
            success: true,
            data: scrapedData,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalCount,
                pages: Math.ceil(totalCount / parseInt(limit))
            },
            statistics: {
                ...statistics,
                categoryDistribution: categoryDistribution.map(cat => ({
                    category: cat._id,
                    count: cat.count
                }))
            },
            job: {
                id: job._id,
                jobId: job.jobId,
                postalCode: job.postalCode,
                status: job.status,
                startedAt: job.startedAt,
                completedAt: job.completedAt
            },
            timeWindow: {
                searchStartTime,
                jobEndTime,
                description: `Data scraped between ${searchStartTime.toISOString()} and ${jobEndTime.toISOString()}`
            }
        });

    } catch (error) {
        console.error("Error getting job scraped data:", error);
        res.status(500).json({
            success: false,
            message: "Error retrieving scraped data",
            error: error.message,
        });
    }
};

/**
 * Get real-time scraped data count for a running job
 */
exports.getJobDataProgress = async (req, res) => {
    try {
        const { jobId } = req.params;

        const job = await PostalCodeScraping.findOne({ jobId });

        if (!job) {
            return res.status(404).json({
                success: false,
                message: "Job not found",
            });
        }

        // Calculate time window for the job
        const jobStartTime = job.startedAt || job.createdAt;
        const currentTime = new Date();

        // Add 5 minute buffer before job start
        const searchStartTime = new Date(jobStartTime.getTime() - 5 * 60 * 1000);

        // Get real-time stats from database based on postal code and timing
        const stats = await UberEatsData.getStatsByPostalCodeAndTime(
            job.postalCode,
            searchStartTime,
            currentTime
        );

        const currentStats = stats[0] || {
            totalEstablishments: 0,
            restaurants: 0,
            stores: 0,
            totalMenuItems: 0,
            avgMenuItemsPerEstablishment: 0
        };

        // Get latest scraped establishments for this postal code in the time window
        const latestData = await UberEatsData.find({
            postal_code: job.postalCode,
            scraped_at: { $gte: searchStartTime, $lte: currentTime }
        })
            .sort({ scraped_at: -1 })
            .limit(5)
            .select('name establishment_type menu_items_count scraped_at')
            .lean();

        // Update job progress with real database stats
        if (job.status === 'running') {
            const progressUpdate = {
                establishmentsScraped: currentStats.totalEstablishments,
                restaurantsFound: currentStats.restaurants,
                storesFound: currentStats.stores,
                totalMenuItems: currentStats.totalMenuItems,
                totalProducts: 0 // This would need to be calculated separately for non-restaurant items
            };

            await job.updateProgress(progressUpdate);
        }

        res.json({
            success: true,
            progress: {
                jobId: job.jobId,
                status: job.status,
                postalCode: job.postalCode,
                realTimeStats: currentStats,
                latestEstablishments: latestData,
                timeWindow: {
                    start: searchStartTime,
                    current: currentTime
                },
                lastUpdated: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error("Error getting job data progress:", error);
        res.status(500).json({
            success: false,
            message: "Error retrieving data progress",
            error: error.message,
        });
    }
};

/**
 * Delete a job and its associated data
 */
exports.deleteJob = async (req, res) => {
    try {
        const { jobId } = req.params;

        const job = await PostalCodeScraping.findOne({
            $or: [{ jobId }, { jobId: jobId }]
        });

        if (!job) {
            return res.status(404).json({
                success: false,
                message: "Job not found",
            });
        }

        // Check permissions
        if (req.user.role !== 'admin' &&
            job.createdBy.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized to delete this job",
            });
        }

        // Don't allow deletion of running jobs
        if (job.status === 'running') {
            return res.status(400).json({
                success: false,
                message: "Cannot delete a running job. Stop it first.",
            });
        }

        await PostalCodeScraping.findByIdAndDelete(job._id);

        res.json({
            success: true,
            message: "Job deleted successfully",
        });

    } catch (error) {
        console.error("Error deleting job:", error);
        res.status(500).json({
            success: false,
            message: "Error deleting job",
            error: error.message,
        });
    }
};

/**
 * Get statistics for postal code scraping
 */
exports.getScrapingStatistics = async (req, res) => {
    try {
        const { timeframe = '30d', user_id } = req.query;

        // Calculate date range
        let dateFilter = {};
        const now = new Date();

        switch (timeframe) {
            case '24h':
                dateFilter.createdAt = { $gte: new Date(now - 24 * 60 * 60 * 1000) };
                break;
            case '7d':
                dateFilter.createdAt = { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) };
                break;
            case '30d':
                dateFilter.createdAt = { $gte: new Date(now - 30 * 24 * 60 * 60 * 1000) };
                break;
            case 'all':
                break;
            default:
                dateFilter.createdAt = { $gte: new Date(now - 30 * 24 * 60 * 60 * 1000) };
        }

        // Build query
        let query = { ...dateFilter };

        // Role-based filtering
        if (req.user.role === 'sales_agent') {
            query.createdBy = req.user._id;
        } else if (user_id && req.user.role !== 'sales_agent') {
            query.createdBy = user_id;
        }

        // Aggregate statistics
        const stats = await PostalCodeScraping.aggregate([
            { $match: query },
            {
                $group: {
                    _id: null,
                    totalJobs: { $sum: 1 },
                    completedJobs: {
                        $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                    },
                    failedJobs: {
                        $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
                    },
                    runningJobs: {
                        $sum: { $cond: [{ $eq: ['$status', 'running'] }, 1, 0] }
                    },
                    totalEstablishments: { $sum: '$progress.establishmentsScraped' },
                    totalRestaurants: { $sum: '$progress.restaurantsFound' },
                    totalStores: { $sum: '$progress.storesFound' },
                    totalMenuItems: { $sum: '$progress.totalMenuItems' },
                    totalProducts: { $sum: '$progress.totalProducts' },
                    avgRuntimeMinutes: { $avg: '$runtimeSeconds' },
                    llmJobsCount: {
                        $sum: { $cond: [{ $ne: ['$llmConfig.provider', null] }, 1, 0] }
                    }
                }
            }
        ]);

        // Get postal code distribution
        const postalCodeStats = await PostalCodeScraping.aggregate([
            { $match: query },
            {
                $group: {
                    _id: '$postalCode',
                    jobCount: { $sum: 1 },
                    totalEstablishments: { $sum: '$progress.establishmentsScraped' },
                    lastJobDate: { $max: '$createdAt' }
                }
            },
            { $sort: { jobCount: -1 } },
            { $limit: 10 }
        ]);

        // Get performance metrics by status
        const performanceStats = await PostalCodeScraping.aggregate([
            { $match: { ...query, status: 'completed' } },
            {
                $group: {
                    _id: '$status',
                    avgEstablishments: { $avg: '$progress.establishmentsScraped' },
                    avgRuntimeMinutes: { $avg: { $divide: ['$runtimeSeconds', 60] } },
                    avgItemsPerEstablishment: {
                        $avg: {
                            $divide: [
                                { $add: ['$progress.totalMenuItems', '$progress.totalProducts'] },
                                { $max: ['$progress.establishmentsScraped', 1] }
                            ]
                        }
                    }
                }
            }
        ]);

        const result = stats[0] || {
            totalJobs: 0,
            completedJobs: 0,
            failedJobs: 0,
            runningJobs: 0,
            totalEstablishments: 0,
            totalRestaurants: 0,
            totalStores: 0,
            totalMenuItems: 0,
            totalProducts: 0,
            avgRuntimeMinutes: 0,
            llmJobsCount: 0
        };

        res.json({
            success: true,
            timeframe,
            statistics: {
                jobs: {
                    total: result.totalJobs,
                    completed: result.completedJobs,
                    failed: result.failedJobs,
                    running: result.runningJobs,
                    successRate: result.totalJobs > 0 ?
                        Math.round((result.completedJobs / result.totalJobs) * 100) : 0
                },
                establishments: {
                    total: result.totalEstablishments,
                    restaurants: result.totalRestaurants,
                    stores: result.totalStores,
                    avgPerJob: result.totalJobs > 0 ?
                        Math.round(result.totalEstablishments / result.totalJobs) : 0
                },
                items: {
                    menuItems: result.totalMenuItems,
                    products: result.totalProducts,
                    total: result.totalMenuItems + result.totalProducts,
                    avgPerEstablishment: result.totalEstablishments > 0 ?
                        Math.round((result.totalMenuItems + result.totalProducts) / result.totalEstablishments) : 0
                },
                performance: {
                    avgRuntimeMinutes: Math.round((result.avgRuntimeMinutes || 0) / 60),
                    llmUsageRate: result.totalJobs > 0 ?
                        Math.round((result.llmJobsCount / result.totalJobs) * 100) : 0
                },
                topPostalCodes: postalCodeStats,
                performanceMetrics: performanceStats[0] || {}
            }
        });

    } catch (error) {
        console.error("Error getting scraping statistics:", error);
        res.status(500).json({
            success: false,
            message: "Error retrieving statistics",
            error: error.message,
        });
    }
};

/**
 * Get health status of the scraper API
 */
exports.getScraperHealthStatus = async (req, res) => {
    try {
        const response = await axios.get(`${SCRAPER_API_URL}/health`, {
            timeout: 10000
        });

        res.json({
            success: true,
            scraperApi: {
                status: 'healthy',
                url: SCRAPER_API_URL,
                response: response.data,
                responseTime: response.headers['x-response-time'] || 'N/A'
            }
        });

    } catch (error) {
        console.error("Scraper API health check failed:", error.message);

        res.json({
            success: true,
            scraperApi: {
                status: 'unhealthy',
                url: SCRAPER_API_URL,
                error: error.message,
                lastChecked: new Date().toISOString()
            }
        });
    }
};

// Helper Functions
// ================

/**
 * Background function to monitor a scraping job
 */
async function monitorScrapingJob(jobDbId, externalJobId) {
    console.log(`Starting background monitoring for job ${externalJobId}`);

    const maxMonitoringTime = 4 * 60 * 60 * 1000; // 4 hours
    const pollInterval = 30 * 1000; // 30 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxMonitoringTime) {
        try {
            const job = await PostalCodeScraping.findById(jobDbId);
            if (!job) {
                console.log(`Job ${externalJobId} not found in database, stopping monitoring`);
                break;
            }

            if (job.status === 'completed' || job.status === 'failed' || job.status === 'stopped') {
                console.log(`Job ${externalJobId} is ${job.status}, stopping monitoring`);
                break;
            }

            // Update job status from API
            await updateJobStatusFromAPI(job);

            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, pollInterval));

        } catch (error) {
            console.error(`Error in monitoring loop for job ${externalJobId}:`, error.message);

            // Wait a bit longer on error
            await new Promise(resolve => setTimeout(resolve, pollInterval * 2));
        }
    }

    console.log(`Monitoring completed for job ${externalJobId}`);
}

/**
* Update job status from scraper API
*/
async function updateJobStatusFromAPI(job) {
    try {
        const response = await axios.get(
            `${SCRAPER_API_URL}/job/${job.jobId}`,
            { timeout: 15000 }
        );

        if (response.data && (response.data.status === 'completed' || response.data.status === 'running' || response.data.status === 'failed')) {
            const apiData = response.data;

            // Update progress
            const progressUpdate = {
                establishmentsScraped: apiData.total_establishments_saved || 0,
                restaurantsFound: apiData.current_restaurants_saved || 0,
                storesFound: apiData.current_stores_saved || 0,
                totalMenuItems: apiData.current_menu_items_saved || 0,
                totalProducts: apiData.current_products_saved || 0,
                pagesProcessed: apiData.progress?.establishments_scraped || 0,
                duplicatesPrevented: apiData.deduplication_effectiveness?.duplicates_prevented || 0,
                storeDuplicatesPrevented: apiData.deduplication_effectiveness?.store_duplicates_prevented || 0,
                llmCategorizationUsed: apiData.progress?.llm_categorization_used || false
            };

            await job.updateProgress(progressUpdate);

            // Check if job is completed
            // Check if job is completed
            if (apiData.status === 'completed' && apiData.result) {
                const results = {
                    success: true,
                    scrapingResults: apiData.result.scraping_results,
                    categorizationStats: apiData.result.categorization_stats || {},
                    timing: apiData.result.timing || {},
                    outputFiles: apiData.result.output_files || {},
                    message: apiData.result.message
                };
                await job.setResults(results);
                console.log(`Job ${job.jobId} completed successfully`);
            } else if (apiData.status === 'failed') {
                await job.markAsFailed(new Error(apiData.progress?.error || 'Unknown error'));
                console.log(`Job ${job.jobId} failed`);
            }

        } else {
            console.error(`API returned error for job ${job.jobId}:`, response.data);
        }

    } catch (error) {
        console.error(`Error updating job ${job.jobId} from API:`, error.message);

        // Don't mark as failed unless it's a persistent error
        if (error.response?.status === 404) {
            // Job not found in API, might have been cleaned up
            console.log(`Job ${job.jobId} not found in scraper API`);
        }

        throw error;
    }
}

