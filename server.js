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



//404
app.all(/.*/, (req, res) => {
  res.status(404).json({
    status: 404,
    error: "API not found",
  });
});