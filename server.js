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






//404
app.all(/.*/, (req, res) => {
  res.status(404).json({
    status: 404,
    error: "API not found",
  });
});