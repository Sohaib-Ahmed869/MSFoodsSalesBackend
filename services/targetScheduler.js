// services/targetScheduler.js
const cron = require("node-cron");
const CustomerTarget = require("../models/CustomerTarget");
const {
  rolloverTargetPeriods,
} = require("../controllers/customerTarget.controller");

class TargetScheduler {
  constructor() {
    this.scheduledJobs = new Map();
  }

  getNextPeriodString(currentPeriodEnd, periodType) {
  const nextPeriodStart = new Date(currentPeriodEnd);
  nextPeriodStart.setDate(nextPeriodStart.getDate() + 1); // Move to first day of next period
  
  return this.getPeriodString(nextPeriodStart, periodType);
}

// ONE-TIME RECOVERY FUNCTION: Create July targets based on current August targets
async recoverJulyTargets() {
  console.log("🔄 Starting July targets recovery...");
  
  try {
    // Find all current August targets (assuming they're currently active)
    const augustTargets = await CustomerTarget.find({
      isRecurring: true,
      status: "active",
      period: "monthly",
      // Current period should be August 2024
      currentPeriodStart: {
        $gte: new Date("2025-08-01"),
        $lt: new Date("2025-09-01")
      }
    }).populate("salesAgent", "firstName lastName email");

    console.log(`Found ${augustTargets.length} August targets to create July versions for`);

    let createdCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    for (const augustTarget of augustTargets) {
      try {
        // Check if July target already exists for this customer/agent combination
        const existingJulyTarget = await CustomerTarget.findOne({
          cardCode: augustTarget.cardCode,
          salesAgent: augustTarget.salesAgent._id,
          period: "monthly",
          currentPeriodStart: {
            $gte: new Date("2024-07-01"),
            $lt: new Date("2024-08-01")
          }
        });

        if (existingJulyTarget) {
          console.log(`⚠️ July target already exists for ${augustTarget.cardName}, skipping`);
          skippedCount++;
          continue;
        }

        // Create July target based on August target
        const julyTarget = new CustomerTarget({
          cardCode: augustTarget.cardCode,
          cardName: augustTarget.cardName,
          targetAmount: augustTarget.targetAmount,
          isRecurring: augustTarget.isRecurring,
          period: "monthly",
          currentPeriodStart: new Date("2024-07-01"),
          currentPeriodEnd: new Date("2024-07-31"),
          deadline: new Date("2024-07-31"),
          startDate: new Date("2024-07-01"),
          achievedAmount: 0, // You may want to recalculate this from actual July data
          achievementRate: 0,
          status: "completed", // Assuming July is over
          salesAgent: augustTarget.salesAgent._id,
          createdBy: augustTarget.createdBy,
          clientExistingAverage: augustTarget.clientExistingAverage,
          notes: `Recovered July target based on August target - ${augustTarget.notes || ''}`,
          achievementSource: augustTarget.achievementSource,
          lastRecalculated: new Date(),
          orders: [], // Empty for now, you may want to populate with actual July orders
          transactions: [], // Empty for now, you may want to populate with actual July transactions
          historicalPerformance: []
        });

        await julyTarget.save();
        createdCount++;
        
        console.log(`✅ Created July target for ${augustTarget.cardName} (${augustTarget.salesAgent.firstName} ${augustTarget.salesAgent.lastName})`);
      } catch (error) {
        errorCount++;
        console.error(`❌ Error creating July target for ${augustTarget._id}:`, error);
      }
    }

    console.log("🔄 Now updating August targets to have correct historical data...");
    
    // Update August targets to have July in their historical performance
    let historyUpdatedCount = 0;
    
    for (const augustTarget of augustTargets) {
      try {
        // Check if July period is already in history
        const julyPeriod = "2024-07";
        const existingJulyHistory = augustTarget.historicalPerformance.find(
          (h) => h.period === julyPeriod
        );
        
        if (!existingJulyHistory) {
          // Add July to historical performance with zero values (you may want to update with actual data)
          augustTarget.historicalPerformance.push({
            period: julyPeriod,
            targetAmount: augustTarget.targetAmount,
            achievedAmount: 0, // You may want to calculate actual July achievement
            achievementRate: 0
          });
          
          await augustTarget.save();
          historyUpdatedCount++;
        }
      } catch (error) {
        console.error(`❌ Error updating history for ${augustTarget._id}:`, error);
      }
    }

    return {
      success: true,
      totalAugustTargets: augustTargets.length,
      julyTargetsCreated: createdCount,
      skipped: skippedCount,
      errors: errorCount,
      historyUpdated: historyUpdatedCount,
      message: `Recovery completed: Created ${createdCount} July targets, updated ${historyUpdatedCount} August targets with July history`
    };
  } catch (error) {
    console.error("Error in July recovery:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Method to manually trigger the recovery (call this once)
async triggerJulyRecovery() {
  console.log("🚨 MANUAL RECOVERY: Starting July targets recovery...");
  const result = await this.recoverJulyTargets();
  console.log("📊 Recovery Result:", result);
  return result;
}

  // Initialize all scheduled jobs
  initializeScheduler() {
    console.log("🎯 Initializing Target Scheduler...");

    // Schedule monthly rollover check (runs at 12:01 AM on the 1st of every month)
    this.scheduleMonthlyRollover();

    // Schedule quarterly rollover check (runs at 12:05 AM on the 1st of Jan, Apr, Jul, Oct)
    this.scheduleQuarterlyRollover();

    // Schedule yearly rollover check (runs at 12:10 AM on January 1st)
    this.scheduleYearlyRollover();

    // Schedule daily check for expired targets (runs at 1:00 AM daily)
    this.scheduleDailyTargetCheck();

    console.log("✅ Target Scheduler initialized successfully");
  }

  // Monthly rollover - runs at 12:01 AM on the 1st of every month
  scheduleMonthlyRollover() {
    const job = cron.schedule(
      "1 0 1 * *",
      async () => {
        const timestamp = new Date().toISOString();
        console.log(`🔄 [${timestamp}] Running monthly target rollover...`);
        try {
          const result = await this.rolloverTargetsByPeriod("monthly");
          console.log(
            `✅ [${timestamp}] Monthly target rollover completed:`,
            result
          );
        } catch (error) {
          console.error(
            `❌ [${timestamp}] Error in monthly target rollover:`,
            error
          );
        }
      },
      {
        scheduled: false,
        timezone: "UTC",
      }
    );

    this.scheduledJobs.set("monthly-rollover", job);
    job.start();
    console.log("📅 Monthly rollover scheduled");
  }

  // Quarterly rollover - runs at 12:05 AM on the 1st of Jan, Apr, Jul, Oct
  scheduleQuarterlyRollover() {
    const job = cron.schedule(
      "5 0 1 1,4,7,10 *",
      async () => {
        console.log("🔄 Running quarterly target rollover...");
        try {
          await this.rolloverTargetsByPeriod("quarterly");
          console.log("✅ Quarterly target rollover completed");
        } catch (error) {
          console.error("❌ Error in quarterly target rollover:", error);
        }
      },
      {
        scheduled: false,
        timezone: "UTC",
      }
    );

    this.scheduledJobs.set("quarterly-rollover", job);
    job.start();
    console.log("📅 Quarterly rollover scheduled");
  }

  // Yearly rollover - runs at 12:10 AM on January 1st
  scheduleYearlyRollover() {
    const job = cron.schedule(
      "10 0 1 1 *",
      async () => {
        console.log("🔄 Running yearly target rollover...");
        try {
          await this.rolloverTargetsByPeriod("yearly");
          console.log("✅ Yearly target rollover completed");
        } catch (error) {
          console.error("❌ Error in yearly target rollover:", error);
        }
      },
      {
        scheduled: false,
        timezone: "UTC",
      }
    );

    this.scheduledJobs.set("yearly-rollover", job);
    job.start();
    console.log("📅 Yearly rollover scheduled");
  }

  // Daily check for expired targets - runs at 1:00 AM daily
  scheduleDailyTargetCheck() {
    const job = cron.schedule(
      "0 1 * * *",
      async () => {
        console.log("🔍 Running daily target status check...");
        try {
          await this.updateExpiredTargets();
          console.log("✅ Daily target status check completed");
        } catch (error) {
          console.error("❌ Error in daily target check:", error);
        }
      },
      {
        scheduled: false,
        timezone: "UTC",
      }
    );

    this.scheduledJobs.set("daily-check", job);
    job.start();
    console.log("📅 Daily target check scheduled");
  }

 // Rollover targets for a specific period type
async rolloverTargetsByPeriod(periodType) {
  try {
    const now = new Date();

    // Find all recurring targets of this period type that need rollover
    const targetsToRollover = await CustomerTarget.find({
      isRecurring: true,
      status: "active",
      period: periodType,
      currentPeriodEnd: { $lt: now },
    }).populate("salesAgent", "firstName lastName email");

    console.log(
      `Found ${targetsToRollover.length} ${periodType} targets to rollover`
    );

    let rolledOverCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    for (const target of targetsToRollover) {
      try {
        // Store current period performance in history before rollover
        const currentPeriod = this.getPeriodString(
          target.currentPeriodStart,
          periodType
        );

        // SAFETY CHECK: Only rollover if the current period hasn't already been processed
        const existingHistory = target.historicalPerformance.find(
          (h) => h.period === currentPeriod
        );

        // Additional check: Make sure we're not accidentally rolling over the same period twice
        const expectedNextPeriod = this.getNextPeriodString(target.currentPeriodEnd, periodType);
        const nextPeriodAlreadyExists = target.historicalPerformance.find(
          (h) => h.period === expectedNextPeriod
        );

        if (nextPeriodAlreadyExists) {
          console.log(`⚠️ Target ${target._id} already has next period ${expectedNextPeriod}, skipping rollover`);
          skippedCount++;
          continue;
        }

        // Only add to history if it's not already there
        if (!existingHistory) {
          target.historicalPerformance.push({
            period: currentPeriod,
            targetAmount: target.targetAmount,
            achievedAmount: target.achievedAmount,
            achievementRate: target.achievementRate,
          });
        }

        // Start new period
        target.startNewPeriod();
        await target.save();

        rolledOverCount++;
        console.log(
          `✅ Rolled over ${periodType} target for ${target.cardName} (${target.salesAgent.firstName} ${target.salesAgent.lastName}) from ${currentPeriod} to ${this.getPeriodString(target.currentPeriodStart, periodType)}`
        );
      } catch (error) {
        errorCount++;
        console.error(`❌ Error rolling over target ${target._id}:`, error);
      }
    }

    return {
      success: true,
      periodType,
      totalFound: targetsToRollover.length,
      rolledOver: rolledOverCount,
      skipped: skippedCount,
      errors: errorCount,
      message: `Successfully rolled over ${rolledOverCount} ${periodType} targets, skipped ${skippedCount}`,
    };
  } catch (error) {
    console.error(`Error in ${periodType} rollover:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

  // Update expired targets
  async updateExpiredTargets() {
    try {
      const now = new Date();

      // Find active targets that have passed their deadline
      const expiredTargets = await CustomerTarget.find({
        status: "active",
        currentPeriodEnd: { $lt: now },
        isRecurring: false, // Only non-recurring targets should be marked as expired
      });

      let updatedCount = 0;

      for (const target of expiredTargets) {
        target.status = "expired";
        await target.save();
        updatedCount++;
      }

      console.log(`Updated ${updatedCount} targets to expired status`);

      return {
        success: true,
        updatedCount,
        message: `Updated ${updatedCount} targets to expired status`,
      };
    } catch (error) {
      console.error("Error updating expired targets:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Helper function to generate period string
  getPeriodString(date, periodType) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    switch (periodType) {
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
  }

  // Manual trigger for immediate rollover (for testing or manual execution)
  async triggerImmediateRollover() {
    console.log("🔄 Triggering immediate rollover for all periods...");

    const results = await Promise.all([
      this.rolloverTargetsByPeriod("monthly"),
      this.rolloverTargetsByPeriod("quarterly"),
      this.rolloverTargetsByPeriod("yearly"),
    ]);

    return {
      success: true,
      results,
      message: "Immediate rollover completed",
    };
  }

  // Stop all scheduled jobs
  stopScheduler() {
    console.log("🛑 Stopping Target Scheduler...");

    for (const [name, job] of this.scheduledJobs) {
      job.stop();
      console.log(`Stopped ${name}`);
    }

    this.scheduledJobs.clear();
    console.log("✅ Target Scheduler stopped");
  }

  // Get scheduler status
  getSchedulerStatus() {
    const jobs = [];

    for (const [name, job] of this.scheduledJobs) {
      jobs.push({
        name,
        running: job.running,
        scheduled: job.scheduled,
      });
    }

    return {
      totalJobs: this.scheduledJobs.size,
      jobs,
    };
  }
}

// Export singleton instance
const targetScheduler = new TargetScheduler();
module.exports = targetScheduler;
