// controllers/postalCodeScraping.controller.js
const PostalCodeScraping = require("../models/PostalCodeScraping");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const UberEatsData = require('../models/UberEats.model');

// Configuration
const SCRAPER_API_URL = process.env.SCRAPER_API_URL || "https://hfs-ws-1.onrender.com";
const SCRAPER_API_TIMEOUT = 300000; // 5 minutes

/**
 * Start a new postal code scraping job
 */
exports.startPostalCodeScraping = async (req, res) => {
    try {
        const {
            postal_code,
            max_restaurants = 10,
            max_menu_items,
            visible = false
        } = req.body;

        // Validate required fields
        if (!postal_code) {
            return res.status(400).json({
                success: false,
                message: "Postal code is required",
            });
        }

    

        console.log(`Starting postal code scraping for: ${postal_code}`);
        console.log(`User: ${req.user.firstName} ${req.user.lastName} (${req.user.email})`);

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
                provider: 'openai',
                apiKey: process.env.NEW_OPENAI_API_KEY,
                model: 'gpt-4o-mini'
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

        // Prepare request payload for Flask scraper API
        const scrapingPayload = {
            postal_code,
            max_restaurants,
            ...(max_menu_items && { max_menu_items })
        };

        console.log(`Sending request to Flask scraper API:`, {
            url: `${SCRAPER_API_URL}/start_scraping`,
            payload: scrapingPayload
        });

        // Start the scraping job via Flask API
        try {
            const response = await axios.post(
                `${SCRAPER_API_URL}/start_scraping`,
                scrapingPayload,
                {
                    timeout: SCRAPER_API_TIMEOUT,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (response.data.message && response.data.job_id) {
                // Update job with Flask job ID and mark as started
                scrapingJob.externalJobId = response.data.job_id;
                await scrapingJob.markAsStarted();

                console.log(`Scraping job started successfully:`, {
                    internalJobId: jobId,
                    flaskJobId: response.data.job_id,
                    postal_code
                });

                // Start background monitoring and data fetching
                monitorFlaskScrapingJob(scrapingJob._id, jobId)
                    .catch(error => {
                        console.error(`Error in background monitoring for job ${jobId}:`, error);
                    });

                res.status(202).json({
                    success: true,
                    job_id: jobId,
                    flask_job_id: response.data.job_id,
                    postal_code,
                    message: response.data.message,
                    status_url: `/api/postal-scraping/jobs/${jobId}`,
                    monitoring: {
                        job_status: `/api/postal-scraping/jobs/${jobId}`,
                        live_progress: `/api/postal-scraping/jobs/${jobId}/progress`
                    }
                });

            } else {
                await scrapingJob.markAsFailed(new Error(response.data.error || 'Unknown Flask API error'));
                res.status(400).json({
                    success: false,
                    message: "Failed to start scraping",
                    error: response.data.error || 'Unknown error from Flask API',
                });
            }

        } catch (apiError) {
            console.error(`Flask API error for job ${jobId}:`, apiError.message);
            await scrapingJob.markAsFailed(apiError);

            if (apiError.code === 'ECONNABORTED') {
                return res.status(408).json({
                    success: false,
                    message: "Flask API request timeout",
                    error: "The scraping service is currently slow. Please try again later.",
                });
            }

            if (apiError.response) {
                return res.status(apiError.response.status || 500).json({
                    success: false,
                    message: "Error from Flask scraping service",
                    error: apiError.response.data?.error || "External service error",
                });
            }

            res.status(500).json({
                success: false,
                message: "Failed to connect to Flask scraping service",
                error: "Please check if the Flask service is running",
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

        // Try to stop the job via Flask API
        try {
            await axios.post(
                `${SCRAPER_API_URL}/stop_job`,
                {},
                { timeout: 10000 }
            );
            console.log(`Successfully sent stop request to Flask API for job ${jobId}`);
        } catch (apiError) {
            console.error(`Error stopping job via Flask API:`, apiError.message);
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

        // Check permissions
        if (req.user.role !== 'admin' &&
            req.user.role !== 'sales_manager' &&
            job.createdBy._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized to view this job",
            });
        }

        // If job is still running, try to get latest status from Flask and sync data
        if (job.status === 'running' || job.status === 'pending') {
            try {
                await updateJobStatusFromFlask(job);
                await syncDataFromFlask(job);
            } catch (error) {
                console.error(`Error updating job status from Flask:`, error.message);
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
                runtimeMinutes: job.currentRuntimeMinutes,
                createdAt: job.createdAt,
                startedAt: job.startedAt,
                completedAt: job.completedAt,
                createdBy: job.createdBy,
                featuresUsed: job.featuresUsed
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

        // Update from Flask if still running
        if (job.status === 'running' || job.status === 'pending') {
            try {
                await updateJobStatusFromFlask(job);
                await syncDataFromFlask(job);
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
 * Get job results and download completed data
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

        // Get scraped data from our database
        const scrapedData = await UberEatsData.find({ scraping_job_id: jobId })
            .sort({ scraped_at: -1 });

        res.json({
            success: true,
            results: {
                jobId: job.jobId,
                postalCode: job.postalCode,
                status: job.status,
                summary: {
                    totalEstablishments: job.progress.establishmentsScraped,
                    restaurants: job.progress.restaurantsFound,
                    stores: job.progress.storesFound,
                    totalItems: job.progress.totalMenuItems + job.progress.totalProducts
                },
                scrapedData: scrapedData,
                completedAt: job.completedAt,
                createdBy: job.createdBy
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
 * Load existing JSON data from Flask (for testing or manual data loading)
 */
exports.loadJsonDataFromFlask = async (req, res) => {
    try {
        const { postal_code } = req.body;

        if (!postal_code) {
            return res.status(400).json({
                success: false,
                message: "Postal code is required",
            });
        }

        // Call Flask API to load JSON data
        const response = await axios.post(
            `${SCRAPER_API_URL}/load_json_data`,
            { postal_code },
            { timeout: 30000 }
        );

        if (response.data.message) {
            res.json({
                success: true,
                message: response.data.message,
                restaurant_count: response.data.restaurant_count,
                file: response.data.file
            });
        } else {
            res.status(400).json({
                success: false,
                message: response.data.error || "Failed to load JSON data"
            });
        }

    } catch (error) {
        console.error("Error loading JSON data from Flask:", error);
        res.status(500).json({
            success: false,
            message: "Error loading JSON data",
            error: error.message,
        });
    }
};

// Include other existing methods...
exports.listJobs = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const { status, postal_code, user_id, sort_by = 'createdAt', sort_order = 'desc' } = req.query;

        let query = {};

        // Role-based filtering
        if (req.user.role === 'sales_agent') {
            query.createdBy = req.user._id;
        }

        if (status) query.status = status;
        if (postal_code) query.postalCode = postal_code;
        if (user_id && req.user.role !== 'sales_agent') query.createdBy = user_id;

        const sortDirection = sort_order === 'desc' ? -1 : 1;
        const sortObj = { [sort_by]: sortDirection };

        const [jobs, totalCount] = await Promise.all([
            PostalCodeScraping.find(query)
                .populate('createdBy', 'firstName lastName email role')
                .sort(sortObj)
                .skip(skip)
                .limit(limit),
            PostalCodeScraping.countDocuments(query)
        ]);

        res.json({
            success: true,
            jobs: jobs.map(job => ({
                id: job._id,
                jobId: job.jobId,
                postalCode: job.postalCode,
                status: job.status,
                progress: job.progress,
                runtimeMinutes: job.currentRuntimeMinutes,
                createdAt: job.createdAt,
                createdBy: job.createdBy
            })),
            pagination: {
                page,
                limit,
                total: totalCount,
                pages: Math.ceil(totalCount / limit)
            }
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

exports.getJobScrapedData = async (req, res) => {
    try {
        const { jobId } = req.params;
        const { page = 1, limit = 20, establishment_type, search } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        let query = { scraping_job_id: jobId };
        
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

        const [scrapedData, totalCount] = await Promise.all([
            UberEatsData.find(query)
                .sort({ scraped_at: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            UberEatsData.countDocuments(query)
        ]);

        res.json({
            success: true,
            data: scrapedData,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalCount,
                pages: Math.ceil(totalCount / parseInt(limit))
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

        // Get real-time stats from our database
        const currentStats = await UberEatsData.aggregate([
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
                    totalMenuItems: { $sum: '$menu_items_count' }
                }
            }
        ]);

        const stats = currentStats[0] || {
            totalEstablishments: 0,
            restaurants: 0,
            stores: 0,
            totalMenuItems: 0
        };

        // Get latest scraped establishments
        const latestData = await UberEatsData.find({ scraping_job_id: jobId })
            .sort({ scraped_at: -1 })
            .limit(5)
            .select('name establishment_type menu_items_count scraped_at')
            .lean();

        res.json({
            success: true,
            progress: {
                jobId: job.jobId,
                status: job.status,
                postalCode: job.postalCode,
                realTimeStats: stats,
                latestEstablishments: latestData,
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

exports.deleteJob = async (req, res) => {
    try {
        const { jobId } = req.params;

        const job = await PostalCodeScraping.findOne({ jobId });

        if (!job) {
            return res.status(404).json({
                success: false,
                message: "Job not found",
            });
        }

        if (req.user.role !== 'admin' &&
            job.createdBy.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized to delete this job",
            });
        }

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

exports.getScrapingStatistics = async (req, res) => {
    try {
        const { timeframe = '30d' } = req.query;

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
        }

        let query = { ...dateFilter };
        if (req.user.role === 'sales_agent') {
            query.createdBy = req.user._id;
        }

        const stats = await PostalCodeScraping.aggregate([
            { $match: query },
            {
                $group: {
                    _id: null,
                    totalJobs: { $sum: 1 },
                    completedJobs: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
                    failedJobs: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
                    totalEstablishments: { $sum: '$progress.establishmentsScraped' },
                    totalMenuItems: { $sum: '$progress.totalMenuItems' }
                }
            }
        ]);

        const result = stats[0] || {
            totalJobs: 0,
            completedJobs: 0,
            failedJobs: 0,
            totalEstablishments: 0,
            totalMenuItems: 0
        };

        res.json({
            success: true,
            statistics: {
                jobs: {
                    total: result.totalJobs,
                    completed: result.completedJobs,
                    failed: result.failedJobs,
                    successRate: result.totalJobs > 0 ? 
                        Math.round((result.completedJobs / result.totalJobs) * 100) : 0
                },
                establishments: {
                    total: result.totalEstablishments,
                    avgPerJob: result.totalJobs > 0 ? 
                        Math.round(result.totalEstablishments / result.totalJobs) : 0
                },
                items: {
                    total: result.totalMenuItems,
                    avgPerEstablishment: result.totalEstablishments > 0 ? 
                        Math.round(result.totalMenuItems / result.totalEstablishments) : 0
                }
            }
        });

    } catch (error) {
        console.error("Error getting statistics:", error);
        res.status(500).json({
            success: false,
            message: "Error retrieving statistics",
            error: error.message,
        });
    }
};

exports.getScraperHealthStatus = async (req, res) => {
    try {
        const response = await axios.get(`${SCRAPER_API_URL}/`, {
            timeout: 10000
        });

        res.json({
            success: true,
            scraperApi: {
                status: 'healthy',
                url: SCRAPER_API_URL,
                responseTime: response.headers['x-response-time'] || 'N/A'
            }
        });

    } catch (error) {
        console.error("Flask API health check failed:", error.message);

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
 * Background function to monitor Flask scraping job and sync data
 */
async function monitorFlaskScrapingJob(jobDbId, jobId) {
    console.log(`Starting background monitoring for Flask job ${jobId}`);

    const maxMonitoringTime = 2 * 60 * 60 * 1000; // 2 hours
    const pollInterval = 30 * 1000; // 30 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxMonitoringTime) {
        try {
            const job = await PostalCodeScraping.findById(jobDbId);
            if (!job) {
                console.log(`Job ${jobId} not found in database, stopping monitoring`);
                break;
            }

            if (job.status === 'completed' || job.status === 'failed' || job.status === 'stopped') {
                console.log(`Job ${jobId} is ${job.status}, stopping monitoring`);
                break;
            }

            // Check Flask job status and sync data
            await updateJobStatusFromFlask(job);
            await syncDataFromFlask(job);

            await new Promise(resolve => setTimeout(resolve, pollInterval));

        } catch (error) {
            console.error(`Error in monitoring loop for job ${jobId}:`, error.message);
            await new Promise(resolve => setTimeout(resolve, pollInterval * 2));
        }
    }

    console.log(`Monitoring completed for Flask job ${jobId}`);
}

/**
 * Update job status from Flask API
 */
async function updateJobStatusFromFlask(job) {
    try {
        const response = await axios.get(
            `${SCRAPER_API_URL}/job_status`,
            { timeout: 15000 }
        );

        if (response.data && response.data.is_running !== undefined) {
            const flaskData = response.data;

            // Update progress
            const progressUpdate = {
                establishmentsScraped: flaskData.completed_count || 0,
                restaurantsFound: flaskData.completed_count || 0, // Flask doesn't distinguish yet
                totalMenuItems: 0, // Will be updated when we sync data
                currentEstablishment: flaskData.current_restaurant || ''
            };

            await job.updateProgress(progressUpdate);

            // Check if job completed
            if (!flaskData.is_running && flaskData.results && flaskData.results.length > 0) {
                console.log(`Flask job ${job.jobId} completed with ${flaskData.results.length} results`);
                // Data will be synced separately
            } else if (!flaskData.is_running && flaskData.error) {
                await job.markAsFailed(new Error(flaskData.error));
            }
        }

    } catch (error) {
        console.error(`Error updating job ${job.jobId} from Flask:`, error.message);
        throw error;
    }
}

/**
 * Sync scraped data from Flask to our database
 */
async function syncDataFromFlask(job) {
    try {
        // Get partial results from Flask
        const response = await axios.get(
            `${SCRAPER_API_URL}/partial_results`,
            { timeout: 15000 }
        );

        if (response.data && response.data.results && Array.isArray(response.data.results)) {
            const results = response.data.results;
            
            console.log(`Syncing ${results.length} results for job ${job.jobId}`);

            let savedCount = 0;
            
            for (const result of results) {
                try {
                    // Check if this result already exists
                    const existingData = await UberEatsData.findOne({
                        scraping_job_id: job.jobId,
                        name: result.name,
                        url: result.url
                    });

                    if (existingData) {
                        continue; // Skip if already exists
                    }

                    // Create UberEatsData document
                    const uberEatsData = new UberEatsData({
                        url: result.url || '',
                        postal_code: job.postalCode,
                        name: result.name || 'Unknown',
                        header: result.header || '',
                        establishment_type: determineEstablishmentType(result),
                        location: result.location || 'N/A',
                        email: result.email || 'N/A',
                        phone: result.phone || 'N/A',
                        registration_number: result.registration_number || 'N/A',
                        menu_items: result.menu_items || [],
                        menu_items_count: result.menu_items_count || (result.menu_items ? result.menu_items.length : 0),
                        categories: result.categories || [],
                        scraping_job_id: job.jobId,
                        created_by: job.createdBy,
                        source: 'ubereats',
                        scraped_at: new Date(),
                        scraped_timestamp: Math.floor(Date.now() / 1000)
                    });

                    await uberEatsData.save();
                    savedCount++;

                } catch (saveError) {
                    console.error(`Error saving result for ${result.name}:`, saveError.message);
                }
            }

            if (savedCount > 0) {
                console.log(`Successfully saved ${savedCount} new results for job ${job.jobId}`);
                
                // Update job progress with actual data from our database
                const totalDataCount = await UberEatsData.countDocuments({ scraping_job_id: job.jobId });
                const restaurantCount = await UberEatsData.countDocuments({ 
                    scraping_job_id: job.jobId, 
                    establishment_type: 'restaurant' 
                });
                const storeCount = totalDataCount - restaurantCount;
                const totalMenuItems = await UberEatsData.aggregate([
                    { $match: { scraping_job_id: job.jobId } },
                    { $group: { _id: null, total: { $sum: '$menu_items_count' } } }
                ]);

                const progressUpdate = {
                    establishmentsScraped: totalDataCount,
                    restaurantsFound: restaurantCount,
                    storesFound: storeCount,
                    totalMenuItems: totalMenuItems.length > 0 ? totalMenuItems[0].total : 0,
                    totalProducts: 0
                };

                await job.updateProgress(progressUpdate);
            }

            // Check if job is completed
            if (!response.data.is_running) {
                if (response.data.results.length > 0) {
                    // Mark job as completed
                    const results = {
                        success: true,
                        message: 'Scraping completed successfully',
                        scrapingResults: {
                            establishmentsScraped: job.progress.establishmentsScraped,
                            restaurantsScraped: job.progress.restaurantsFound,
                            storesScraped: job.progress.storesFound
                        }
                    };
                    
                    await job.setResults(results);
                    console.log(`Job ${job.jobId} marked as completed`);
                } else if (response.data.error) {
                    await job.markAsFailed(new Error(response.data.error));
                }
            }
        }

    } catch (error) {
        console.error(`Error syncing data for job ${job.jobId}:`, error.message);
        // Don't throw error to avoid stopping monitoring
    }
}

/**
 * Determine establishment type from scraped data
 */
function determineEstablishmentType(result) {
    // Check categories first
    if (result.categories && Array.isArray(result.categories)) {
        const categories = result.categories.map(c => c.toLowerCase());
        
        // Store/grocery indicators
        const storeKeywords = ['grocery', 'convenience', 'pharmacy', 'retail', 'store', 'market', 'shop'];
        if (storeKeywords.some(keyword => categories.some(cat => cat.includes(keyword)))) {
            if (categories.some(cat => cat.includes('grocery'))) return 'grocery';
            if (categories.some(cat => cat.includes('pharmacy'))) return 'pharmacy';
            if (categories.some(cat => cat.includes('convenience'))) return 'convenience';
            return 'store';
        }
    }
    
    // Check establishment name for store indicators
    const name = (result.name || '').toLowerCase();
    const header = (result.header || '').toLowerCase();
    
    const storeNames = ['cvs', 'walgreens', '7-eleven', 'wawa', 'target', 'walmart', 'costco'];
    if (storeNames.some(store => name.includes(store) || header.includes(store))) {
        return 'store';
    }
    
    // Default to restaurant
    return 'restaurant';
}