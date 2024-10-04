require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
// const fs = require('fs');
const { OpenAI } = require('openai');
const fs = require('fs').promises;
const User = require('./userModel');

// App config
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Suppress Mongoose strictQuery warning
mongoose.set('strictQuery', true);

// DB config
mongoose.connect(
  'mongodb+srv://itssr:Qwerty123@cluster1.hbgt3yu.mongodb.net/reminderAppDB',
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  },
  () => console.log('DB connected')
);

const reminderSchema = new mongoose.Schema({
  reminderMsg: String,
  remindAt: String,
  isReminded: Boolean,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
});

const Reminder = new mongoose.model('reminder', reminderSchema);



// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const fileTypes = /jpeg|jpg|png/;
    const extname = fileTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = fileTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb("Error: Images Only!");
    }
  }
});

// OpenAI config
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const jwt = require('jsonwebtoken'); // Add this at the top of your file

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Serve uploaded files statically
app.use('/uploads', express.static('uploads'));

// API routes
app.get('/getAllReminder', async (req, res) => {
  const { userId } = req.query;
  try {
    const reminderList = await Reminder.find({ userId });
    res.json(reminderList);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching reminders');
  }
});


app.post('/generateReminder', upload.single('photo'), async (req, res) => {
  console.log("Received request to generate reminder");

  if (req.file) {
    console.log("File received:", req.file); // Log the file details
    try {
      // Read the file and convert it to base64
      const imageBuffer = await fs.readFile(req.file.path);
      const base64Image = imageBuffer.toString('base64');

      console.log("Base64 image length:", base64Image.length); // Log the size of the base64 image

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { 
                type: "text", 
                text: `Analyze the image and extract the reminder message and date/time information. Return a JSON object with the following fields:
      - 'reminderMsg' for the reminder message.
      - 'remindAt' for the reminder time.

      Ensure the following when generating the output:
      1. The 'remindAt' field should be in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sss without a timezone suffix like 'Z').
      2. If a date is mentioned but no year is specified, assume the current year.
      3. If no time is mentioned, assume 09:00 AM by default.
      4. If the time is provided, ensure it reflects exactly what is mentioned (e.g., if '7 AM' is mentioned, it should be represented as 07:00:00).

      Return only the JSON object, without any additional text or markdown.`
    },

              {
                type: "image_url",
                image_url: {
                  url: `data:image/${req.file.mimetype};base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 300
      });

      console.log("OpenAI Response:", response.choices[0].message.content); // Log the response

      // Process and send response
      const jsonString = response.choices[0].message.content.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      const reminderData = JSON.parse(jsonString);

      await fs.unlink(req.file.path); // Delete file after processing

      const reminder = new Reminder({
        reminderMsg: reminderData.reminderMsg,
        remindAt: reminderData.remindAt,
        isReminded: false,
        userId: req.body.userId
      });

      await reminder.save();

      res.json({
        message: "Reminder generated and saved",
        reminder: reminder
      });

    } catch (error) {
      console.error("Error processing image with OpenAI:", error); // Log the error
      res.status(500).send("Error processing image");
    }
  } else {
    console.log("No file received");
    res.status(400).send('Image upload failed!');
  }
});
// app.get('/aryan',()=>{
//   console.log("Hello world");
//   res.send('<h1>hello</h1>')
// })


app.post('/addReminder', async (req, res) => {
  const { reminderMsg, remindAt, userId } = req.body;
  const reminder = new Reminder({
    reminderMsg,
    remindAt,
    isReminded: false,
    userId
  });
  try {
    await reminder.save();
    const reminderList = await Reminder.find({ userId });
    res.json(reminderList);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error saving reminder');
  }
});

app.post('/deleteReminder', (req, res) => {
  Reminder.deleteOne({ _id: req.body.id }, (err) => {
    if (err) {
      console.log(err);
      res.status(500).send('Error deleting reminder');
    } else {
      Reminder.find({}, (err, reminderList) => {
        if (err) {
          console.log(err);
          res.status(500).send('Error fetching reminders');
        } else {
          res.send(reminderList);
        }
      });
    }
  });
});
app.post('/signup', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      role
    });

    await newUser.save();

    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ message: 'Error creating user', error: error.message });
  }
});
// Existing reminder checking functionality
setInterval(() => {
  Reminder.find({}, (err, reminderList) => {
    if (err) {
      console.log(err);
    }
    if (reminderList) {
      reminderList.forEach((reminder) => {
        if (!reminder.isReminded) {
          const now = new Date();
          if (new Date(reminder.remindAt) - now < 0) {
            Reminder.findByIdAndUpdate(
              reminder.id,
              { isReminded: true },
              (err, remindObj) => {
                if (err) {
                  console.log(err);
                }
                // Whatsapp reminding functionality by Twilio
                const accountSid = process.env.ACCOUNT_SID;
                const authToken = process.env.AUTH_TOKEN;
                const client = require('twilio')(accountSid, authToken);

                client.messages
                  .create({
                    body: reminder.reminderMsg,
                    from: 'whatsapp:+14155238886',
                    to: 'whatsapp:+917033762468',
                  })
                  .then((message) => console.log(message.sid))
                  .done();
              }
            );
          }
        }
      });
    }
  });
}, 1000);

const PORT = process.env.PORT || 9000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));