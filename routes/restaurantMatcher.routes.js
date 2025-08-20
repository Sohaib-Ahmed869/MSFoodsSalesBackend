const express = require("express");
const axios = require("axios");
const router = express.Router();

// Python scraper service URL
const PYTHON_SCRAPER_URL = process.env.SCRAPER_API_URL;

/**
 * POST /api/restaurant-matcher/analyze
 * Analyze a UberEats restaurant URL and match with inventory
 */
router.post("/analyze", async (req, res) => {
  try {
    const { restaurant_url } = req.body;

    if (!restaurant_url) {
      return res.status(400).json({
        success: false,
        error: "restaurant_url is required",
      });
    }

    // Validate UberEats URL
    if (!restaurant_url.includes("ubereats.com")) {
      return res.status(400).json({
        success: false,
        error: "URL must be from ubereats.com",
      });
    }

    // Call Python scraper service
    console.log(`[*] Starting restaurant analysis for: ${restaurant_url}`);

    const response = await axios.post(
      `${PYTHON_SCRAPER_URL}/match-restaurant-inventory`,
      {
        restaurant_url: restaurant_url,
      },
      {
        timeout: 480000, // 8 minutes timeout (scraping can take time)
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data.success) {
      res.json({
        success: true,
        job_id: response.data.job_id,
        message: response.data.message,
        restaurant_url: restaurant_url,
        status_url: response.data.status_url,
        estimated_time: response.data.estimated_time,
        features: response.data.features,
        workflow_steps: response.data.workflow_steps,
      });
    } else {
      res.status(500).json({
        success: false,
        error: response.data.error || "Analysis failed",
      });
    }
  } catch (error) {
    console.error("[!] Restaurant analysis error:", error.message);

    if (error.code === "ECONNREFUSED") {
      return res.status(503).json({
        success: false,
        error:
          "Python scraper service is not available. Please ensure it's running on port 5005.",
      });
    }

    if (error.response) {
      return res.status(error.response.status).json({
        success: false,
        error: error.response.data.error || "Analysis failed",
      });
    }

    res.status(500).json({
      success: false,
      error: "Internal server error during restaurant analysis",
    });
  }
});

/**
 * GET /api/restaurant-matcher/job/:jobId
 * Get status of restaurant analysis job
 */
router.get("/job/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    // Call Python scraper service for job status
    const response = await axios.get(
      `${PYTHON_SCRAPER_URL}/inventory-matching-job/${jobId}`,
      {
        timeout: 30000,
      }
    );

    if (response.data.success) {
      const jobStatus = response.data.job_status;

      res.json({
        success: true,
        job_id: jobId,
        status: jobStatus.status,
        progress: jobStatus.progress,
        runtime_seconds: jobStatus.runtime_seconds,
        helpful_info: jobStatus.helpful_info,
        result: jobStatus.result,
        restaurant_name: jobStatus.progress?.restaurant_name,
        categories: jobStatus.progress?.restaurant_categories,
        hfd_matches: jobStatus.progress?.hfd_matches_found,
        llm_used: jobStatus.progress?.llm_categorization_used,
        openai_used: jobStatus.progress?.openai_enhancement_used,
      });
    } else {
      res.status(404).json({
        success: false,
        error: response.data.error || "Job not found",
      });
    }
  } catch (error) {
    console.error("[!] Job status error:", error.message);

    if (error.code === "ECONNREFUSED") {
      return res.status(503).json({
        success: false,
        error: "Python scraper service is not available",
      });
    }

    if (error.response && error.response.status === 404) {
      return res.status(404).json({
        success: false,
        error: "Job not found or expired",
      });
    }

    res.status(500).json({
      success: false,
      error: "Error fetching job status",
    });
  }
});

/**
 * GET /api/restaurant-matcher/jobs
 * List all active restaurant matching jobs
 */
router.get("/jobs", async (req, res) => {
  try {
    const response = await axios.get(
      `${PYTHON_SCRAPER_URL}/inventory-matching-jobs`,
      {
        timeout: 10000,
      }
    );

    res.json({
      success: true,
      active_jobs: response.data.active_jobs,
      total_jobs: response.data.total_jobs,
      system_info: response.data.system_info,
    });
  } catch (error) {
    console.error("[!] Jobs list error:", error.message);

    if (error.code === "ECONNREFUSED") {
      return res.status(503).json({
        success: false,
        error: "Python scraper service is not available",
      });
    }

    res.status(500).json({
      success: false,
      error: "Error fetching jobs list",
    });
  }
});

/**
 * GET /api/restaurant-matcher/health
 * Check if Python scraper service is healthy
 */
router.get("/health", async (req, res) => {
  try {
    const response = await axios.get(`${PYTHON_SCRAPER_URL}/health`, {
      timeout: 5000,
    });

    res.json({
      success: true,
      python_service: {
        status: "healthy",
        version: response.data.version,
        features: response.data.features,
        active_jobs: response.data.active_jobs,
        uptime_minutes: response.data.uptime_minutes,
      },
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      python_service: {
        status: "unavailable",
        error:
          error.code === "ECONNREFUSED" ? "Service not running" : error.message,
      },
    });
  }
});

module.exports = router;
