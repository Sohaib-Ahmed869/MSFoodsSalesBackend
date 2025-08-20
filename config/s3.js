// config/s3.js
const {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

// Configure AWS S3 Client (v3)
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "eu-north-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

// Allowed file types for documents
const allowedMimeTypes = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
];

// File filter function
const fileFilter = (req, file, cb) => {
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Invalid file type. Only PDF, images, Word, Excel, and text files are allowed."
      ),
      false
    );
  }
};

// Generate S3 key for file
const generateS3Key = (customerId, documentType, originalName) => {
  const timestamp = Date.now();
  const uuid = uuidv4();
  const ext = path.extname(originalName);
  return `customers/${customerId}/documents/${documentType}/${timestamp}-${uuid}${ext}`;
};

// Custom S3 storage engine for multer (since multer-s3 doesn't support AWS SDK v3)
class S3Storage {
  constructor(options) {
    this.s3Client = options.s3Client;
    this.bucket = options.bucket;
    this.getKey = options.key;
    this.getMetadata = options.metadata;
  }

  _handleFile(req, file, cb) {
    // Get customerId from URL params instead of body (body isn't parsed yet)
    const customerId = req.params.customerId;

    // Get documentType from the field name or use a default
    // Since body isn't available yet, we'll extract it from the field name or use default
    let documentType = "otherDocuments"; // default

    // Try to get documentType from field name if it follows a pattern
    if (file.fieldname && file.fieldname !== "document") {
      documentType = file.fieldname;
    }

    console.log("S3Storage _handleFile:", {
      customerId,
      documentType,
      fieldname: file.fieldname,
      originalname: file.originalname,
    });

    if (!customerId) {
      return cb(new Error("Customer ID is required in URL parameters"));
    }

    const s3Key = generateS3Key(customerId, documentType, file.originalname);

    // Create a pass-through stream to collect the file data
    const chunks = [];

    file.stream.on("data", (chunk) => {
      chunks.push(chunk);
    });

    file.stream.on("end", async () => {
      try {
        const fileBuffer = Buffer.concat(chunks);

        // Import PutObjectCommand dynamically
        const { PutObjectCommand } = require("@aws-sdk/client-s3");

        const uploadParams = {
          Bucket: this.bucket,
          Key: s3Key,
          Body: fileBuffer,
          ContentType: file.mimetype,
          Metadata: {
            customerId: customerId,
            documentType: documentType,
            uploadedBy: req.user ? req.user._id.toString() : "system",
            uploadedAt: new Date().toISOString(),
          },
        };

        const command = new PutObjectCommand(uploadParams);
        await this.s3Client.send(command);

        const fileInfo = {
          fieldname: file.fieldname,
          originalname: file.originalname,
          encoding: file.encoding,
          mimetype: file.mimetype,
          size: fileBuffer.length,
          bucket: this.bucket,
          key: s3Key,
          location: `https://${this.bucket}.s3.${
            process.env.AWS_REGION || "us-east-1"
          }.amazonaws.com/${s3Key}`,
        };

        cb(null, fileInfo);
      } catch (error) {
        cb(error);
      }
    });

    file.stream.on("error", cb);
  }

  _removeFile(req, file, cb) {
    // Optional: implement file removal logic if needed
    cb(null);
  }
}

// Configure multer with custom S3 storage
// Configure multer with custom S3 storage
const uploadToS3 = multer({
  storage: new S3Storage({
    s3Client: s3Client,
    bucket: process.env.S3_BUCKET || "halalfoodattachments",
    key: function (req, file, cb) {
      // Get customerId from URL params
      const customerId = req.params.customerId;
      // Use default documentType since body isn't available yet
      const documentType = "document"; // Will be overridden in controller
      const s3Key = generateS3Key(customerId, documentType, file.originalname);
      cb(null, s3Key);
    },
    metadata: function (req, file, cb) {
      const customerId = req.params.customerId;
      cb(null, {
        customerId: customerId,
        documentType: "document", // Will be updated in controller
        uploadedBy: req.user ? req.user._id.toString() : "system",
        uploadedAt: new Date().toISOString(),
      });
    },
  }),
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Function to delete file from S3 using AWS SDK v3
const deleteFromS3 = async (s3Key) => {
  try {
    const deleteParams = {
      Bucket: process.env.S3_BUCKET || "halalfoodattachments",
      Key: s3Key,
    };

    const command = new DeleteObjectCommand(deleteParams);
    await s3Client.send(command);

    console.log(`Successfully deleted file: ${s3Key}`);
    return true;
  } catch (error) {
    console.error("Error deleting file from S3:", error);
    throw error;
  }
};

// Function to generate presigned URL for secure access using AWS SDK v3
const generatePresignedUrl = async (s3Key, expiresIn = 3600) => {
  try {
    const getObjectParams = {
      Bucket: process.env.S3_BUCKET || "halalfoodattachments",
      Key: s3Key,
    };

    const command = new GetObjectCommand(getObjectParams);
    const url = await getSignedUrl(s3Client, command, { expiresIn });

    return url;
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    throw error;
  }
};

module.exports = {
  s3Client,
  uploadToS3,
  deleteFromS3,
  generatePresignedUrl,
  generateS3Key,
};
