const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Document sub-schema for uploaded files
const DocumentSchema = new Schema({
  filename: {
    type: String,
    required: true,
  },
  originalName: {
    type: String,
    required: true,
  },
  s3Key: {
    type: String,
    required: true,
  },
  s3Url: {
    type: String,
    required: true,
  },
  fileSize: {
    type: Number,
  },
  mimeType: {
    type: String,
  },
  uploadedAt: {
    type: Date,
    default: Date.now,
  },
  uploadedBy: {
    type: Schema.Types.ObjectId,
    ref: "User",
  },
});

// NEW: Address sub-schema for multiple addresses
const AddressSchema = new Schema({
  addressName: {
    type: String,
    required: true,
  },
  street: {
    type: String,
    trim: true,
  },
  zipCode: {
    type: String,
    trim: true,
  },
  city: {
    type: String,
    trim: true,
  },
  country: {
    type: String,
    trim: true,
    default: "France",
  },
  addressType: {
    type: String,
    enum: ["bo_BillTo", "bo_ShipTo"],
    required: true,
  },
  isDefault: {
    type: Boolean,
    default: false,
  },
  // Additional SAP fields
  block: String,
  county: String,
  state: String,
  buildingFloorRoom: String,
  addressName2: String,
  addressName3: String,
  streetNo: String,
  rowNum: Number,
  // SAP sync tracking
  sapSynced: {
    type: Boolean,
    default: false,
  },
  lastSyncDate: Date,
  createDate: Date,
  createTime: String,
}, {
  timestamps: true
});


const CustomerSchema = new Schema({
  // ... (all existing fields remain the same)
  CardName: {
    type: String,
    required: true,
  },
  CardCode: {
    type: String,
    index: true,
  },
  Email: {
    type: String,
  },
  firstName: {
    type: String,
    trim: true,
  },
  lastName: {
    type: String,
    trim: true,
  },
  phoneNumber: {
    type: String,
    trim: true,
  },
  additionalPhoneNumbers: {
    type: [String],
    default: [],
  },
  hubspotId: {
    type: String,
    trim: true,
  },
  prestashopAcc: {
    type: String,
    trim: true,
  },
  assignedTo: {
    type: Schema.Types.ObjectId,
    ref: "User",
  },
  contactOwnerName: {
    type: String,
    trim: true,
  },
  customerType: {
    type: String,
    enum: ["sap", "non-sap", "lead"],
    default: "non-sap",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    enum: ["active", "inactive", "lead", "prospect"],
    default: "active",
  },
  marketingStatus: {
    type: String,
    enum: ["marketing-contact", "non-marketing-contact", "unsubscribed"],
    default: "marketing-contact",
  },
  notes: {
    type: String,
  },
  additionalEmails: [String],
  company: {
    type: String,
    trim: true,
  },
  companyId: {
    type: String,
    trim: true,
  },
  lastActivityDate: {
    type: Date,
  },
  address: {
    street: {
      type: String,
      trim: true,
    },
    zipCode: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    country: {
      type: String,
      trim: true,
      default: "France",
    },
  },
  deliveryAddress: {
    street: {
      type: String,
      trim: true,
    },
    zipCode: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    country: {
      type: String,
      trim: true,
      default: "France",
    },
  },
  outstandingBalance: {
    type: Number,
    default: 0,
  },
  SyncedWithSAP: {
    type: Boolean,
    default: false,
  },
  LocalStatus: {
    type: String,
    enum: ["Created", "Synced", "SyncFailed"],
    default: "Created",
  },
  SyncErrors: {
    type: String,
  },
  LastSyncAttempt: {
    type: Date,
  },
  SAPSyncDisabled: {
    type: Boolean,
    default: false,
  },
  uberEatsUrl: {
    type: String,
    validate: {
      validator: function (v) {
        return !v || v.includes("ubereats.com");
      },
      message: "Must be a valid UberEats URL",
    },
  },
  // NEW: Multiple addresses array
  addresses: [AddressSchema],

  lastRestaurantAnalysis: Date,

  // NEW DOCUMENT FIELDS
  documents: {
    companyDoc: DocumentSchema,
    managerId: DocumentSchema,
    otherDocuments: [DocumentSchema],
  },
});

// Update timestamps on save
CustomerSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// Add text index for searching
CustomerSchema.index({
  CardName: "text",
  firstName: "text",
  lastName: "text",
  Email: "text",
  phoneNumber: "text",
  CardCode: "text",
  company: "text",
});

const Customer = mongoose.model("Customer", CustomerSchema);
module.exports = Customer;
