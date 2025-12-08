const express = require('express');
const app = express();
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require('./firebaseAdmin');
require('dotenv').config();


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



//404
app.all(/.*/, (req, res) => {
  res.status(404).json({
    status: 404,
    error: "API not found",
  });
});