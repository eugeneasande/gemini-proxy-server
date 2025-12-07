// Filename: index.js (or server.js)

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// Helper to parse JSON from Gemini response
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

// Talk to Gemini API
async function callGoogleApi(apiKey, payload) {
  const GOOGLE_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(GOOGLE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Error from Google API:", errorBody);
    throw new Error(`Google API responded with status ${response.status}`);
  }
  return response.json();
}

app.post('/gemini-proxy', async (req, res) => {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'API key not configured on the server.' });
  }

  try {
    // Step 1: First attempt – general data extraction
    let data = await callGoogleApi(GEMINI_API_KEY, req.body);
    let parsedJson;

    if (data.candidates && data.candidates.length > 0) {
      const textResponse = data.candidates[0].content.parts[0].text;
      parsedJson = extractAndParseJson(textResponse);
    } else {
      throw new Error("AI did not provide an initial response.");
    }

    // Step 2: IMEI fallback if missing
    if (!parsedJson.imei) {
      console.warn("IMEI missing. Initiating fallback extraction...");

      const imeiPrompt = "Analyze the attached image. Find the long numeric string next to the 'IMEI#' label. Respond with ONLY that number, nothing else.";
      const imeiPayload = {
        contents: [{ parts: [ { text: imeiPrompt }, req.body.contents[0].parts[1] ] }]
      };

      const imeiData = await callGoogleApi(GEMINI_API_KEY, imeiPayload);

      if (imeiData.candidates && imeiData.candidates.length > 0) {
        const imeiText = imeiData.candidates[0].content.parts[0].text;
        parsedJson.imei = imeiText.replace(/\D/g, '');
        console.log("✅ IMEI Extracted:", parsedJson.imei);
      } else {
        console.error("❌ IMEI fallback failed.");
      }
    }

    // Step 3: Price fallback if missing
    if (!parsedJson.price) {
      console.warn("Price missing. Initiating fallback extraction...");

      const pricePrompt = "From the attached image, extract the price in Kenyan Shillings. Respond with ONLY the number and currency, for example: '14,500 KES'.";
      const pricePayload = {
        contents: [{ parts: [ { text: pricePrompt }, req.body.contents[0].parts[1] ] }]
      };

      const priceData = await callGoogleApi(GEMINI_API_KEY, pricePayload);

      if (priceData.candidates && priceData.candidates.length > 0) {
        const priceText = priceData.candidates[0].content.parts[0].text.trim();
        parsedJson.price = priceText;
        console.log("✅ Price Extracted:", parsedJson.price);
      } else {
        console.error("❌ Price fallback failed.");
      }
    }

    // Final result
    return res.json(parsedJson);

  } catch (error) {
    console.error('❌ Proxy Server Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🔥 Gemini proxy server running on port ${PORT}`);
});
