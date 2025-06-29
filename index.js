// Filename: index.js (or server.js)

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // Make sure to install this: npm install node-fetch

const app = express();

// Use CORS to allow your deployed website to call this server
app.use(cors({
  origin: '*' // For production, you should restrict this to your actual domain
}));

app.use(express.json({limit: '10mb'})); // Allow larger payloads for images

app.post('/gemini-proxy', async (req, res) => {
  // Get the secret API key from your Render environment variables
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'API key not configured on the server.' });
  }

  const GOOGLE_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const googleResponse = await fetch(GOOGLE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body) // Forward the request body from your frontend
    });

    if (!googleResponse.ok) {
      const errorBody = await googleResponse.text();
      console.error("Error from Google API:", errorBody);
      throw new Error(`Google API responded with status ${googleResponse.status}`);
    }

    const data = await googleResponse.json();

    if (data.candidates && data.candidates.length > 0) {
        let textResponse = data.candidates[0].content.parts[0].text;
        
        // --- THIS IS THE FINAL, ROBUST FIX ---
        // It finds the JSON block even if it's wrapped in markdown or other text.
        try {
            // Find the start and end of the JSON object
            const startIndex = textResponse.indexOf('{');
            const endIndex = textResponse.lastIndexOf('}');
            
            if (startIndex === -1 || endIndex === -1) {
                throw new Error("Could not find a valid JSON object in the AI's response.");
            }

            // Extract only the JSON part of the string
            const jsonString = textResponse.substring(startIndex, endIndex + 1);

            const parsedJson = JSON.parse(jsonString);
            res.json(parsedJson); // Send the clean JSON object back to the frontend

        } catch (jsonError) {
            console.error("JSON Parsing Error on Server:", jsonError);
            console.error("Malformed string from AI:", textResponse);
            res.status(500).json({ error: 'The AI returned a malformed response. Please try again.' });
        }
        // --- END OF FIX ---

    } else {
        console.error("No candidates in AI response:", data);
        res.status(500).json({ error: 'The AI did not provide a valid response.' });
    }

  } catch (error) {
    console.error('Proxy Server Error:', error);
    res.status(500).json({ error: 'An error occurred while contacting the Google AI service.' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Proxy server listening on port ${PORT}`);
});
