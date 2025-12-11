const express = require('express');
const app = express();
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require('./firebaseAdmin');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


// middleware
// app.use(cors());
app.use(cors({
  origin: [
    'https://ph-b12-a11-scholar-stream-client.vercel.app',
    'http://localhost:5173'
  ],
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"]
}));

app.use(express.json());


// firebase verify
const firebaseVerificationToken = async (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return res.status(401).send({
      message: "unauthorized access. Token not found!",
    });
  }

  const token = authorization.split(" ")[1];

  try {
    const decode = await admin.auth().verifyIdToken(token);
    req.user = decode;

    const fullUser = await admin.auth().getUser(decode.uid);

    req.user = {
      uid: decode.uid,
      email: fullUser.providerData[0]?.email || decode.email,
      displayName: fullUser.displayName,
      providerId: fullUser.providerData[0]?.providerId || null,
    };

    // continue
    next();

  } catch (error) {
    res.status(401).send({
      message: "unauthorized access.",
    });
  }
};


// admin verify
const verifyAdmin = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) return res.status(401).send({ message: "Unauthorized" });

  const decoded = await admin.auth().verifyIdToken(token);
  const user = await user_collection.findOne({ email: decoded.email });

  if (user.role !== "admin") {
    return res.status(403).send({ message: "Forbidden: Admins only" });
  }

  req.user = user;
  next();
};

// moderator verify
const verifyModerator = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).send({ message: "Unauthorized: No token provided" });
    }
    // Verify Firebase ID token
    const decoded = await admin.auth().verifyIdToken(token);
    // Find user in MongoDB
    const user = await user_collection.findOne({ email: decoded.email });

    if (!user) {
      return res.status(404).send({ message: "User account not found" });
    }

    // Check if the user is a moderator or admin
    if (user.role !== "moderator") {
      return res.status(403).send({ message: "Forbidden: Moderators only" });
    }
    // Attach user data to req object for later use
    req.user = user;
    next();

  } catch (error) {
    console.error("verifyModerator error:", error);
    return res.status(500).send({ message: "Internal server error" });
  }
};

// admin or moderator
const verifyAdminOrModerator = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    // Verify Firebase token
    const decoded = await admin.auth().verifyIdToken(token);

    // Fetch user from DB
    const user = await user_collection.findOne({ email: decoded.email });

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    // Allow only admin or moderator
    if (user.role !== "admin" && user.role !== "moderator") {
      return res.status(403).send({
        message: "Forbidden: Admin or Moderator only",
      });
    }
    // Attach user data to request object
    req.user = user;

    next();
  } catch (error) {
    console.error("verifyAdminOrModerator Error:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
};


// log report
app.use(async (req, res, next) => {
  console.log(`⚡ ${req.method} - ${req.path} from ${ req.host} at ⌛ ${new Date().toLocaleString()}`);
  next();
});



//ports & clients [MongoDB]
const port = process.env.PORT || 8088;
const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


//listeners
client.connect()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server listening ${port}`);
      console.log(`Server Connected to MongoDB`);
    });
  })
  .catch((err) => {
    console.log(err);
  });



// database setup
const database = client.db('scholar-stream');
const user_collection = database.collection('users');
const scholarship_collection = database.collection('scholarships');
const application_collection = database.collection('applications');
const review_collection = database.collection('reviews');



// Basic routes
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Scholar-Stream Server Active" });
});




/* API */

//  user registration
app.post("/registration",firebaseVerificationToken, async(req, res) => {

    const newUser = req.body;
    const email = newUser.email;

    const isUserAlreadyExists = await user_collection.findOne({email: email});

    if (!isUserAlreadyExists) {
        newUser.role = 'student',
        newUser.created_at = new Date();
        await user_collection.insertOne(newUser);
        res.status(201).json({message: "Registration Successful."});
    }else {
      res.send({ message: 'user already exists' })
    }
});


// check for user-role
app.get('/users/role/:email', firebaseVerificationToken, async(req, res) => {
  const email = req.params.email;
  const result = await user_collection.findOne({email: email});
  res.send(result);
})

// get all users
app.get('/users', firebaseVerificationToken, verifyAdmin, async(req, res) => {
  const result = await user_collection.find().sort({ created_at : 1 }).toArray();
  res.send(result);
})

// change user role
app.patch("/users/role/:id", firebaseVerificationToken, verifyAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const { role } = req.body;

    // Validate new role
    const validRoles = ["student", "moderator", "admin"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: "Invalid role value" });
    }

    // The logged-in user's email from Firebase token
    const requesterEmail = req.user?.email;

    if (!requesterEmail) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Check if the requester is an admin
    const requesterAccount = await user_collection.findOne({
      email: requesterEmail,
    });

    if (!requesterAccount || requesterAccount.role !== "admin") {
      return res.status(403).json({
        message: "Forbidden: Only admins can update user roles",
      });
    }

    // Update the user's role
    const result = await user_collection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { role } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "User role updated successfully",
      updatedRole: role,
    });
  } catch (error) {
    console.error("Error updating role:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


// create scholarship post
app.post('/create-scholarship', firebaseVerificationToken, verifyAdmin, async(req, res) => {
  
  try {
      const newScholarship = req.body;
      newScholarship.scholarshipPostDate = new Date();
      newScholarship.scholarshipPostUpdateDate = new Date();

      const result = await scholarship_collection.insertOne(newScholarship);

      res.status(201).json({
        message: "Scholarship Posted Successfully.",
        scholarshipId: result.insertedId,
      });
    } catch (error) {
      console.error("Error posting scholarship:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
})


// getting all the scholarship (pagination)
app.get('/scholarships', async (req, res) => {
  try {
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;

    let skip = (page - 1) * limit;

    const cursor = scholarship_collection
      .find({})
      .sort({ scholarshipPostUpdateDate: -1 }) // latest first
      .skip(skip)
      .limit(limit);

    const data = await cursor.toArray();
    const total = await scholarship_collection.countDocuments();

    res.json({
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    res.status(500).json({ message: "Error fetching scholarships" });
  }
});


// get scholarship data for analysis
app.get("/scholarship-analysis", firebaseVerificationToken, verifyAdmin, async (req, res) => {
  try {
    const scholarships = await scholarship_collection.find().toArray();
    res.json(scholarships);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch scholarships" });
  }
});



// filtered scholarship
app.get('/filtered', async (req, res) => {
  try {
    const sortBy = req.query.sort; 

    const validSortFields = [
      'scholarshipCategory',
      'universityWorldRank',
      'degree',
      'tuitionFees'
    ];

    if (!validSortFields.includes(sortBy)) {
      return res.status(400).send({ message: 'Invalid sort field' });
    }

    let sortOptions = {};

    // Numeric ascending
    if (sortBy === "universityWorldRank" || sortBy === "tuitionFees") {
      sortOptions[sortBy] = 1;     // 1 = ascending
    } 
    // Alphabetical ascending
    else {
      sortOptions[sortBy] = 1;     // same 1, but for strings it sorts alphabetically
    }

    const result = await scholarship_collection
      .find({})
      .sort(sortOptions)
      .toArray();

    res.send(result);
  } catch (error) {
    console.error('Error fetching sorted scholarships:', error);
    res.status(500).send({ message: 'Internal server error' });
  }
});


// searched result
app.get('/searched', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) return res.status(400).send({ message: "Query is required" });

    const regex = new RegExp(q, 'i'); // case-insensitive search

    const results = await scholarship_collection
      .find({
        $or: [
          { universityName: { $regex: regex } },
          { scholarshipName: { $regex: regex } },
          { universityCountry: { $regex: regex } },
          { universityCity: { $regex: regex } },
          { degree: { $regex: regex } }
        ]
      })
      .toArray();

    res.send(results);

  } catch (error) {
    console.error("Search error:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});


// get scholarship details
app.get('/scholarship-details/:id', firebaseVerificationToken, async (req, res) => {
  try {
    const scholarship_id = req.params.id;

    if (!ObjectId.isValid(scholarship_id)) {
      return res.status(400).json({ message: "Invalid scholarship ID" });
    }

    const scholarship = await scholarship_collection.findOne({
      _id: new ObjectId(scholarship_id)
    });

    if (!scholarship) {
      return res.status(404).json({ message: "Scholarship not found" });
    }

    res.status(200).json(scholarship);
  } catch (error) {
    console.error("Error fetching scholarship:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});


// Get all published scholarships
app.get("/scholarships/published", firebaseVerificationToken, verifyAdminOrModerator, async (req, res) => {
  try {
    const scholarships = await scholarship_collection
      .find({})
      .sort({ scholarshipPostDate: -1 })
      .toArray();
    res.status(200).json(scholarships);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Delete a scholarship
app.delete("/scholarships/:id", firebaseVerificationToken, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await scholarship_collection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 1) {
      res.status(200).json({ success: true });
    } else {
      res.status(404).json({ success: false, message: "Scholarship not found" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});


// PATCH update a scholarship (admin/moderator only)
app.patch("/update-scholarship/:id", firebaseVerificationToken, verifyAdminOrModerator, async (req, res) => {
  const { id } = req.params;
  const updateData = { ...req.body };

  // Prevent _id from being updated
  delete updateData._id;

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid scholarship ID" });
  }

  try {
    // Optional: automatically update last modified date
    updateData.scholarshipPostUpdateDate = new Date();

    const result = await scholarship_collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Scholarship not found" });
    }

    res.status(200).json({ message: "Scholarship updated successfully" });
  } catch (error) {
    console.error("Error updating scholarship:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


// payment
app.post('/payment-checkout-session', firebaseVerificationToken, async (req, res) => {
  try {
    const scholarshipInfo = req.body;

    const amount = parseInt(scholarshipInfo.applicationFees) * 100;

    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: amount,
            product_data: {
              name: `Application Fee for: ${scholarshipInfo.scholarshipName}`
            }
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      customer_email: scholarshipInfo.userId,
      metadata: {
        scholarshipId: scholarshipInfo.scholarshipId,
        scholarshipName: scholarshipInfo.scholarshipName,
        universityName: scholarshipInfo.universityName,
        userId: scholarshipInfo.userId
      },
      success_url: `${process.env.SITE_DOMAIN}/payment/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_DOMAIN}/payment/payment-cancelled`
    });

    res.status(200).send({ url: session.url });

  } catch (error) {
    console.error("Stripe error:", error);
    res.status(500).json({ message: "Payment Session Creation Failed" });
  }
});


// verify payment
app.get('/payment/verify', firebaseVerificationToken, async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    // Retrieve Stripe checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Find existing application entry
    const existingApplication = await application_collection.findOne({
      scholarshipId: session.metadata.scholarshipId,
      userEmail: session.metadata.userId,
    });

    if (!existingApplication) {
      return res.status(404).json({
        success: false,
        message: "Application record not found"
      });
    }

    // Update payment status in MongoDB
    await application_collection.updateOne(
      {
        _id: existingApplication._id
      },
      {
        $set: {
          paymentStatus: session.payment_status === "paid" ? "paid" : "unpaid",
          applicationStatus: "submitted",
          transactionId: session.id,
          amountPaid: session.amount_total/100,
          payment_completed: new Date()
        }
      }
    );

    return res.json({
      success: true,
      sessionId: session.id,
      amount: session.amount_total,
      paymentStatus: session.payment_status,
      scholarshipName: session.metadata.scholarshipName,
      universityName: session.metadata.universityName,
    });

  } catch (error) {
    console.error("Payment verify error:", error);
    res.status(500).json({ message: "Failed to verify payment" });
  }
});


// save payment session
app.post('/save-payment-session', firebaseVerificationToken, async (req, res) => {
  try {
    const session = req.body;
    session.session_created = new Date();
    // Check for existing payment session
    const isPaymentPending = await application_collection.findOne({
      scholarshipId: session.scholarshipId,
      userEmail: session.userEmail
    });
    let insertedId = null;

    if (!isPaymentPending) {
      // Insert only if no record exists
      const result = await application_collection.insertOne(session);
      insertedId = result.insertedId;
    } else {
      // Record already exists → just reuse its ID
      insertedId = isPaymentPending._id;
    }

    // Continue rest of the flow normally
    return res.status(201).json({
      success: true,
      message: "Payment session saved successfully.",
      sessionId: insertedId
    });

  } catch (error) {
    console.error("Error saving payment session:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error."
    });
  }
});


// GET: Payment history for a user
app.get("/payment-history", firebaseVerificationToken, async (req, res) => {
  try {
    const userEmail = req.query.email;

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        message: "User email is required.",
      });
    }

    // Fetch all application/payment records of this user
    const payments = await application_collection
      .find({ userEmail })
      .sort({ session_created: -1 }) // newest first
      .toArray();

    return res.status(200).json(payments);

  } catch (error) {
    console.error("Error fetching payment history:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load payment history.",
    });
  }
});



// reviews
app.post('/reviews', firebaseVerificationToken, async (req, res) => {
  try {
    const review = req.body;
    const result = await review_collection.insertOne(review);

    res.json({ success: true, id: result.insertedId });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to save review" });
  }
});


// get specified reviews
app.get("/reviews", firebaseVerificationToken, async (req, res) => {
  try {
    const scholarshipId = req.query.scholarshipId;

    const reviews = await review_collection
      .find({ scholarshipId })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(reviews);
  } catch (error) {
    console.error("Fetch reviews error:", error);
    res.status(500).json({ message: "Failed to fetch reviews" });
  }
});


// get all reviews (admin)
app.get("/scholarship-reviews", firebaseVerificationToken, verifyAdminOrModerator, async (req, res) => {
  try {
    // Fetch all reviews
    const reviews = await review_collection.find().sort({ createdAt: -1 }).toArray();

    // Fetch scholarship titles for each review
    const reviewsWithScholarship = await Promise.all(
      reviews.map(async (review) => {
        const scholarship = await scholarship_collection.findOne({
          _id: new ObjectId(review.scholarshipId),
        });

        return {
          ...review,
          scholarshipName: scholarship ? scholarship.scholarshipName : "Unknown Scholarship",
          universityName: scholarship ? scholarship.universityName : "Unknown University",
          universityCity: scholarship ? scholarship.universityCity : "Unknown City",
          universityCountry: scholarship ? scholarship.universityCountry : "Unknown Country",
        };
      })
    );

    res.status(200).json(reviewsWithScholarship);
  } catch (err) {
    console.error("Error fetching reviews:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});


// review delete (admin/moderator)
app.delete("/reviews/:id", firebaseVerificationToken, verifyAdminOrModerator, async (req, res) => {
  try {
    const reviewId = req.params.id;

    if (!ObjectId.isValid(reviewId)) {
      return res.status(400).json({ message: "Invalid review ID" });
    }

    const result = await review_collection.deleteOne({ _id: new ObjectId(reviewId) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Review not found" });
    }

    res.status(200).json({ message: "Review deleted successfully" });
  } catch (error) {
    console.error("Error deleting review:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});


// GET /applications
app.get("/applications", firebaseVerificationToken, async (req, res) => {
  try {
    // The user's email comes from the verified Firebase token
    const userEmail = req.user.email;

    if (!userEmail) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Fetch all applications for the logged-in user
    const applications = await application_collection
      .find({ userEmail })
      .sort({ session_created: -1 }) // newest first
      .toArray();

    res.status(200).json(applications);
  } catch (error) {
    console.error("Error fetching applications:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


// delete application
app.delete("/applications/:scholarshipId", firebaseVerificationToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const scholarshipId = req.params.scholarshipId;

    if (!userEmail) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Only delete If application belongs to logged-in user & is pending
    const result = await application_collection.deleteOne({
      userEmail,
      scholarshipId,
      applicationStatus: "pending"
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        message: "Application not found or cannot be deleted."
      });
    }

    res.status(200).json({ message: "Application deleted successfully" });

  } catch (error) {
    console.error("Error deleting application:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


// Get all applications paid/unpaid
app.get("/application-analysis", firebaseVerificationToken, verifyAdmin, async (req, res) => {
  try {
    const applications = await application_collection.find().toArray();
    res.json(applications);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch applications" });
  }
});


// applicant list
app.get("/applications/paid", firebaseVerificationToken, verifyAdminOrModerator, async (req, res) => {
  try {
    const paidApplicants = await application_collection
      .find({ paymentStatus: "paid" })
      .sort({ session_created: -1 })
      .toArray();

    res.status(200).json(paidApplicants);
  } catch (error) {
    console.error("Error fetching paid applicants:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});



// Update feedback for an application
app.patch("/applications/feedback/:id",firebaseVerificationToken, verifyAdminOrModerator, async (req, res) => {
  try {
    const { id } = req.params;
    const { feedback } = req.body;

    const result = await application_collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { feedback } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ message: "Application not found or feedback unchanged" });
    }

    res.json({ message: "Feedback updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update feedback" });
  }
});


// Get feedbacks for a specific applicant by email
app.get("/applications/feedback/:email", firebaseVerificationToken, async (req, res) => {
  try {
    const { email } = req.params;

    const feedbacks = await application_collection
      .find({ userEmail: email, feedback: { $ne: null } })
      .sort({ session_created: -1 })
      .toArray();

    res.json(feedbacks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch feedbacks" });
  }
});


// dashboard main-page stats 
app.get("/dashboard-stats", firebaseVerificationToken, async (req, res) => {
  try {
    // Count all collections in parallel
    const [
      totalApplicants,
      totalScholarships,
      totalApplications,
      totalReviews,
    ] = await Promise.all([
      application_collection.countDocuments({ paymentStatus: "paid" }),
      scholarship_collection.countDocuments(),
      application_collection.countDocuments(),
      review_collection.countDocuments(),
    ]);

    res.json({
      applicants: totalApplicants,
      scholarships: totalScholarships,
      applications: totalApplications,
      reviews: totalReviews,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch dashboard stats" });
  }
});



//404
app.all(/.*/, (req, res) => {
  res.status(404).json({
    status: 404,
    error: "API not found",
  });
});       