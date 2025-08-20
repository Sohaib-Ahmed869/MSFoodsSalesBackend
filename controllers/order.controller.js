// controllers/orderController.js - Update to remove warehouse/stock checks
const SalesOrder = require("../models/SalesOrder");
const User = require("../models/User");
const Item = require("../models/item");
const customerTargetController = require("./customerTarget.controller");
const {
  formatOrderForSAP,
  createSalesOrderInSAP,
  getSalesOrderFromSAP,
  checkBusinessPartnerExists,
} = require("../utils/sapB1Integration");
const XLSX = require("xlsx");

// Add these to orderController.js

const nodemailer = require("nodemailer");
const axios = require("axios");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    email: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD,
  },
});

// Generate payment link for sales order
exports.generatePaymentLinkForOrder = async (req, res) => {
  try {
    const { docNum } = req.params;
    const { email } = req.body;

    const order = await SalesOrder.findOne({ DocNum: docNum });
    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Sales order not found",
      });
    }

    const customer_account_info = [
      {
        unique_account_identifier: order.CardCode,
      },
    ];

    const customer_account_info_2 =
      '{"payment_history_simple":' +
      JSON.stringify(customer_account_info) +
      "}";

    const account_info = Buffer.from(customer_account_info_2).toString(
      "base64"
    );

    const paymentLinkRequest = {
      reference: `SO-${order.DocNum}`,
      amount: {
        value: Math.round(order.DocTotal * 100),
        currency: order.DocCurrency || "EUR",
      },
      description: `Payment for Sales Order #${order.DocNum}`,
      countryCode: "FR",

      merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT,
      shopperReference: order.CardCode,
      additionalData: {
        "openinvoicedata.merchantData": account_info,
      },
      allowedPaymentMethods: ["klarna_b2b"],
      company: {
        name: order.CardName,
      },
      shopperEmail: email,
      lineItems: order.DocumentLines.map((line) => ({
        id: line.LineNum,
        quantity: line.Quantity,
        amountIncludingTax: Math.round(line.PriceAfterVAT * 100),
        amountExcludingTax: Math.round(line.Price * 100),
        taxAmount: Math.round((line.PriceAfterVAT - line.Price) * 100),
        taxPercentage: Math.round(
          (line.PriceAfterVAT / line.Price - 1) * 10000
        ),
        description: line.ItemDescription,
      })),
    };

    const response = await axios.post(
      `${process.env.ADYEN_API_BASE_URL}/paymentLinks`,
      paymentLinkRequest,
      {
        headers: {
          "X-API-KEY": process.env.ADYEN_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const paymentLink = response.data.url;
    const paymentId = response.data.id;
    const expiryDate = new Date(response.data.expiresAt).toISOString();

    order.Payment_id = paymentId;
    order.Link_sent = true;

    // Create line items table for email
    const lineItemsHtml = order.DocumentLines.map(
      (line) => `
      <tr>
        <td style="border: 1px solid #ddd; padding: 8px;">${line.ItemCode}</td>
        <td style="border: 1px solid #ddd; padding: 8px;">${line.ItemDescription
        }</td>
        <td style="border: 1px solid #ddd; padding: 8px;">${line.Quantity}</td>
        <td style="border: 1px solid #ddd; padding: 8px;">€${line.Price.toFixed(
          2
        )}</td>
        <td style="border: 1px solid #ddd; padding: 8px;">€${line.LineTotal.toFixed(
          2
        )}</td>
      </tr>
    `
    ).join("");

    const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Demande de Paiement pour la Commande n°${order.DocNum
      }</h2>
      <p>Chère ${order.CardName},</p>
      <p>Veuillez trouver ci-dessous le lien de paiement pour votre commande :</p>
      
      <div style="margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 5px;">
        <a href="${paymentLink}" style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px; font-weight: bold;">
          Cliquez ici pour effectuer votre paiement
        </a>
      </div>
      
      <p><strong>Le lien de paiement expirera le ${expiryDate.split("T")[0]
      }.</strong></p>
      
      <h3 style="color: #333;">Détails de la commande :</h3>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <thead>
          <tr style="background-color: #f8f9fa;">
            <th style="border: 1px solid #ddd; padding: 12px; text-align: left;">Code Article</th>
            <th style="border: 1px solid #ddd; padding: 12px; text-align: left;">Description</th>
            <th style="border: 1px solid #ddd; padding: 12px; text-align: left;">Quantité</th>
            <th style="border: 1px solid #ddd; padding: 12px; text-align: left;">Prix Unitaire</th>
            <th style="border: 1px solid #ddd; padding: 12px; text-align: left;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${lineItemsHtml}
        </tbody>
        <tfoot>
          <tr style="font-weight: bold; background-color: #f8f9fa;">
            <td colspan="4" style="border: 1px solid #ddd; padding: 12px; text-align: right;">Total de la commande :</td>
            <td style="border: 1px solid #ddd; padding: 12px;">€${order.DocTotal.toFixed(
        2
      )}</td>
          </tr>
        </tfoot>
      </table>
      
      <p>Si vous avez des questions concernant cette commande, n'hésitez pas à nous contacter.</p>
      <p>Cordialement,<br>L'équipe Halal Food Service</p>
    </div>
    `;

    await transporter.sendMail({
      from: process.env.SMTP_EMAIL,
      to: email,
      subject: `Payment Link for Sales Order #${order.DocNum}`,
      html: emailHtml,
    });

    await order.save();

    res.status(200).json({
      success: true,
      message: "Payment link generated and sent successfully",
      paymentLink,
    });
  } catch (error) {
    console.error("Error in generatePaymentLinkForOrder:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate payment link",
      details: error.message,
    });
  }
};

// Get payment update for sales order
exports.getUpdateOnPaymentLinkForOrder = async (req, res) => {
  try {
    const { docNum } = req.params;
    const order = await SalesOrder.findOne({ DocNum: docNum });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Sales order not found",
      });
    }

    if (!order.Payment_id) {
      return res.status(400).json({
        success: false,
        error: "No payment link found for this order",
      });
    }

    const response = await axios.get(
      `${process.env.ADYEN_API_BASE_URL}/paymentLinks/${order.Payment_id}`,
      {
        headers: {
          "X-API-KEY": process.env.ADYEN_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const paymentStatus = response.data.status;
    order.payment_status = paymentStatus;
    await order.save();

    res.status(200).json({
      success: true,
      message: "Payment status updated successfully",
      paymentStatus,
      paymentData: response.data,
    });
  } catch (error) {
    console.error("Error in getUpdateOnPaymentLinkForOrder:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update payment status",
      details: error.message,
    });
  }
};
// Update the bulkImportSalesOrders function to mark imported orders properly

exports.bulkImportSalesOrders = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Excel file is required",
      });
    }

    const startTime = Date.now();
    console.log("Starting Sales Orders Excel import...");

    // Parse Excel file
    const workbook = XLSX.read(req.file.buffer, {
      cellDates: true,
      cellNF: true,
      cellStyles: true,
    });

    // Get the first worksheet
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON with headers
    const excelRows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      blankrows: false,
    });

    if (excelRows.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Excel file must contain headers and data rows",
      });
    }

    // Extract headers and data
    const headers = excelRows[0];
    const dataRows = excelRows.slice(1);

    // Convert to objects using headers
    const processedRows = dataRows.map((row) => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] || "";
      });
      return obj;
    });

    console.log(`Parsed ${processedRows.length} rows from Excel`);

    // Group Excel rows by Internal Number to create order documents
    const orderGroups = {};

    processedRows.forEach((row) => {
      const docId = row["Internal Number"];
      if (!docId) return;

      if (!orderGroups[docId]) {
        orderGroups[docId] = {
          mainData: row,
          lines: [],
        };
      }

      // Add line item if it has valid data
      if (row["Item No."] && row["Item/Service Description"]) {
        orderGroups[docId].lines.push({
          LineNum: row["Row Number"] || 0,
          ItemCode: row["Item No."],
          ItemDescription: row["Item/Service Description"],
          Quantity: row["Quantity"] || 0,
          Price: row["Price after Discount"] || 0,
          PriceAfterVAT: row["Gross Price after Discount"] || 0,
          Currency: row["Price Currency"] || "EUR",
          LineTotal: row["Row Total"] || 0,
          UnitPrice: row["Unit Price"] || 0,
          VatGroup: null,
        });
      }
    });

    const totalOrders = Object.keys(orderGroups).length;
    console.log(`Grouped into ${totalOrders} sales orders`);

    // Get existing DocEntry values in bulk
    const docEntries = Object.keys(orderGroups).map((id) => parseInt(id));
    const existingOrders = await SalesOrder.find(
      { DocEntry: { $in: docEntries } },
      { DocEntry: 1 }
    ).lean();

    const existingDocEntries = new Set(
      existingOrders.map((order) => order.DocEntry)
    );
    console.log(`Found ${existingDocEntries.size} existing sales orders`);

    // Prepare new orders for bulk insert
    const newOrders = [];

    Object.entries(orderGroups).forEach(([docId, group]) => {
      const docEntry = parseInt(docId);

      // Skip if order already exists
      if (existingDocEntries.has(docEntry)) {
        return;
      }

      const row = group.mainData;

      // Parse dates - handle Excel date formats
      const parseDate = (dateValue) => {
        if (!dateValue) return null;

        // If it's already a Date object (from Excel)
        if (dateValue instanceof Date) {
          return dateValue;
        }

        // If it's a string, try to parse it
        if (typeof dateValue === "string") {
          const parts = dateValue.split("/");
          if (parts.length === 3) {
            return new Date(
              `20${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(
                2,
                "0"
              )}`
            );
          }
          return new Date(dateValue);
        }

        // If it's a number (Excel serial date)
        if (typeof dateValue === "number") {
          return XLSX.SSF.parse_date_code(dateValue);
        }

        return new Date(dateValue);
      };

      // Determine order status
      const docTotal = parseFloat(row["Document Total"]) || 0;
      const paidToDate = parseFloat(row["Paid to Date"]) || 0;
      const isCancelled = row["Cancelled"] === "Y";
      const orderStatus = row["OrderStatus"] || (isCancelled ? "C" : "O");

      // Create sales order document
      const salesOrder = {
        // Required fields
        DocEntry: docEntry,
        DocNum: parseInt(row["Document Number"]) || docEntry,

        // Customer info
        CardCode: row["Customer/Supplier No."] || "",
        CardName: row["Customer/Supplier Name"] || "",

        // Financial data
        DocTotal: docTotal,
        PaidToDate: paidToDate,
        DocCurrency: row["Price Currency"] || "EUR",

        // Dates
        DocDate: parseDate(row["Posting Date"]),
        CreationDate: parseDate(row["Posting Date"]),

        // Address
        Address: row["Ship-to Description"] || "",

        // Document status and cancellation
        DocumentStatus: orderStatus,
        Cancelled: isCancelled ? "Y" : "N",

        // Additional computed fields
        VatSum: parseFloat(row["Total Tax - Row"]) || 0,

        // Document lines
        DocumentLines: group.lines,

        // *** IMPORTANT: Mark as already synced with SAP and imported ***
        SyncedWithSAP: true, // These orders came FROM SAP
        LocalStatus: "ImportedFromSAP", // Custom status to indicate origin
        SAPDocEntry: docEntry, // Use DocEntry as SAP reference

        // *** CRITICAL: No salesAgent - indicates SAP origin ***
        // salesAgent: null (this is implicit - don't set it)

        // Timestamps
        CreationDate: parseDate(row["Posting Date"]) || new Date(),
        UpdateDate: new Date(),

        // Add import metadata
        ImportDate: new Date(),
        ImportSource: "SAP_B1_Bulk_Import",
        U_Notes: "Imported from SAP B1 bulk export",
      };

      newOrders.push(salesOrder);
    });

    console.log(
      `Prepared ${newOrders.length} new sales orders for import (marked as SAP origin)`
    );

    // Bulk insert new orders
    let insertedCount = 0;
    let insertedDocNums = [];
    if (newOrders.length > 0) {
      try {
        const result = await SalesOrder.insertMany(newOrders, {
          ordered: false, // Continue even if some fail
          lean: true,
        });
        insertedCount = result.length;
        insertedDocNums = result.map((order) => order.DocNum);
        console.log(
          `Successfully inserted ${insertedCount} SAP-origin sales orders`
        );
      } catch (error) {
        // Handle partial success in bulk insert
        if (error.writeErrors) {
          insertedCount = newOrders.length - error.writeErrors.length;
          // Get DocNums of successfully inserted orders
          const failedIndices = new Set(
            error.writeErrors.map((err) => err.index)
          );
          insertedDocNums = newOrders
            .filter((_, index) => !failedIndices.has(index))
            .map((order) => order.DocNum);
          console.log(
            `Partial success: ${insertedCount} inserted, ${error.writeErrors.length} failed`
          );
        } else {
          throw error;
        }
      }
    }

    const endTime = Date.now();
    const processingTime = ((endTime - startTime) / 1000).toFixed(2);

    return res.status(200).json({
      success: true,
      message:
        "Sales Orders Excel import completed - orders marked as SAP origin",
      data: {
        totalRowsProcessed: processedRows.length,
        totalOrdersInExcel: totalOrders,
        existingOrders: existingDocEntries.size,
        newOrdersInserted: insertedCount,
        skippedOrders: totalOrders - insertedCount,
        processingTimeSeconds: processingTime,
        insertedOrderDocNums: insertedDocNums,
        note: "Imported orders are marked as SAP origin and will not be synced back to SAP",
      },
    });
  } catch (error) {
    console.error("Error in sales orders bulk import:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to import Sales Orders Excel file",
      error: error.message,
    });
  }
};
// Add this helper function
async function updateSalesAgentStats(salesAgentId, order) {
  try {
    const agent = await User.findById(salesAgentId);
    if (!agent || agent.role !== "sales_agent") return;

    // Get current month and year
    const orderDate = order.DocDate;
    const month = orderDate.toLocaleString("default", { month: "short" });
    const year = orderDate.getFullYear();

    // Calculate order value
    const orderValue = order.DocTotal;

    // Find or create entry for current month/year in salesHistory
    let salesEntry = agent.salesHistory.find(
      (entry) => entry.month === month && entry.year === year
    );

    if (!salesEntry) {
      // Create new entry if it doesn't exist
      agent.salesHistory.push({
        month,
        year,
        orderCount: 1,
        totalValue: orderValue,
        orders: [order._id],
      });
    } else {
      // Update existing entry
      salesEntry.orderCount += 1;
      salesEntry.totalValue += orderValue;
      salesEntry.orders.push(order._id);
    }

    // Update target achievement
    let targetEntry = agent.targetHistory.find(
      (entry) => entry.month === month && entry.year === year
    );

    if (!targetEntry) {
      // Create new target entry with current target
      agent.targetHistory.push({
        month,
        year,
        target: agent.target,
        achieved: orderValue,
        achievementRate:
          agent.target > 0 ? (orderValue / agent.target) * 100 : 0,
      });
    } else {
      // Update existing target entry
      targetEntry.achieved += orderValue;
      targetEntry.achievementRate =
        targetEntry.target > 0
          ? (targetEntry.achieved / targetEntry.target) * 100
          : 0;
    }

    // Update overall targetAchieved
    agent.targetAchieved += orderValue;

    // Save changes
    await agent.save();
  } catch (error) {
    console.error("Error updating sales agent stats:", error);
  }
}

async function updateSalesAgentAchievement(salesAgentId, order) {
  const agent = await User.findById(salesAgentId);
  if (!agent) return;

  // You might want to add some logic here based on your business rules
  // For example, maybe achievements only count when orders are pushed to SAP

  // Maybe increment a counter of successfully synced orders
  agent.syncedOrderCount = (agent.syncedOrderCount || 0) + 1;

  await agent.save();
}

// Helper function to push order to SAP
// Replace the existing pushOrderToSAPInternal function

async function pushOrderToSAPInternal(order) {
  try {
    // Format the order for SAP B1 - Note this is now async
    const sapOrder = await formatOrderForSAP(order);

    try {
      // First check if business partner exists in SAP
      const businessPartnerExists = await checkBusinessPartnerExists(
        order.CardCode
      );

      if (!businessPartnerExists) {
        // Update order to reflect BP doesn't exist in SAP
        order.SyncErrors = `Business partner ${order.CardCode} does not exist in SAP B1`;
        order.LastSyncAttempt = new Date();
        order.LocalStatus = "SyncFailed";
        order.SAPSyncDisabled = true; // Flag to indicate we shouldn't try to sync this order again
        await order.save();

        return {
          success: false,
          error: order.SyncErrors,
          code: "BP_NOT_FOUND",
        };
      }
    } catch (bpError) {
      // If BP check itself fails, continue with the order creation attempt
      console.warn(
        `Could not verify business partner in SAP: ${bpError.message}`
      );
    }

    // Push to SAP B1
    const sapResponse = await createSalesOrderInSAP(sapOrder);

    // Update local order with SAP DocEntry AND DocNum if successful
    if (sapResponse && sapResponse.DocEntry) {
      order.SAPDocEntry = sapResponse.DocEntry;

      // *** IMPORTANT: Update local DocNum to match SAP's DocNum ***
      if (sapResponse.DocNum) {
        console.log(
          `Updating local DocNum from ${order.DocNum} to ${sapResponse.DocNum} to match SAP`
        );
        order.DocNum = sapResponse.DocNum;
      }

      order.DocumentStatus = "bost_Closed"; // Or any appropriate status
      order.UpdateDate = new Date();
      order.SyncedWithSAP = true;
      order.LocalStatus = "Synced";
      order.SyncErrors = null; // Clear any previous errors
      order.LastSyncAttempt = new Date();

      await order.save();

      // Update sales agent stats for synced order
      if (order.salesAgent) {
        await updateSalesAgentAchievement(order.salesAgent, order);
      }

      return {
        success: true,
        SAPDocEntry: sapResponse.DocEntry,
        SAPDocNum: sapResponse.DocNum,
        sapData: sapResponse,
      };
    } else {
      throw new Error("Invalid response from SAP B1");
    }
  } catch (error) {
    // Check for specific error types
    let errorCode = "GENERAL_ERROR";

    if (
      error.message &&
      error.message.includes("Business partner") &&
      error.message.includes("does not exist")
    ) {
      errorCode = "BP_NOT_FOUND";
    } else if (error.message && error.message.includes("Invalid BP code")) {
      errorCode = "INVALID_BP_CODE";
    }

    // Update local order to mark sync failure
    order.SyncErrors = error.message;
    order.LastSyncAttempt = new Date();
    order.LocalStatus = "SyncFailed";

    // If BP doesn't exist, mark order to not attempt sync again
    if (errorCode === "BP_NOT_FOUND" || errorCode === "INVALID_BP_CODE") {
      order.SAPSyncDisabled = true;
    }

    await order.save();

    console.error("Error pushing order to SAP:", error);
    return {
      success: false,
      error: error.message || "Unknown error",
      code: errorCode,
    };
  }
}

// Create a new sales order (save to local DB and push to SAP)
// Update the createOrder function - replace the DocEntry generation part

exports.createOrder = async (req, res) => {
  try {
    // Validate required fields
    if (!req.body.CardCode) {
      return res.status(400).json({
        success: false,
        message: "Customer (CardCode) is required",
      });
    }

    console.log("Request body PriceList:", req.body.PriceList);

    const salesAgentId = req.user._id;

    // Validate that at least one document line exists
    if (!req.body.DocumentLines || req.body.DocumentLines.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Order must contain at least one item",
      });
    }

    // Validate items but don't check stock availability
    const itemCodes = req.body.DocumentLines.map((line) => line.ItemCode);
    const items = await Item.find({ ItemCode: { $in: itemCodes } });

    // Create a map for quick lookups
    const itemMap = {};
    items.forEach((item) => {
      itemMap[item.ItemCode] = item;
    });

    // Check if all items exist but don't check stock
    const invalidItems = [];
    for (const line of req.body.DocumentLines) {
      const item = itemMap[line.ItemCode];

      if (!item) {
        invalidItems.push({
          ItemCode: line.ItemCode,
          error: "Item not found",
        });
        continue;
      }

      // Add item description if not provided
      if (!line.ItemDescription && item.ItemName) {
        line.ItemDescription = item.ItemName;
      }
    }

    if (invalidItems.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Order contains invalid items",
        invalidItems,
      });
    }

    // *** UPDATED DOCNUM GENERATION ***
    // Try to get the next DocNum from SAP first
    let newDocNum;
    let newDocEntry;

    try {
      // Import the new function
      const { getNextDocNumFromSAP } = require("../utils/sapB1Integration");
      newDocNum = await getNextDocNumFromSAP();

      if (newDocNum) {
        console.log(`Using SAP-aligned DocNum: ${newDocNum}`);
        newDocEntry = newDocNum; // Use the same number for both
      } else {
        throw new Error("Could not get DocNum from SAP");
      }
    } catch (sapError) {
      console.warn(
        "Could not get DocNum from SAP, falling back to local generation:",
        sapError.message
      );

      // Fallback to local DocEntry generation
      const lastOrder = await SalesOrder.findOne().sort({ DocEntry: -1 });
      newDocEntry = lastOrder ? lastOrder.DocEntry + 1 : 1;
      newDocNum = newDocEntry;

      console.log(`Using local DocNum: ${newDocNum}`);
    }

    // Process document lines
    const orderPriceList = req.body.PriceList || "2";
    const processedDocumentLines = req.body.DocumentLines.map((line) => ({
      ...line,
      PriceList: line.PriceList
        ? parseInt(line.PriceList, 10)
        : parseInt(orderPriceList, 10),
      LineTotal: (line.Quantity || 0) * (line.Price || 0),
    }));

    // Replace the original DocumentLines with processed ones
    req.body.DocumentLines = processedDocumentLines;

    // Calculate today's date for DocDate and DocDueDate
    const today = new Date();

    const salesAgentName =
      "The order was put up by " +
      req.user.firstName +
      " " +
      req.user.lastName +
      ". ";

    // Create the new order with SAP-aligned DocNum
    const newOrder = new SalesOrder({
      ...req.body,
      PriceList: req.body.PriceList,
      DocEntry: newDocEntry,
      DocNum: newDocNum, // Now aligned with SAP
      DocType: req.body.DocType || "dDocument_Items",
      DocumentStatus: "bost_Open",
      CreationDate: today,
      StartDeliveryDate: req.body.StartDeliveryDate || today,
      DocDate: req.body.DocDate || today,
      DocDueDate: req.body.DocDueDate || today,
      UpdateDate: today,
      SyncedWithSAP: false,
      LocalStatus: "Created",
      salesAgent: salesAgentId,
      U_Notes: salesAgentName,
    });

    console.log("Creating new order with SAP-aligned DocNum:", {
      DocEntry: newOrder.DocEntry,
      DocNum: newOrder.DocNum,
      CardCode: newOrder.CardCode,
    });

    // Calculate totals if not provided
    if (!newOrder.DocTotal) {
      let total = 0;
      for (const line of newOrder.DocumentLines) {
        const lineTotal = line.Quantity * line.Price;
        line.LineTotal = lineTotal;
        total += lineTotal;
      }
      newOrder.DocTotal = total;
    }

    // Save to local database
    await newOrder.save();

    // Update sales agent stats
    if (salesAgentId) {
      await updateSalesAgentStats(salesAgentId, newOrder);
    }

    // Return response with both local creation and SAP push results
    res.status(201).json({
      success: true,
      data: newOrder,
      message:
        "Order created successfully"
    });

  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({
      success: false,
      message: "Error creating order",
      error: error.message,
    });
  }
};

// Add this filter option to your getAllOrders function
// Add this to the existing filters section:

exports.getAllOrders = async (req, res) => {
  try {
    console.log("Fetching all orders with enhanced filtering");
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const sortBy = req.query.sortBy || "DocDate";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;

    // Base query
    let query = {};

    // Search filter
    if (req.query.search) {
      const searchRegex = { $regex: req.query.search, $options: "i" };
      query.$or = [
        { DocNum: searchRegex },
        { CardCode: searchRegex },
        { CardName: searchRegex },
        { Address: searchRegex },
      ];
    }

    // Customer code filter
    if (req.query.cardCode) {
      query.CardCode = { $regex: req.query.cardCode, $options: "i" };
    }

    // Status filter
    if (req.query.status) {
      query.DocumentStatus = req.query.status;
    }

    // Sync status filter
    if (req.query.syncStatus) {
      switch (req.query.syncStatus) {
        case "synced":
          query.SyncedWithSAP = true;
          break;
        case "unsynced":
          query.SyncedWithSAP = false;
          break;
        case "failed":
          query.LocalStatus = "SyncFailed";
          break;
      }
    }

    // *** NEW: Order origin filter ***
    if (req.query.orderOrigin) {
      switch (req.query.orderOrigin) {
        case "system":
          query.salesAgent = { $exists: true, $ne: null };
          break;
        case "sap":
          query.salesAgent = { $exists: false };
          break;
        case "sap_null":
          query.$or = [
            { salesAgent: { $exists: false } },
            { salesAgent: null },
          ];
          break;
      }
    }

    // Date range filter
    if (req.query.fromDate && req.query.toDate) {
      query.DocDate = {
        $gte: new Date(req.query.fromDate),
        $lte: new Date(req.query.toDate),
      };
    } else if (req.query.fromDate) {
      query.DocDate = { $gte: new Date(req.query.fromDate) };
    } else if (req.query.toDate) {
      query.DocDate = { $lte: new Date(req.query.toDate) };
    }

    // Sales agent filter
    if (req.query.salesAgent) {
      query.salesAgent = req.query.salesAgent;
    }

    // Build sort object
    const sortObj = {};
    sortObj[sortBy] = sortOrder;

    console.log("Query:", JSON.stringify(query, null, 2));
    console.log("Sort:", sortObj);

    const orders = await SalesOrder.find(query)
      .populate("salesAgent", "firstName lastName email")
      .skip(skip)
      .limit(limit)
      .sort(sortObj);

    const total = await SalesOrder.countDocuments(query);

    console.log(`Found ${orders.length} orders out of ${total} total`);

    res.status(200).json({
      success: true,
      count: orders.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: orders,
    });
  } catch (error) {
    console.error("Error fetching orderformatOrderForSAP s:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching orders",
      error: error.message,
    });
  }
};

// Get orders for a specific customer
exports.getOrdersByCustomer = async (req, res) => {
  try {
    const { cardCode } = req.params;
    const page = parseInt(req.query.page) || 1;

    // Base query
    const query = { CardCode: cardCode };

    const orders = await SalesOrder.find(query)
      .populate("salesAgent", "firstName lastName email")
      .sort({ DocDate: -1 });

    const total = await SalesOrder.countDocuments(query);

    console.log("Fetched orders for customer:", cardCode);

    console.log("Total orders:", total);

    res.status(200).json({
      success: true,
      count: orders.length,
      total,
      page,
      customerCode: cardCode,
      data: orders,
    });
  } catch (error) {
    console.log("Error fetching customer orders:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching customer orders",
      error: error.message,
    });
  }
};

// Get a single order by DocEntry
exports.getOrderByDocEntry = async (req, res) => {
  try {
    const order = await SalesOrder.findOne({
      DocEntry: req.params.docEntry,
    }).populate("salesAgent", "firstName lastName email");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: `Order with DocEntry ${req.params.docEntry} not found`,
      });
    }

    // Check permissions for sales agents
    if (
      req.user.role === "sales_agent" &&
      order.salesAgent &&
      order.salesAgent._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this order",
      });
    }

    // Check permissions for sales managers
    if (req.user.role === "sales_manager" && order.salesAgent) {
      const agent = await User.findById(order.salesAgent._id);
      if (!agent || agent.manager.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to view this order",
        });
      }
    }

    res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching order",
      error: error.message,
    });
  }
};

// Manual push order to SAP B1 (kept for backup or retry purposes)
exports.pushOrderToSAP = async (req, res) => {
  try {
    const order = await SalesOrder.findOne({ DocEntry: req.params.docEntry });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: `Order with DocEntry ${req.params.docEntry} not found`,
      });
    }

    // Check if already synced with SAP
    if (order.SyncedWithSAP && order.SAPDocEntry) {
      return res.status(400).json({
        success: false,
        message: `Order already synced with SAP B1 (SAP DocEntry: ${order.SAPDocEntry})`,
        SAPDocEntry: order.SAPDocEntry,
      });
    }

    // Check if sync was previously disabled due to BP not existing
    if (order.SAPSyncDisabled) {
      // Allow force sync if specifically requested
      if (req.query.force !== "true") {
        return res.status(400).json({
          success: false,
          message: `Cannot sync order: ${order.SyncErrors}. Add ?force=true to override.`,
          error: order.SyncErrors,
        });
      }
      // If force=true, continue with sync attempt and clear the flag
      order.SAPSyncDisabled = false;
      await order.save();
    }

    const sapResult = await pushOrderToSAPInternal(order);

    if (sapResult.success) {
      return res.status(200).json({
        success: true,
        message: "Order successfully pushed to SAP B1",
        SAPDocEntry: sapResult.SAPDocEntry,
        localDocEntry: order.DocEntry,
        sapData: sapResult.sapData,
      });
    } else {
      // Customize message based on error code
      let errorMessage = "Error pushing order to SAP B1";

      if (
        sapResult.code === "BP_NOT_FOUND" ||
        sapResult.code === "INVALID_BP_CODE"
      ) {
        errorMessage = `Business partner ${order.CardCode} does not exist in SAP B1`;
      }

      return res.status(400).json({
        success: false,
        message: errorMessage,
        error: sapResult.error,
        code: sapResult.code,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error pushing order to SAP B1",
      error: error.message || "Unknown error",
    });
  }
};

exports.pushUnsyncedOrdersToSAP = async (req, res) => {
  try {
    console.log("Starting bulk SAP sync for unsynced orders...");

    // Find all orders that are not synced with SAP, not disabled, AND have a sales agent
    // Orders with sales agents were created in our system
    // Orders without sales agents came from SAP bulk import and shouldn't be pushed back
    const unsyncedOrders = await SalesOrder.find({
      SyncedWithSAP: false,
      SAPSyncDisabled: { $ne: true },
      salesAgent: { $exists: true, $ne: null }, // Only orders with sales agents
    }).populate("salesAgent", "firstName lastName email");

    if (unsyncedOrders.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No unsynced orders found that were created in the system",
        data: {
          totalOrders: 0,
          successful: 0,
          failed: 0,
          results: [],
        },
      });
    }

    console.log(
      `Found ${unsyncedOrders.length} unsynced orders created in the system`
    );

    const results = [];
    let successCount = 0;
    let failureCount = 0;

    // Process each order
    for (const order of unsyncedOrders) {
      try {
        console.log(
          `Processing order DocEntry: ${order.DocEntry} (Created by: ${order.salesAgent
            ? order.salesAgent.firstName + " " + order.salesAgent.lastName
            : "System"
          })`
        );

        const sapResult = await pushOrderToSAPInternal(order);

        if (sapResult.success) {
          successCount++;
          results.push({
            DocEntry: order.DocEntry,
            DocNum: order.DocNum,
            CardCode: order.CardCode,
            CardName: order.CardName,
            success: true,
            SAPDocEntry: sapResult.SAPDocEntry,
            message: "Successfully synced to SAP",
          });

          console.log(
            `✅ Order ${order.DocEntry} synced successfully - SAP DocEntry: ${sapResult.SAPDocEntry}`
          );
        } else {
          failureCount++;
          results.push({
            DocEntry: order.DocEntry,
            DocNum: order.DocNum,
            CardCode: order.CardCode,
            CardName: order.CardName,
            success: false,
            error: sapResult.error,
            errorCode: sapResult.code,
            message:
              sapResult.code === "BP_NOT_FOUND"
                ? `Business partner ${order.CardCode} does not exist in SAP`
                : "Failed to sync to SAP",
          });

          console.log(
            `❌ Order ${order.DocEntry} failed to sync: ${sapResult.error}`
          );
        }
      } catch (error) {
        failureCount++;
        results.push({
          DocEntry: order.DocEntry,
          DocNum: order.DocNum,
          CardCode: order.CardCode,
          CardName: order.CardName,
          success: false,
          error: error.message,
          message: "Unexpected error during sync",
        });

        console.error(`❌ Order ${order.DocEntry} encountered error:`, error);
      }
    }

    // Prepare summary
    const summary = {
      totalOrders: unsyncedOrders.length,
      successful: successCount,
      failed: failureCount,
      successRate:
        ((successCount / unsyncedOrders.length) * 100).toFixed(2) + "%",
    };

    console.log(
      `Bulk SAP sync completed: ${successCount} successful, ${failureCount} failed`
    );

    return res.status(200).json({
      success: true,
      message: `Bulk SAP sync completed: ${successCount} successful, ${failureCount} failed`,
      data: {
        summary,
        results,
      },
    });
  } catch (error) {
    console.error("Error in bulk SAP sync:", error);
    return res.status(500).json({
      success: false,
      message: "Error during bulk SAP sync",
      error: error.message,
    });
  }
};

// Get order statistics
exports.getOrderStats = async (req, res) => {
  try {
    const { fromDate, toDate, salesAgent } = req.query;

    // Build match query
    let matchQuery = {};

    // Date filter
    if (fromDate || toDate) {
      matchQuery.DocDate = {};
      if (fromDate) matchQuery.DocDate.$gte = new Date(fromDate);
      if (toDate) matchQuery.DocDate.$lte = new Date(toDate);
    }

    // Sales agent filter
    if (salesAgent) {
      matchQuery.salesAgent = new mongoose.Types.ObjectId(salesAgent);
    }

    // Filter for current user if sales agent
    if (req.user && req.user.role === "sales_agent") {
      matchQuery.salesAgent = req.user._id;
    }

    // If sales manager, get all orders from their agents
    if (req.user && req.user.role === "sales_manager") {
      const agentIds = await User.find({ manager: req.user._id }).distinct(
        "_id"
      );
      matchQuery.salesAgent = { $in: agentIds };
    }

    const stats = await SalesOrder.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalValue: { $sum: "$DocTotal" },
          syncedOrders: {
            $sum: { $cond: [{ $eq: ["$SyncedWithSAP", true] }, 1, 0] },
          },
          pendingSync: {
            $sum: { $cond: [{ $eq: ["$SyncedWithSAP", false] }, 1, 0] },
          },
          failedSync: {
            $sum: { $cond: [{ $eq: ["$LocalStatus", "SyncFailed"] }, 1, 0] },
          },
          paidOrders: {
            $sum: { $cond: [{ $eq: ["$payment_status", "completed"] }, 1, 0] },
          },
          pendingPayment: {
            $sum: { $cond: [{ $ne: ["$Payment_id", null] }, 1, 0] },
          },
        },
      },
    ]);

    const result = stats[0] || {
      totalOrders: 0,
      totalValue: 0,
      syncedOrders: 0,
      pendingSync: 0,
      failedSync: 0,
      paidOrders: 0,
      pendingPayment: 0,
    };

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error fetching order stats:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching order statistics",
      error: error.message,
    });
  }
};

// Search orders
exports.searchOrders = async (req, res) => {
  try {
    const { searchTerm, filters = {} } = req.body;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Build search query
    let query = {};

    // Text search
    if (searchTerm) {
      query.$or = [
        { DocNum: { $regex: searchTerm, $options: "i" } },
        { CardCode: { $regex: searchTerm, $options: "i" } },
        { CardName: { $regex: searchTerm, $options: "i" } },
        { Address: { $regex: searchTerm, $options: "i" } },
      ];
    }

    // Apply filters
    Object.keys(filters).forEach((key) => {
      if (filters[key] !== null && filters[key] !== "") {
        query[key] = filters[key];
      }
    });

    // Role-based filtering
    if (req.user.role === "sales_agent") {
      query.salesAgent = req.user._id;
    }

    if (req.user.role === "sales_manager") {
      const agentIds = await User.find({ manager: req.user._id }).distinct(
        "_id"
      );
      query.salesAgent = { $in: agentIds };
    }

    const orders = await SalesOrder.find(query)
      .populate("salesAgent", "firstName lastName email")
      .skip(skip)
      .limit(limit)
      .sort({ DocDate: -1 });

    const total = await SalesOrder.countDocuments(query);

    res.status(200).json({
      success: true,
      count: orders.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: orders,
    });
  } catch (error) {
    console.error("Error searching orders:", error);
    res.status(500).json({
      success: false,
      message: "Error searching orders",
      error: error.message,
    });
  }
};

// Export orders
exports.exportOrders = async (req, res) => {
  try {
    const filters = req.body;

    // Build query based on filters
    let query = {};

    if (filters.fromDate && filters.toDate) {
      query.DocDate = {
        $gte: new Date(filters.fromDate),
        $lte: new Date(filters.toDate),
      };
    }

    if (filters.salesAgent) {
      query.salesAgent = filters.salesAgent;
    }

    if (filters.cardCode) {
      query.CardCode = { $regex: filters.cardCode, $options: "i" };
    }

    if (filters.syncStatus) {
      if (filters.syncStatus === "synced") {
        query.SyncedWithSAP = true;
      } else if (filters.syncStatus === "unsynced") {
        query.SyncedWithSAP = false;
      } else if (filters.syncStatus === "failed") {
        query.LocalStatus = "SyncFailed";
      }
    }

    // Role-based filtering
    if (req.user.role === "sales_agent") {
      query.salesAgent = req.user._id;
    }

    if (req.user.role === "sales_manager") {
      const agentIds = await User.find({ manager: req.user._id }).distinct(
        "_id"
      );
      query.salesAgent = { $in: agentIds };
    }

    const orders = await SalesOrder.find(query)
      .populate("salesAgent", "firstName lastName email")
      .sort({ DocDate: -1 });

    // Convert to CSV format
    const csvHeaders = [
      "Doc Number",
      "Customer Code",
      "Customer Name",
      "Sales Agent",
      "Order Date",
      "Total Amount",
      "Currency",
      "Status",
      "SAP Synced",
      "SAP Doc Entry",
      "Payment Status",
      "Address",
    ];

    const csvRows = orders.map((order) => [
      order.DocNum,
      order.CardCode,
      order.CardName,
      order.salesAgent
        ? `${order.salesAgent.firstName} ${order.salesAgent.lastName}`
        : "",
      order.DocDate ? order.DocDate.toISOString().split("T")[0] : "",
      order.DocTotal,
      order.DocCurrency || "EUR",
      order.DocumentStatus,
      order.SyncedWithSAP ? "Yes" : "No",
      order.SAPDocEntry || "",
      order.payment_status || "",
      order.Address || "",
    ]);

    // Create CSV content
    const csvContent = [csvHeaders, ...csvRows]
      .map((row) => row.map((field) => `"${field}"`).join(","))
      .join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=sales-orders.csv"
    );
    res.send(csvContent);
  } catch (error) {
    console.error("Error exporting orders:", error);
    res.status(500).json({
      success: false,
      message: "Error exporting orders",
      error: error.message,
    });
  }
};

// Update order status
exports.updateOrderStatus = async (req, res) => {
  try {
    const { docEntry } = req.params;
    const { status } = req.body;

    const order = await SalesOrder.findOneAndUpdate(
      { DocEntry: docEntry },
      {
        DocumentStatus: status,
        UpdateDate: new Date(),
      },
      { new: true }
    ).populate("salesAgent", "firstName lastName email");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: `Order with DocEntry ${docEntry} not found`,
      });
    }

    res.status(200).json({
      success: true,
      message: "Order status updated successfully",
      data: order,
    });
  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating order status",
      error: error.message,
    });
  }
};

// Cancel order
exports.cancelOrder = async (req, res) => {
  try {
    const { docEntry } = req.params;
    const { reason } = req.body;

    const order = await SalesOrder.findOneAndUpdate(
      { DocEntry: docEntry },
      {
        Cancelled: "Y",
        DocumentStatus: "bost_Cancelled",
        UpdateDate: new Date(),
        CancellationReason: reason || "Cancelled by user",
      },
      { new: true }
    ).populate("salesAgent", "firstName lastName email");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: `Order with DocEntry ${docEntry} not found`,
      });
    }

    res.status(200).json({
      success: true,
      message: "Order cancelled successfully",
      data: order,
    });
  } catch (error) {
    console.error("Error cancelling order:", error);
    res.status(500).json({
      success: false,
      message: "Error cancelling order",
      error: error.message,
    });
  }
};

// Get SAP order status
exports.getSAPOrderStatus = async (req, res) => {
  try {
    const { docEntry } = req.params;

    const order = await SalesOrder.findOne({ DocEntry: docEntry });
    if (!order) {
      return res.status(404).json({
        success: false,
        message: `Order with DocEntry ${docEntry} not found`,
      });
    }

    if (!order.SAPDocEntry) {
      return res.status(400).json({
        success: false,
        message: "Order is not synced with SAP",
      });
    }

    try {
      // Get order status from SAP
      const sapOrder = await getSalesOrderFromSAP(order.SAPDocEntry);

      // Update local order with SAP status
      order.DocumentStatus = sapOrder.DocumentStatus;
      order.UpdateDate = new Date();
      await order.save();

      res.status(200).json({
        success: true,
        message: "SAP order status retrieved successfully",
        data: {
          localOrder: order,
          sapOrder: sapOrder,
        },
      });
    } catch (sapError) {
      res.status(500).json({
        success: false,
        message: "Error retrieving order from SAP",
        error: sapError.message,
      });
    }
  } catch (error) {
    console.error("Error getting SAP order status:", error);
    res.status(500).json({
      success: false,
      message: "Error getting SAP order status",
      error: error.message,
    });
  }
};

// Duplicate order
exports.duplicateOrder = async (req, res) => {
  try {
    const { docEntry } = req.params;

    const originalOrder = await SalesOrder.findOne({ DocEntry: docEntry });
    if (!originalOrder) {
      return res.status(404).json({
        success: false,
        message: `Order with DocEntry ${docEntry} not found`,
      });
    }

    // Generate new DocEntry
    const lastOrder = await SalesOrder.findOne().sort({ DocEntry: -1 });
    const newDocEntry = lastOrder ? lastOrder.DocEntry + 1 : 1;

    // Create duplicate order
    const duplicateData = {
      ...originalOrder.toObject(),
      _id: undefined, // Remove the original _id
      DocEntry: newDocEntry,
      DocNum: newDocEntry,
      DocDate: new Date(),
      CreationDate: new Date(),
      UpdateDate: new Date(),
      SyncedWithSAP: false,
      SAPDocEntry: null,
      LocalStatus: "Created",
      Payment_id: null,
      payment_status: null,
      Link_sent: false,
      U_Notes: `Duplicated from order #${originalOrder.DocNum}. ${originalOrder.U_Notes || ""
        }`,
    };

    const newOrder = new SalesOrder(duplicateData);
    await newOrder.save();

    const populatedOrder = await SalesOrder.findById(newOrder._id).populate(
      "salesAgent",
      "firstName lastName email"
    );

    res.status(201).json({
      success: true,
      message: "Order duplicated successfully",
      data: populatedOrder,
    });
  } catch (error) {
    console.error("Error duplicating order:", error);
    res.status(500).json({
      success: false,
      message: "Error duplicating order",
      error: error.message,
    });
  }
};
