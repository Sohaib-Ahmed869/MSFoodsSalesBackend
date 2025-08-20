// routes/jobLog.routes.js
const express = require("express");
const router = express.Router();
const jobLogController = require("../controllers/jobLog.controller");

// Get all job logs with filtering and pagination
// GET /api/jobs?page=1&limit=10&status=COMPLETED&jobType=SCHEDULED_SYNC&sortBy=startTime&sortOrder=desc
router.get("/", jobLogController.getAllJobs);

// Get job statistics
// GET /api/jobs/stats?days=7
router.get("/stats", jobLogController.getJobStats);

// Get job types summary
// GET /api/jobs/types-summary?days=30
router.get("/types-summary", jobLogController.getJobTypesSummary);

// Get recent errors
// GET /api/jobs/errors?limit=20
router.get("/errors", jobLogController.getRecentErrors);

// Delete old job logs (cleanup)
// DELETE /api/jobs/cleanup?days=30
router.delete("/cleanup", jobLogController.deleteOldJobs);

// Get specific job by jobId
// GET /api/jobs/:jobId
router.get("/:jobId", jobLogController.getJobById);

module.exports = router;
