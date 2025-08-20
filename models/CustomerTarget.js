// models/CustomerTarget.js
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const CustomerTargetSchema = new Schema(
  {
    cardCode: {
      type: String,
      required: [true, "Customer code is required"],
      trim: true,
    },
    cardName: {
      type: String,
      required: [true, "Customer name is required"],
      trim: true,
    },
    targetAmount: {
      type: Number,
      required: [true, "Target amount is required"],
      min: 0,
    },
    // Instead of a deadline, we'll use a recurring monthly target model
    isRecurring: {
      type: Boolean,
      default: true,
    },
    // Period - monthly, quarterly, yearly
    period: {
      type: String,
      enum: ["monthly", "quarterly", "yearly"],
      default: "monthly",
    },
    // First day of the current period
    currentPeriodStart: {
      type: Date,
      default: function () {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1); // First day of current month
      },
    },
    // Last day of the current period
    currentPeriodEnd: {
      type: Date,
      default: function () {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth() + 1, 0); // Last day of current month
      },
    },
    // Keep the original deadline field for compatibility but it's not primary anymore
    deadline: {
      type: Date,
      default: function () {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth() + 1, 0); // Last day of current month
      },
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    achievedAmount: {
      type: Number,
      default: 0,
    },
    achievementRate: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["active", "completed", "expired", "paused"],
      default: "active",
    },
    salesAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Sales agent is required"],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    clientExistingAverage: {
      type: Number,
      default: 0,
      min: 0,
    },
    notes: {
      type: String,
      trim: true,
    },
    transactions: [
      {
        transactionId: {
          type: mongoose.Schema.Types.ObjectId,
          refPath: "transactions.transactionType",
        },
        transactionType: {
          type: String,
          enum: ["SalesOrder", "Invoice"],
          default: "Invoice",
        },
        docEntry: Number,
        docTotal: Number,
        docDate: Date,
        docType: {
          type: String,
          enum: ["order", "invoice"],
          default: "invoice",
        },
      },
    ],

    // Add field to track calculation method
    achievementSource: {
      type: String,
      enum: ["orders", "invoices"],
      default: "invoices",
    },

    // Add field to track last recalculation
    lastRecalculated: {
      type: Date,
      default: Date.now,
    },
    orders: [
      {
        orderId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "SalesOrder",
        },
        docEntry: Number,
        docTotal: Number,
        docDate: Date,
      },
    ],
    // New field to store historical performance data
    historicalPerformance: [
      {
        period: String, // e.g., "2023-01" for January 2023
        targetAmount: Number,
        achievedAmount: Number,
        achievementRate: Number,
      },
    ],
  },
  { timestamps: true }
);

// Helper method to get the current ongoing target amount
CustomerTargetSchema.methods.getCurrentTargetAmount = function () {
  return this.targetAmount;
};

// Add helper method to get current period string
CustomerTargetSchema.methods.getCurrentPeriodString = function () {
  const year = this.currentPeriodStart.getFullYear();
  const month = this.currentPeriodStart.getMonth() + 1;

  switch (this.period) {
    case "monthly":
      return `${year}-${String(month).padStart(2, "0")}`;
    case "quarterly":
      const quarter = Math.floor((month - 1) / 3) + 1;
      return `${year}-Q${quarter}`;
    case "yearly":
      return `${year}`;
    default:
      return `${year}-${String(month).padStart(2, "0")}`;
  }
};
CustomerTargetSchema.methods.startNewPeriod = function () {
  // Store the current period's performance in history BEFORE resetting
  const currentPeriod = this.getCurrentPeriodString();

  // Check if this period is already in history to avoid duplicates
  const existingHistory = this.historicalPerformance.find(
    (h) => h.period === currentPeriod
  );

  if (!existingHistory) {
    this.historicalPerformance.push({
      period: currentPeriod,
      targetAmount: this.targetAmount,
      achievedAmount: this.achievedAmount,
      achievementRate: this.achievementRate,
    });
  }

  // Calculate the NEW period dates based on the NEXT period, not current date
  let newPeriodStart, newPeriodEnd;

  if (this.period === "monthly") {
    // Move to next month
    const nextMonth = new Date(this.currentPeriodEnd);
    nextMonth.setDate(nextMonth.getDate() + 1); // Go to first day of next month
    
    newPeriodStart = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1);
    newPeriodEnd = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0);
  } else if (this.period === "quarterly") {
    // Move to next quarter
    const nextQuarter = new Date(this.currentPeriodEnd);
    nextQuarter.setDate(nextQuarter.getDate() + 1);
    
    const quarter = Math.floor(nextQuarter.getMonth() / 3);
    newPeriodStart = new Date(nextQuarter.getFullYear(), quarter * 3, 1);
    newPeriodEnd = new Date(nextQuarter.getFullYear(), (quarter + 1) * 3, 0);
  } else if (this.period === "yearly") {
    // Move to next year
    const nextYear = this.currentPeriodStart.getFullYear() + 1;
    newPeriodStart = new Date(nextYear, 0, 1);
    newPeriodEnd = new Date(nextYear, 11, 31);
  }

  // Update to the new period
  this.currentPeriodStart = newPeriodStart;
  this.currentPeriodEnd = newPeriodEnd;

  // Reset the current period's achievements
  this.achievedAmount = 0;
  this.achievementRate = 0;

  // Update the deadline for compatibility with existing code
  this.deadline = this.currentPeriodEnd;

  // Clear orders/transactions for the new period
  this.orders = [];
  this.transactions = [];

  // Update last recalculated timestamp
  this.lastRecalculated = new Date();

  return this;
};

// Pre-save middleware to calculate achievement rate
CustomerTargetSchema.pre("save", function (next) {
  if (this.targetAmount > 0) {
    this.achievementRate = (this.achievedAmount / this.targetAmount) * 100;
  }
  next();
});

module.exports = mongoose.model("CustomerTarget", CustomerTargetSchema);
