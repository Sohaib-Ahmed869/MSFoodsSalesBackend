// routes/lead.routes.js
const express = require("express");
const multer = require("multer");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const { auth, checkRole } = require("../middleware/auth");
const leadController = require("../controllers/lead2.controller");

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log("Created uploads directory in lead routes:", uploadsDir);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const fileExt = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + fileExt);
  },
});

// File filter to allow specific file types
const fileFilter = (req, file, cb) => {
  const allowedExtensions = [".xlsx", ".xls", ".csv", ".txt"];
  const fileExt = path.extname(file.originalname).toLowerCase();

  if (allowedExtensions.includes(fileExt)) {
    cb(null, true);
  } else {
    cb(new Error("Only Excel, CSV, and text files are allowed"), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB file size limit
  },
});

// Lead CRUD Operations
router.get("/", auth, leadController.getLeads);
router.get(
  "/paginated",
  auth,
  leadController.getLeadsPaginated
);
router.get("/stats", auth, leadController.getLeadStats);
router.get(
  "/unassigned",
  auth,
  checkRole(["admin", "sales_manager", "sales_agent"]),
  leadController.getUnassignedLeads
);
router.get("/:id", auth, leadController.getLeadById);

// Lead Management
router.post(
  "/",
  auth,
  checkRole(["admin", "sales_manager", "sales_agent"]),
  leadController.createLead
);
router.put("/:id", auth, leadController.updateLead);
router.delete(
  "/:id",
  auth,
  checkRole(["admin", "sales_manager", "sales_agent"]),
  leadController.deleteLead
);

// Lead Assignment
router.post(
  "/:id/assign",
  auth,
  checkRole(["admin", "sales_manager", "sales_agent"]),
  leadController.assignLead
);
router.post(
  "/bulk-assign",
  auth,
  checkRole(["admin", "sales_manager", "sales_agent"]),
  leadController.bulkAssignLeads
);
router.post(
  "/:id/unassign",
  auth,
 checkRole(["admin", "sales_manager", "sales_agent"]),
  leadController.unassignLead
);

// Lead Status and Tags Management
router.put("/:id/status", auth, leadController.updateLeadStatus);
router.put("/:id/tags", auth, leadController.updateLeadTags);

// Lead Conversion
router.post("/:id/convert", auth, leadController.convertLeadToCustomer);
router.get(
  "/:id/conversion-preview",
  auth,
  leadController.previewLeadConversion
);

// Lead Activities and Notes
router.post("/:id/notes", auth, leadController.addLeadNote);
router.put("/:id/follow-up", auth, leadController.setNextFollowUp);

// Lead Import/Export
router.post(
  "/import",
  auth,
 checkRole(["admin", "sales_manager", "sales_agent"]),
  upload.single("file"),
  leadController.importLeads
);
router.post("/export", auth, leadController.exportLeads);

// Lead Analytics
router.get("/analytics/funnel", auth, leadController.getLeadFunnelAnalytics);
router.get("/analytics/tags", auth, leadController.getLeadTagAnalytics);
router.get(
  "/analytics/agent/:agentId",
  auth,
  leadController.getAgentLeadAnalytics
);

// Lead Filtering
router.get("/filter/by-status/:status", auth, leadController.getLeadsByStatus);
router.get("/filter/by-tag/:tag", auth, leadController.getLeadsByTag);
router.get("/filter/by-agent/:agentId", auth, leadController.getLeadsByAgent);

// Lead Search
router.post("/search", auth, leadController.searchLeads);

// Lead Duplicate Management
router.get("/duplicates/check", auth, leadController.checkDuplicateLeads);
router.post(
  "/duplicates/merge",
  auth,
  checkRole(["admin", "sales_manager", "sales_agent"]),
  leadController.mergeDuplicateLeads
);

module.exports = router;
