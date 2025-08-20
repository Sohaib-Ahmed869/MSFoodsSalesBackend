// routes/customerTargetRoutes.js
const express = require("express");
const router = express.Router();
const customerTargetController = require("../controllers/customerTarget.controller");
const targetScheduler = require("../services/targetScheduler");

const { auth, checkRole, updateLastLogin } = require("../middleware/auth");



// Get scheduler status
router.get("/scheduler/status", auth, checkRole(["admin"]), (req, res) => {
  try {
    const status = targetScheduler.getSchedulerStatus();
    res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error getting scheduler status",
      error: error.message,
    });
  }
});

// Trigger immediate rollover for testing
router.post(
  "/scheduler/trigger-rollover",
  auth,
  checkRole(["admin"]),
  async (req, res) => {
    try {
      const result = await targetScheduler.triggerImmediateRollover();
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error triggering rollover",
        error: error.message,
      });
    }
  }
);

// Rollover specific period type
router.post(
  "/scheduler/rollover/:periodType",
  auth,
  checkRole(["admin"]),
  async (req, res) => {
    try {
      const { periodType } = req.params;

      if (!["monthly", "quarterly", "yearly"].includes(periodType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid period type. Must be monthly, quarterly, or yearly",
        });
      }

      const result = await targetScheduler.rolloverTargetsByPeriod(periodType);
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: `Error rolling over ${periodType} targets`,
        error: error.message,
      });
    }
  }
);

// Update expired targets manually
router.post(
  "/scheduler/update-expired",
  auth,
  checkRole(["admin"]),
  async (req, res) => {
    try {
      const result = await targetScheduler.updateExpiredTargets();
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error updating expired targets",
        error: error.message,
      });
    }
  }
);

// Get sales manager dashboard - specific for sales managers
router.get(
  "/sales-manager/dashboard",
  auth,
  checkRole(["sales_manager", "admin"]),
  customerTargetController.getSalesManagerDashboard
);

router.post(
  "/migrate-to-2025",
  customerTargetController.migrateTargetsTo2025
);
// Create a new customer target - Admin and Sales Manager only
router.post(
  "/",
  auth,
  checkRole(["admin", "sales_manager"]),
  customerTargetController.createCustomerTarget
);

// Get all customer targets with filtering and pagination
router.get("/", auth, customerTargetController.getAllCustomerTargets);
router.get(
  "/:targetId/achievement-details",
  auth,
  customerTargetController.getTargetAchievementDetails
);
// Get a single customer target by ID
router.get("/:id", auth, customerTargetController.getCustomerTargetById);

// Update a customer target - Admin and Sales Manager only
router.put(
  "/:id",
  auth,
  checkRole(["admin", "sales_manager"]),
  customerTargetController.updateCustomerTarget
);

// Delete a customer target - Admin only
router.delete(
  "/:id",
  auth,
  checkRole(["admin"]),
  customerTargetController.deleteCustomerTarget
);

// Get customer targets for a specific agent
router.get(
  "/agent/:agentId",
  auth,
  customerTargetController.getAgentCustomerTargets
);

// Get customer targets for a specific customer
router.get(
  "/customer/:cardCode",
  auth,
  customerTargetController.getCustomerTargets // Updated function name
);

// Get dashboard summary of customer targets
router.get(
  "/dashboard/summary",
  auth,
  customerTargetController.getCustomerTargetsDashboard
);

// NEW ROUTES for recurring targets

// Manually trigger a target rollover for a specific target
router.post(
  "/:targetId/rollover",
  auth,
  checkRole(["admin", "sales_manager"]),
  customerTargetController.manualRolloverTarget
);

// Trigger rollover of all eligible targets
router.post("/rollover-all", auth, checkRole(["admin"]), async (req, res) => {
  try {
    const result = await customerTargetController.rolloverTargetPeriods();
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error rolling over targets",
      error: error.message,
    });
  }
});

// Get historical performance for a specific target
router.get("/:id/history", auth, async (req, res) => {
  try {
    const target = await customerTargetController.getCustomerTargetById(req, {
      params: { id: req.params.id },
      json: (data) => data,
    });

    if (!target.success) {
      return res.status(404).json({
        success: false,
        message: "Target not found",
      });
    }

    // Extract just the historical performance data
    res.status(200).json({
      success: true,
      targetId: req.params.id,
      customerName: target.data.cardName,
      period: target.data.period,
      historicalPerformance: target.data.historicalPerformance || [],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching target history",
      error: error.message,
    });
  }
});

module.exports = router;
