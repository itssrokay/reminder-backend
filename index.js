require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { OpenAI } = require('openai');
const jwt = require('jsonwebtoken'); // For authentication
const User = require('./userModel');

// App config
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Ensure the 'uploads' directory exists
const uploadsDir = path.join(__dirname, 'uploads');
const checkUploadsDir = async () => {
  try {
    await fs.access(uploadsDir); // Check if directory exists
  } catch (err) {
    await fs.mkdir(uploadsDir); // Create directory if it doesn't exist
    console.log(`Directory ${uploadsDir} created!`);
  }
};
checkUploadsDir(); // Ensure the directory exists at startup

// DB config
mongoose.set('strictQuery', true);
mongoose.connect(
  'mongodb+srv://itssr:Qwerty123@cluster1.hbgt3yu.mongodb.net/reminderAppDB',
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  },
  () => console.log('DB connected')
);

// Reminder Schema
const reminderSchema = new mongoose.Schema({
  reminderMsg: String,
  remindAt: String,
  isReminded: Boolean,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
});
const Reminder = new mongoose.model('reminder', reminderSchema);

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir); // Use the resolved 'uploads' directory
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Generate unique filename
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

// OpenAI API config
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// API routes
app.use('/uploads', express.static('uploads')); // Serve static files from uploads directory

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
app.get('/test', (req, res) => {
  res.send('Backend is working! heee');
});


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

// Updated route to handle image uploads and generate reminders with IST time conversion
app.post('/generateReminder', upload.single('photo'), async (req, res) => {
  console.log("Received request to generate reminder");

  if (req.file) {
    console.log("File received:", req.file);

    try {
      // Read the file and convert it to base64
      const imageBuffer = await fs.readFile(req.file.path);
      const base64Image = imageBuffer.toString('base64');
      console.log("Base64 image length:", base64Image.length);

      // OpenAI API call with the updated instruction to convert time to IST
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { 
                type: "text", 
                text: `Analyze the image and extract the reminder message and date/time. 
                Convert the extracted time to Indian Standard Time (UTC+05:30) and return a JSON object 
                with two fields: 'reminderMsg' for the reminder message and 'remindAt' for the reminder time. 
                The 'remindAt' field should be in ISO 8601 format (YYYY-MM-DDTHH:MM:SS+05:30), 
                reflecting the time in Indian Standard Time.`
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

      // Log the OpenAI response
      console.log("OpenAI Response:", response.choices[0].message.content);

      // Parse the response and convert the reminder time to IST
      const reminderData = JSON.parse(response.choices[0].message.content.replace(/^```json\s*/, '').replace(/\s*```$/, ''));

      // Delete the uploaded file after processing
      await fs.unlink(req.file.path);

      // Create and save the reminder
      const reminder = new Reminder({
        reminderMsg: reminderData.reminderMsg,
        remindAt: reminderData.remindAt, // The time in IST as per the OpenAI response
        isReminded: false,
        userId: req.body.userId
      });

      await reminder.save();

      res.json({
        message: "Reminder generated and saved",
        reminder: reminder
      });

    } catch (error) {
      console.error("Error processing image with OpenAI:", error);
      res.status(500).send("Error processing image");
    }
  } else {
    console.log("No file received");
    res.status(400).send('Image upload failed!');
  }
});

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

// Reminder checking functionality
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
app.listen(PORT, '0.0.0.0', () => console.log(`Server started on port ${PORT}`));
