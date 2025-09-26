require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const fs = require('fs').promises;
const multer = require('multer');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const productsFilePath = path.join(__dirname, 'products.json');
let productsFromJson = []; // Used only for the initial migration
const ADMIN_SECRET = 'goshala_admin_123'; // For admin dashboard

// Middleware for admin authentication
const adminAuth = (req, res, next) => {
    const secret = req.headers['x-admin-secret'] || req.query.secret;
    if (secret !== ADMIN_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

// --- Multer Configuration for Image Uploads ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = path.join(__dirname, 'public/uploads');
        // Ensure the directory exists
        fs.mkdir(uploadPath, { recursive: true }).then(() => {
            cb(null, uploadPath);
        }).catch(err => cb(err));
    },
    filename: function (req, file, cb) {
        // Create a unique filename
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed!'), false);
        cb(null, true);
    }
});

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- MongoDB Connection ---
// Connection string is now loaded from the .env file
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('FATAL ERROR: MONGO_URI is not defined in the .env file.');
  process.exit(1); // Exit if the database connection string is not found
}

// --- Mongoose Schemas and Models ---
const ProductSchema = new mongoose.Schema({
  legacyId: { type: Number, required: true, unique: true, index: true },
  name: { 
    type: String, 
    required: [true, 'Product name is required.'], 
    trim: true,
    minlength: 3,
    maxlength: 150
  },
  dateAdded: { type: Date },
  category: [String],
  images: [String],
  description: { type: String, trim: true, maxlength: 2000 },
  rating: { type: Number, default: 0 },
  reviewsCount: { type: Number, default: 0 },
  sellerTag: { type: String },
  price: { 
    type: Number, 
    required: [true, 'Product price is required.'],
    min: 0 
  },
  originalPrice: { type: Number },
  deliveryDate: { type: String }
});
const Product = mongoose.model('Product', ProductSchema);

const CommentSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  username: { type: String, required: true, trim: true },
  comment: { type: String, required: true, trim: true },
  rating: { type: Number, min: 1, max: 5 },
  createdAt: { type: Date, default: Date.now },
  verifiedPurchase: { type: Boolean, default: false }
});
const Comment = mongoose.model('Comment', CommentSchema);

const OrderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  date: { type: Date, default: Date.now },
  user: {
    firstname: { type: String, required: true, trim: true },
    lastname: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, match: [/.+@.+\..+/, 'Please enter a valid email address'] },
    phone: { type: String, required: true, trim: true },
    address1: { type: String, required: true, trim: true },
    address2: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    zip: { type: String, required: true, trim: true }
  },
  total: { type: Number, required: true, min: 0 },
  items: {
    type: [{
        id: { type: Number, required: true },
        name: { type: String, required: true },
        quantity: { type: Number, required: true, min: 1 },
        price: { type: Number, required: true, min: 0 }
    }],
    required: true,
    validate: [
        { validator: (val) => val.length > 0, msg: 'Order must have at least one item.' }
    ]
  }
});
const Order = mongoose.model('Order', OrderSchema);

// --- Main API Endpoints ---

app.get('/api/products', async (req, res) => {
    try {
        // .lean() returns plain JavaScript objects, not Mongoose documents, which is faster.
        const allProducts = await Product.find({}).lean();
        // The frontend expects the old format with 'id', so we map it.
        const formattedProducts = allProducts.map(p => {
            p.id = p.legacyId; // Add the numeric id for frontend compatibility
            delete p.legacyId;
            delete p.__v;
            return p;
        });
        res.json(formattedProducts);
    } catch (error) {
        console.error('Error fetching products from DB:', error);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

app.get('/api/products/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Invalid product ID format.' });
        }
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ error: 'Product not found.' });
        }
        res.json(product);
    } catch (error) {
        console.error('Error fetching single product:', error);
        res.status(500).json({ error: 'Failed to fetch product.' });
    }
});

app.post('/api/upload', adminAuth, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }
    // Return the public URL of the uploaded file
    res.status(201).json({ url: `/uploads/${req.file.filename}` });
}, (error, req, res, next) => {
    // Multer error handler
    res.status(400).json({ error: error.message });
});

app.post('/api/products', adminAuth, async (req, res) => {
    try {
        // Auto-increment legacyId
        const lastProduct = await Product.findOne().sort({ legacyId: -1 });
        const newLegacyId = lastProduct ? lastProduct.legacyId + 1 : 1;

        const newProduct = new Product({
            ...req.body,
            legacyId: newLegacyId,
            dateAdded: new Date()
        });
        await newProduct.save();
        res.status(201).json(newProduct);
    } catch (error) {
        console.error('Error creating product:', error);
        res.status(400).json({ error: 'Failed to create product.', details: error.message });
    }
});

app.put('/api/products/:id', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Invalid product ID format.' });
        }
        const updatedProduct = await Product.findByIdAndUpdate(
            req.params.id, 
            req.body, 
            { new: true, runValidators: true }
        );
        if (!updatedProduct) {
            return res.status(404).json({ error: 'Product not found.' });
        }
        res.json(updatedProduct);
    } catch (error) {
        console.error('Error updating product:', error);
        res.status(400).json({ error: 'Failed to update product.', details: error.message });
    }
});

app.delete('/api/products/:id', adminAuth, async (req, res) => {
    try {
        const deletedProduct = await Product.findByIdAndDelete(req.params.id);
        if (!deletedProduct) return res.status(404).json({ error: 'Product not found.' });
        res.status(200).json({ message: 'Product deleted successfully.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete product.' });
    }
});

app.get('/api/comments/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        const sort = req.query.sort || 'newest';
        const stars = req.query.stars; // e.g., "5,4"

        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).json({ message: 'Invalid Product ID format' });
        }

        // Build the query object
        const query = { productId };
        if (stars) {
            const starFilters = stars.split(',').map(Number).filter(n => n >= 1 && n <= 5);
            if (starFilters.length > 0) {
                query.rating = { $in: starFilters };
            }
        }

        // Build the sort object
        let sortOptions = { createdAt: -1 }; // Default: newest
        if (sort === 'oldest') sortOptions = { createdAt: 1 };
        else if (sort === 'highest') sortOptions = { rating: -1, createdAt: -1 };
        else if (sort === 'lowest') sortOptions = { rating: 1, createdAt: -1 };

        // Fetch all comments that match the query, without pagination
        const comments = await Comment.find(query)
            .sort(sortOptions);
        
        res.json(comments);
    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({ message: 'Server error while fetching comments.' });
    }
});

app.post('/api/products/:id/reviews', async (req, res) => {
    const legacyId = parseInt(req.params.id);
    const { user, rating, comment } = req.body;

    if (!user || !rating || !comment || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Missing required review fields: user, rating, comment' });
    }

    try {
        const product = await Product.findOne({ legacyId: legacyId });
        if (!product) {
            return res.status(404).json({ error: `Product with ID ${legacyId} not found.` });
        }

        // --- Verification Logic ---
        let isVerified = false;
        // Find orders that contain this product's legacyId
        const ordersWithProduct = await Order.find({ 'items.id': legacyId });
        
        // Check if any of those orders were placed by a user with a matching name
        if (ordersWithProduct.length > 0) {
            const reviewerName = user.toLowerCase().trim();
            isVerified = ordersWithProduct.some(order => {
                const customerName = `${order.user.firstname || ''} ${order.user.lastname || ''}`.toLowerCase().trim();
                // Check if the reviewer's name is part of the customer's full name
                return customerName.includes(reviewerName);
            });
        }
        // --- End Verification Logic ---

        const newComment = new Comment({
            productId: product._id,
            username: user,
            rating: parseInt(rating),
            comment: comment,
            verifiedPurchase: isVerified
        });
        await newComment.save();

        const stats = await Comment.aggregate([
            { $match: { productId: product._id } },
            { $group: { _id: '$productId', avgRating: { $avg: '$rating' }, count: { $sum: 1 } } }
        ]);

        if (stats.length > 0) {
            product.rating = Math.round(stats[0].avgRating);
            product.reviewsCount = stats[0].count;
            await product.save();
        }

        console.log(`Review for ${product.name} (ID: ${legacyId}) saved. Verified: ${isVerified}`);
        res.status(201).json({
            newComment,
            newRating: product.rating,
            newReviewsCount: product.reviewsCount
        });
    } catch (error) {
        console.error('Error adding review to DB:', error);
        res.status(500).json({ error: 'Failed to add review.' });
    }
});

// --- Order and Admin Endpoints ---
app.post('/api/orders', async (req, res) => {
    const { items, total, user } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0 || !total || !user) {
        return res.status(400).json({ error: 'Invalid order data.' });
    }

    try {
        const newOrder = new Order({
            orderId: `ORD-${Date.now()}`,
            user: user,
            total: parseFloat(total),
            items: items
        });
        await newOrder.save();
        console.log(`New order ${newOrder.orderId} saved to MongoDB.`);
        res.status(201).json({ message: 'Order placed successfully!', orderId: newOrder.orderId });
    } catch (err) {
        console.error('Error processing order:', err);
        res.status(500).json({ error: 'Failed to process the order.' });
    }
});

app.get('/api/admin/orders', adminAuth, async (req, res) => {
    try {
        const { search } = req.query;
        const query = {};

        if (search) {
            const searchRegex = { $regex: search, $options: 'i' }; // i for case-insensitive
            query.$or = [
                { orderId: searchRegex },
                { 'user.firstname': searchRegex },
                { 'user.lastname': searchRegex },
                { 'user.email': searchRegex }
            ];
        }

        const orders = await Order.find(query).sort({ date: -1 });
        res.json(orders);
    } catch (error) {
        console.error('Error fetching orders from DB:', error);
        res.status(500).json({ error: 'Failed to read orders data.' });
    }
});

app.get('/api/admin/orders/export', adminAuth, async (req, res) => {
    try {
        const { search } = req.query;
        const query = {};

        if (search) {
            const searchRegex = { $regex: search, $options: 'i' };
            query.$or = [
                { orderId: searchRegex },
                { 'user.firstname': searchRegex },
                { 'user.lastname': searchRegex },
                { 'user.email': searchRegex }
            ];
        }

        const orders = await Order.find(query).sort({ date: -1 }).lean();

        if (orders.length === 0) {
            return res.status(404).send('No orders to export.');
        }

        const headers = ['OrderID', 'Date', 'CustomerName', 'Email', 'Phone', 'Address', 'Total', 'Items'];
        
        // Helper to escape CSV cells
        const escapeCsvCell = (cell) => {
            if (cell === null || cell === undefined) return '';
            let str = String(cell);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const csvRows = [headers.join(',')]; // Header row

        orders.forEach(order => {
            const row = [
                order.orderId, new Date(order.date).toISOString(), `${order.user.firstname} ${order.user.lastname}`,
                order.user.email, order.user.phone,
                `${order.user.address1}${order.user.address2 ? `, ${order.user.address2}` : ''}, ${order.user.city}, ${order.user.state} ${order.user.zip}`,
                order.total, order.items.map(item => `${item.quantity} x ${item.name}`).join('; ')
            ].map(escapeCsvCell).join(',');
            csvRows.push(row);
        });
        
        res.header('Content-Type', 'text/csv');
        res.attachment('orders.csv');
        res.send(csvRows.join('\n'));
    } catch (error) {
        console.error('Error exporting orders:', error);
        res.status(500).json({ error: 'Failed to export orders.' });
    }
});

// --- Endpoints for secondary product page (product.html) ---

// GET /product/:id: Fetch product details and its comments
app.get('/product/:id', async (req, res) => {
  try {
    const productId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ message: 'Invalid Product ID format' });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const comments = await Comment.find({ productId: productId }).sort({ createdAt: -1 });

    res.json({
      product,
      comments,
    });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ message: 'Server error while fetching product details.' });
  }
});

// POST /product/:id/comment: Save a new comment
app.post('/product/:id/comment', async (req, res) => {
  try {
    const { id: productId } = req.params;
    const { username, comment } = req.body;

    if (!username || !comment) {
      return res.status(400).json({ message: 'Username and comment are required.' });
    }
    
    if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ message: 'Invalid Product ID format' });
    }

    const productExists = await Product.findById(productId);
    if (!productExists) {
        return res.status(404).json({ message: 'Cannot comment on a non-existent product.' });
    }

    const newComment = new Comment({
      productId,
      username,
      comment,
    });

    await newComment.save();

    res.status(201).json(newComment);
  } catch (error) {
    console.error('Error posting comment:', error);
    res.status(500).json({ message: 'Server error while posting comment.' });
  }
});

// --- Data Migration and Seeding on Startup ---
async function migrateAndSeed() {
  try {
    // 1. Migrate products from JSON file if they don't exist in DB
    const productCountInDB = await Product.countDocuments();
    if (productCountInDB < productsFromJson.length) {
      console.log('Starting product migration from products.json to MongoDB...');
      let migratedCount = 0;
      for (const p of productsFromJson) {
        const existingProduct = await Product.findOne({ legacyId: p.id });
        if (existingProduct) continue;

        const newProduct = new Product({
          legacyId: p.id,
          name: p.name,
          dateAdded: p.dateAdded ? new Date(p.dateAdded) : new Date(),
          category: p.category,
          images: p.images,
          description: p.description,
          rating: p.rating,
          reviewsCount: p.reviewsCount,
          sellerTag: p.sellerTag,
          price: p.price,
          originalPrice: p.originalPrice,
          deliveryDate: p.deliveryDate
        });
        await newProduct.save();
        migratedCount++;

        // Migrate embedded reviews to the Comment collection
        if (p.reviews && p.reviews.length > 0) {
          // Find orders that contain this product's legacyId to check for verification
          const ordersWithProduct = await Order.find({ 'items.id': p.id });

          const commentsToCreate = p.reviews.map(review => {
            let isVerified = false;
            if (ordersWithProduct.length > 0) {
                const reviewerName = review.user.toLowerCase().trim();
                isVerified = ordersWithProduct.some(order => {
                    const customerName = `${order.user.firstname || ''} ${order.user.lastname || ''}`.toLowerCase().trim();
                    return customerName.includes(reviewerName);
                });
            }
            return {
              productId: newProduct._id,
              username: review.user,
              rating: review.rating,
              comment: review.comment,
              createdAt: review.createdAt || new Date(),
              verifiedPurchase: isVerified
            };
          });
          await Comment.insertMany(commentsToCreate);
        }
      }
      if (migratedCount > 0) {
        console.log(`Successfully migrated ${migratedCount} new products to MongoDB.`);
      } else {
        console.log('All products from JSON file are already in the database.');
      }
    }

    // 2. Seed comments for the new product page if none exist
    const commentCount = await Comment.countDocuments();
    if (commentCount === 0) {
      const productToCommentOn = await Product.findOne().sort({ legacyId: 1 });
      if (productToCommentOn) {
        console.log(`Seeding comments for product: ${productToCommentOn.name}`);
        await Comment.create([
          { productId: productToCommentOn._id, username: 'Radha', rating: 5, comment: 'This is the best ghee I have ever tasted! So pure and aromatic.' },
          { productId: productToCommentOn._id, username: 'Krishna', rating: 4, comment: 'Excellent quality and fast delivery. Highly recommended.' }
        ]);
        console.log('Sample comments created for the new product page.');
      }
    }
  } catch (error) {
    console.error('Error during data migration and seeding:', error);
  }
}

// --- Server Startup ---
async function startServer() {
    // 1. Load products from JSON file for one-time migration check
    try {
        const data = await fs.readFile(productsFilePath, 'utf8');
        productsFromJson = JSON.parse(data);
        console.log(`Loaded ${productsFromJson.length} products from products.json for migration check.`);
    } catch (error) {
        console.error('Could not read products.json. Cannot perform migration.', error);
    }

    // 2. Connect to MongoDB for the new features
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Successfully connected to MongoDB.');
        await migrateAndSeed();
    } catch (err) {
        console.error('FATAL: MongoDB connection error. The new product page will not work.', err);
        process.exit(1);
    }

    // 3. Start the Express server
    app.listen(PORT, () => {
        console.log(`\n🚀 Server running at http://localhost:${PORT}`);
        console.log(`Access your main site at: http://localhost:${PORT}/index.html`);
    });
}

startServer();