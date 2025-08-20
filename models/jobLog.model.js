// models/jobLog.model.js
const mongoose = require("mongoose");

const jobLogSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
    },
    jobType: {
      type: String,
      required: true,
      enum: [
        "SCHEDULED_SYNC",
        "MANUAL_SYNC",
        "INVOICE_SYNC",
        "PAYMENT_SYNC",
        "ORDER_SYNC",
        "CREDITNOTE_SYNC",
        "RETURN_SYNC",
        "PURCHASE_SYNC",
      ],
    },
    status: {
      type: String,
      required: true,
      enum: ["RUNNING", "COMPLETED", "FAILED", "PARTIAL_SUCCESS"],
      default: "RUNNING",
    },
    startTime: {
      type: Date,
      required: true,
      default: Date.now,
    },
    endTime: {
      type: Date,
    },
    duration: {
      type: Number, // in milliseconds
    },

    // Job Details
    endpoint: String,
    modelName: String,

    // Job Statistics
    stats: {
      totalProcessed: { type: Number, default: 0 },
      created: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
      errors: { type: Number, default: 0 },
      period: String,
    },

    // Error Details
    errors: [
      {
        DocEntry: String,
        error: String,
        type: String,
        timestamp: { type: Date, default: Date.now },
      },
    ],

    // Logs Array
    logs: [
      {
        level: {
          type: String,
          enum: ["INFO", "WARN", "ERROR", "DEBUG"],
          required: true,
        },
        message: {
          type: String,
          required: true,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
        metadata: mongoose.Schema.Types.Mixed,
      },
    ],

    // Trigger Information
    triggeredBy: {
      type: String,
      enum: ["CRON", "MANUAL", "API"],
      required: true,
    },
    userInfo: {
      ip: String,
      userAgent: String,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
jobLogSchema.index({ startTime: -1 });
jobLogSchema.index({ jobType: 1, startTime: -1 });
jobLogSchema.index({ status: 1 });
jobLogSchema.index({ triggeredBy: 1 });

// Methods
jobLogSchema.methods.addLog = function (level, message, metadata = null) {
  this.logs.push({
    level,
    message,
    metadata,
    timestamp: new Date(),
  });
  return this.save();
};

jobLogSchema.methods.complete = function (stats = {}, errors = []) {
  this.endTime = new Date();
  this.duration = this.endTime - this.startTime;
  this.stats = { ...this.stats, ...stats };
  this.errors = errors;

  if (errors.length > 0 && stats.created > 0) {
    this.status = "PARTIAL_SUCCESS";
  } else if (errors.length > 0) {
    this.status = "FAILED";
  } else {
    this.status = "COMPLETED";
  }

  return this.save();
};

jobLogSchema.methods.fail = function (errorMessage) {
  this.endTime = new Date();
  this.duration = this.endTime - this.startTime;
  this.status = "FAILED";
  this.addLog("ERROR", errorMessage);
  return this.save();
};

// Static methods
jobLogSchema.statics.createJob = function (jobData) {
  const jobId = `${jobData.jobType}_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;

  return this.create({
    jobId,
    ...jobData,
    startTime: new Date(),
  });
};

jobLogSchema.statics.getJobStats = function (days = 7) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return this.aggregate([
    { $match: { startTime: { $gte: startDate } } },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        avgDuration: { $avg: "$duration" },
      },
    },
  ]);
};

const JobLog = mongoose.model("JobLog", jobLogSchema);

module.exports = JobLog;
