const multer = require('multer');

const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

// Configure Cloudinary Storage with optimization
const cloudinaryStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'appzeto',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'gif'],
    // Apply quality-preserving optimization on upload
    transformation: [
      { quality: 'auto:good', fetch_format: 'auto' }
    ],
    public_id: (req, file) => {
      const name = file.originalname.split('.')[0];
      return `${name}-${Date.now()}`;
    }
  }
});

// Configure memory storage (backup/legacy)
const memoryStorage = multer.memoryStorage();

// File filter - only images
const imageFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

// File filter - images and documents
const documentFilter = (req, file, cb) => {
  const allowedMimes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only images and PDF/DOC files are allowed!'), false);
  }
};

// Generic Image Upload (Cloudinary) - Expecting 'file' field
const uploadImage = multer({
  storage: cloudinaryStorage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
}).single('file');

// Profile photo upload (legacy/specific) - Expecting 'photo' field
const uploadProfilePhoto = multer({
  storage: cloudinaryStorage, // Updated to use Cloudinary
  fileFilter: imageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024
  }
}).single('photo');

// Document upload (multiple files)
const uploadDocuments = multer({
  storage: memoryStorage, // Keep memory for docs for now or update if needed
  fileFilter: documentFilter,
  limits: {
    fileSize: 5 * 1024 * 1024
  }
}).fields([
  { name: 'aadhar', maxCount: 1 },
  { name: 'pan', maxCount: 1 },
  { name: 'otherDocuments', maxCount: 5 }
]);

// Error handling middleware
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum size is 5MB.'
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Too many files uploaded.'
      });
    }
    return res.status(400).json({
      success: false,
      message: err.message
    });
  } else if (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
  next();
};

module.exports = {
  uploadImage,
  uploadProfilePhoto,
  uploadDocuments,
  handleMulterError
};
