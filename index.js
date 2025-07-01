// Filename: index.js (or server.js)

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// Helper function to find and parse JSON from a string
const extractAndParseJson = (text) => {
  try {
    const startIndex = text.indexOf('{');
    const endIndex = text.lastIndexOf('}');
    if (startIndex === -1 || endIndex === -1) {
      throw new Error("No JSON object found in the string.");
    }
    const jsonString = text.substring(startIndex, endIndex + 1);
    return JSON.parse(jsonString);
  } catch (error) {
    console.error("Failed during JSON extraction/parsing:", error);
    throw new Error("Malformed JSON response from AI.");
  }
};

app.post('/gemini-proxy', async (req, res) => {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'API key not configured on the server.' });
  }

  const GOOGLE_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  try {
    // --- First Attempt ---
    let googleResponse = await fetch(GOOGLE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });

    if (!googleResponse.ok) {
        const errorBody = await googleResponse.text();
        console.error("Initial Error from Google API:", errorBody);
        throw new Error(`Google API responded with status ${googleResponse.status}`);
    }
    
    let data = await googleResponse.json();

    if (data.candidates && data.candidates.length > 0) {
      const textResponse = data.candidates[0].content.parts[0].text;
      try {
        const parsedJson = extractAndParseJson(textResponse);
        // Add a check to see if IMEI was captured
        if (parsedJson.imei) {
            return res.json(parsedJson); // Success on first try!
        }
        // If IMEI is missing, we'll fall through to the retry logic
        console.warn("IMEI not found on first attempt. Initiating Smart Retry...");
        throw new Error("Missing IMEI"); 
      } catch (firstError) {
        console.warn("First attempt failed or was incomplete, initiating Smart Retry...");
        
        // --- Smart Retry Attempt ---
        // Modify the prompt to be more forceful and specific about the IMEI
        const originalPrompt = req.body.contents[0].parts[0].text;
        const retryPrompt = `Your previous response was incomplete or not valid JSON. Please try again. Look at the image carefully. Extract the 'Client name', 'Phone#', 'Price', 'Model', and especially the 'IMEI#'. The IMEI# is a long numeric string. Provide ONLY the valid JSON object as requested. Do not include any extra text or explanations. The original request was: "${originalPrompt}"`;
        
        const retryPayload = { ...req.body };
        retryPayload.contents[0].parts[0].text = retryPrompt;

        googleResponse = await fetch(GOOGLE_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(retryPayload)
        });

        if (!googleResponse.ok) {
            const errorBody = await googleResponse.text();
            console.error("Retry Error from Google API:", errorBody);
            throw new Error(`Google API (retry) responded with status ${googleResponse.status}`);
        }

        data = await googleResponse.json();

        if (data.candidates && data.candidates.length > 0) {
            const retryTextResponse = data.candidates[0].content.parts[0].text;
            const parsedJson = extractAndParseJson(retryTextResponse); // This will throw if it fails again
            return res.json(parsedJson); // Success on second try!
        }
      }
    }
    
    // If we reach here, both attempts failed or there were no candidates
    throw new Error("AI did not provide a valid response after two attempts.");

  } catch (error) {
    console.error('Proxy Server Final Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Proxy server with Smart Retry listening on port ${PORT}`);
});
