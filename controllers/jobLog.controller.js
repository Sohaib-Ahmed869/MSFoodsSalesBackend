// controllers/jobLog.controller.js
const JobLog = require("../models/jobLog.model");

const jobLogController = {
  // Get all job logs with pagination and filtering
  getAllJobs: async (req, res) => {
    try {
      const {
        page = 1,
        limit = 10,
        status,
        jobType,
        triggeredBy,
        startDate,
        endDate,
        sortBy = "startTime",
        sortOrder = "desc",
      } = req.query;

      // Build filter object
      const filter = {};

      if (status) filter.status = status;
      if (jobType) filter.jobType = jobType;
      if (triggeredBy) filter.triggeredBy = triggeredBy;

      // Date range filter
      if (startDate || endDate) {
        filter.startTime = {};
        if (startDate) filter.startTime.$gte = new Date(startDate);
        if (endDate) filter.startTime.$lte = new Date(endDate);
      }

      // Sort options
      const sortOptions = {};
      sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

      // Execute query with pagination
      const jobs = await JobLog.find(filter)
        .sort(sortOptions)
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .select("-logs.metadata") // Exclude metadata for performance
        .lean();

      // Get total count for pagination
      const total = await JobLog.countDocuments(filter);

      res.json({
        success: true,
        data: jobs,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error fetching job logs",
        error: error.message,
      });
    }
  },

  // Get a specific job by ID
  getJobById: async (req, res) => {
    try {
      const { jobId } = req.params;

      const job = await JobLog.findOne({ jobId }).lean();

      if (!job) {
        return res.status(404).json({
          success: false,
          message: "Job not found",
        });
      }

      res.json({
        success: true,
        data: job,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error fetching job",
        error: error.message,
      });
    }
  },

  // Get job statistics
  getJobStats: async (req, res) => {
    try {
      const { days = 7 } = req.query;

      const stats = await JobLog.getJobStats(parseInt(days));

      // Get additional stats
      const totalJobs = await JobLog.countDocuments();
      const runningJobs = await JobLog.countDocuments({ status: "RUNNING" });

      // Recent activity (last 24 hours)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const recentActivity = await JobLog.countDocuments({
        startTime: { $gte: yesterday },
      });

      res.json({
        success: true,
        data: {
          statusStats: stats,
          totalJobs,
          runningJobs,
          recentActivity,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error fetching job statistics",
        error: error.message,
      });
    }
  },

  // Get job types summary
  getJobTypesSummary: async (req, res) => {
    try {
      const { days = 30 } = req.query;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));

      const summary = await JobLog.aggregate([
        { $match: { startTime: { $gte: startDate } } },
        {
          $group: {
            _id: "$jobType",
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] },
            },
            failed: {
              $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] },
            },
            running: {
              $sum: { $cond: [{ $eq: ["$status", "RUNNING"] }, 1, 0] },
            },
            partialSuccess: {
              $sum: { $cond: [{ $eq: ["$status", "PARTIAL_SUCCESS"] }, 1, 0] },
            },
            avgDuration: { $avg: "$duration" },
            lastRun: { $max: "$startTime" },
          },
        },
        { $sort: { total: -1 } },
      ]);

      res.json({
        success: true,
        data: summary,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error fetching job types summary",
        error: error.message,
      });
    }
  },

  // Get recent errors
  getRecentErrors: async (req, res) => {
    try {
      const { limit = 20 } = req.query;

      const jobsWithErrors = await JobLog.find({
        $or: [{ "errors.0": { $exists: true } }, { status: "FAILED" }],
      })
        .sort({ startTime: -1 })
        .limit(parseInt(limit))
        .select("jobId jobType status startTime errors logs")
        .lean();

      // Extract and format errors
      const errors = [];
      jobsWithErrors.forEach((job) => {
        // Add errors from errors array
        job.errors.forEach((error) => {
          errors.push({
            jobId: job.jobId,
            jobType: job.jobType,
            jobStatus: job.status,
            jobStartTime: job.startTime,
            docEntry: error.DocEntry,
            error: error.error,
            errorType: error.type,
            timestamp: error.timestamp,
          });
        });

        // Add errors from logs
        job.logs
          .filter((log) => log.level === "ERROR")
          .forEach((log) => {
            errors.push({
              jobId: job.jobId,
              jobType: job.jobType,
              jobStatus: job.status,
              jobStartTime: job.startTime,
              error: log.message,
              timestamp: log.timestamp,
              metadata: log.metadata,
            });
          });
      });

      // Sort by timestamp and limit
      errors.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      const limitedErrors = errors.slice(0, parseInt(limit));

      res.json({
        success: true,
        data: limitedErrors,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error fetching recent errors",
        error: error.message,
      });
    }
  },

  // Delete old job logs
  deleteOldJobs: async (req, res) => {
    try {
      const { days = 30 } = req.query;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));

      const result = await JobLog.deleteMany({
        startTime: { $lt: cutoffDate },
        status: { $ne: "RUNNING" }, // Don't delete running jobs
      });

      res.json({
        success: true,
        message: `Deleted ${result.deletedCount} old job logs`,
        deletedCount: result.deletedCount,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error deleting old job logs",
        error: error.message,
      });
    }
  },
};

module.exports = jobLogController;
