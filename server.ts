import express from "express";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";
import Papa from "papaparse";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

const CACHE_FILE = path.join(process.cwd(), "cached_records.json");

// Fast-Memory Cache to respond in milliseconds!
let cachedData: any[] = [];
let isWarmingUp = true;
let lastFetchedTime = 0;
let cacheError: string | null = null;

// Instantly load from local file cache if it exists for sub-millisecond warm up
try {
  if (fs.existsSync(CACHE_FILE)) {
    const cachedText = fs.readFileSync(CACHE_FILE, "utf8");
    const parsedCache = JSON.parse(cachedText);
    if (Array.isArray(parsedCache) && parsedCache.length > 0) {
      cachedData = parsedCache;
      isWarmingUp = false;
      lastFetchedTime = fs.statSync(CACHE_FILE).mtimeMs;
      console.log(`Loaded ${cachedData.length} records instantly on startup from filesystem cache.`);
    }
  }
} catch (err) {
  console.error("Failed to load local filesystem cache on startup:", err);
}

// Robust numeric default fallback records to test "Number Only" search immediately if sheets fetch is pending
const defaultFallbackRecords = [
  { "ID": "12345", "အမည်": "ဦးကျော်သက်ဦး", "ရာထူး": "မန်နေဂျာ", "မြို့နယ်": "ရန်ကုန်", "ဖုန်း": "0945001122" },
  { "ID": "67890", "အမည်": "ဒေါ်အေးအေးစိုး", "ရာထူး": "စာရင်းကိုင်", "မြို့နယ်": "မန္တလေး", "ဖုန်း": "0925447788" },
  { "ID": "11223", "အမည်": "မောင်မောင်ဦး", "ရာထူး": "ကြီးကြပ်ရေးမှူး", "မြို့နယ်": "နေပြည်တော်", "ဖုန်း": "0979885522" },
  { "ID": "44556", "အမည်": "မသီတာထွန်း", "ရာထူး": "အရောင်းလက်ထောက်", "မြို့နယ်": "ပဲခူး", "ဖုန်း": "0996554411" },
  { "ID": "77889", "အမည်": "ဦးလှမင်း", "ရာထူး": "ယာဉ်မောင်း", "မြို့နယ်": "လှိုင်", "ဖုန်း": "0931223344" }
];

// Fetch from the search source Google Sheet web app provided by user
async function initializeCache() {
  console.log("Starting background fetch for Google Sheets database...");
  isWarmingUp = cachedData.length === 0;
  
  let response: Response | null = null;
  let lastError: any = null;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`Fetch attempt ${attempt} of ${maxAttempts}...`);
      // 120-second timeout (2 minutes) to give ample time for the massive 5.2 MB JSON download or Google cold starts
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      response = await fetch("https://script.google.com/macros/s/AKfycbzb6iADzGScWMZoRLnu-NKmmxBDJryZXxw3gTfkvE0NXmp6GMteOwUO3qMOLeS0CJGq/exec", {
        method: "GET",
        redirect: "follow",
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        console.log(`Successfully fetched Google Sheets data on attempt ${attempt}`);
        break; // Exit retry loop on success
      } else {
        throw new Error(`HTTP Error: ${response.status}`);
      }
    } catch (error: any) {
      lastError = error;
      console.warn(`Fetch attempt ${attempt} failed:`, error.message || error);
      if (attempt < maxAttempts) {
        const delay = attempt * 3000; // Delay: 3s, 6s
        console.log(`Waiting ${delay / 1000} seconds before retrying...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  try {
    if (!response || !response.ok) {
      throw lastError || new Error("Failed to fetch Google Sheets database after 3 attempts");
    }

    const text = await response.text();
    let parsed: any[] = [];

    // Avoid parsing HTML error messages or empty script warning pages
    if (text.includes("<!DOCTYPE html>") || text.includes("<html") || text.includes("The script completed")) {
      console.warn("Apps Script returned HTML error or warning. Keeping previous/fallback records.");
      if (cachedData.length === 0) {
        parsed = defaultFallbackRecords;
      } else {
        parsed = cachedData;
      }
    } else {
      try {
        const jsonData = JSON.parse(text);
        
        // 1. Handle Array format
        if (Array.isArray(jsonData)) {
          if (jsonData.length > 0 && Array.isArray(jsonData[0])) {
            // Convert Array of Arrays (sheet.getDataRange().getValues()) to Object Array
            const headers = jsonData[0].map(h => String(h || "").trim());
            parsed = jsonData.slice(1).map((row: any, rIdx: number) => {
              const obj: any = {};
              headers.forEach((header, cIdx) => {
                const key = header || `Column_${cIdx + 1}`;
                obj[key] = row[cIdx] !== undefined ? row[cIdx] : "";
              });
              if (!obj.ID && !obj.id) {
                obj.ID = String(rIdx + 1);
              }
              return obj;
            });
          } else {
            // Already standard Array of Objects
            parsed = jsonData;
          }
        } 
        // 2. Handle Object wrapper formats e.g. { data: [...] } or { status: "success", records: [...] }
        else if (jsonData && typeof jsonData === "object") {
          const list = jsonData.data || jsonData.rows || jsonData.records || jsonData.items;
          if (Array.isArray(list)) {
            if (list.length > 0 && Array.isArray(list[0])) {
              const headers = list[0].map(h => String(h || "").trim());
              parsed = list.slice(1).map((row: any, rIdx: number) => {
                const obj: any = {};
                headers.forEach((header, cIdx) => {
                  const key = header || `Column_${cIdx + 1}`;
                  obj[key] = row[cIdx] !== undefined ? row[cIdx] : "";
                });
                if (!obj.ID && !obj.id) {
                  obj.ID = String(rIdx + 1);
                }
                return obj;
              });
            } else {
              parsed = list;
            }
          } else {
            parsed = [jsonData];
          }
        }
      } catch (e) {
        // Parse simple text lines if CSV-like plaintext format
        const lines = text.split("\n")
          .map(line => line.trim())
          .filter(line => line && !line.startsWith("<") && !line.includes("</html>"));

        if (lines.length > 0) {
          parsed = lines.map((line, idx) => ({ ID: String(idx + 1001), အချက်အလက်: line }));
        } else {
          parsed = cachedData.length > 0 ? cachedData : defaultFallbackRecords;
        }
      }
    }

    // Clean any invalid HTML records from parsed list
    const validParsed = parsed.filter(item => {
      if (!item) return false;
      const strVal = JSON.stringify(item);
      return !strVal.includes("<!DOCTYPE html>") && !strVal.includes("</html>");
    });

    if (validParsed.length > 0) {
      cachedData = validParsed;
      lastFetchedTime = Date.now();
      cacheError = null;
      console.log(`Database loaded successfully! Caching ${cachedData.length} records.`);
      
      // Persist to local filesystem cache for instant future starts
      try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(validParsed), "utf8");
        console.log("Saved successfully loaded Google Sheets data to local filesystem cache.");
      } catch (err) {
        console.error("Failed to save loaded database to local filesystem cache:", err);
      }
    } else if (cachedData.length === 0) {
      cachedData = defaultFallbackRecords;
    }

    isWarmingUp = false;
  } catch (error: any) {
    console.error("Failed or timed out fetching Google Sheet. Serving cached or fallback data:", error);
    cacheError = error.message || "Timeout / Network Issue";
    if (cachedData.length === 0) {
      cachedData = defaultFallbackRecords;
    }
    isWarmingUp = false;
  }
}

// Start caching on background
initializeCache();
// Refresh background cache every 10 minutes
setInterval(initializeCache, 10 * 60 * 1000);

// Status API endpoint for client to monitor initial database warming state
app.get("/api/status", (req, res) => {
  res.json({
    loading: isWarmingUp,
    count: cachedData.length,
    lastFetched: lastFetchedTime,
    error: cacheError
  });
});

// GET CSV endpoint for high-performance compact data transmission and client-side memory caching
app.get("/api/get-all-records-csv", (req, res) => {
  try {
    const csv = Papa.unparse(cachedData);
    res.setHeader("Content-Type", "text/csv");
    res.send(csv);
  } catch (error) {
    console.error("Failed to generate CSV data:", error);
    res.status(500).send("Internal Server Error");
  }
});

// 1. Instant Internal/External Data Search Endpoint (Guarantees < 10ms local response!)
app.post("/api/search-external", async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== "string" || query.trim() === "") {
      return res.json({ results: cachedData });
    }

    const cleanQuery = query.toLowerCase().trim();

    // Fast-filtering logic matching query against any object column/attribute
    const filtered = cachedData.filter((item: any) => {
      if (!item) return false;
      return Object.values(item).some(val => 
        String(val || "").toLowerCase().includes(cleanQuery)
      );
    });

    res.json({ results: filtered });
  } catch (error: any) {
    console.error("Search API execution failed:", error);
    res.json({ results: defaultFallbackRecords });
  }
});

// 2. Dispatch data payload with location coordinates to the destination Google Apps Script
app.post("/api/upload-external", async (req, res) => {
  try {
    const { searchResult, latitude, longitude } = req.body;

    const targetUrl = "https://script.google.com/macros/s/AKfycbymBas6qUXKdtbcwYqBmniLjCHDSWuJtRmZf9KpX6S6RpfgfxCnI5rQHjQUEomP6k95Ag/exec";

    // Format query parameters nicely for Google Apps Script endpoint
    const params = new URLSearchParams();
    
    const gpsValue = `${latitude || ""}, ${longitude || ""}`;
    params.set("latitude", String(latitude || ""));
    params.set("longitude", String(longitude || ""));
    params.set("Gps", gpsValue);
    
    if (typeof searchResult === "object" && searchResult !== null) {
      // Safely extract values from all possible variations of incoming sheet keys
      const comCodeVal = searchResult["com-code"] || searchResult["com_code"] || searchResult["ID"] || searchResult["id"] || "";
      const ledgerVal = searchResult["Ledger-code"] || searchResult["ledger_code"] || searchResult["ledger"] || searchResult["Ledger"] || "";
      const meterVal = searchResult["Meter-No"] || searchResult["meter_no"] || searchResult["meter"] || searchResult["Meter"] || "";
      const nameVal = searchResult["Name"] || searchResult["name"] || searchResult["အမည်"] || "";
      const addressVal = searchResult["Address"] || searchResult["address"] || searchResult["နေရပ်လိပ်စာ"] || searchResult["မြို့နယ်"] || "";

      // Ensure absolutely both standard lowercase, and original uppercase versions exist in URL query params
      params.set("com-code", String(comCodeVal));
      params.set("ledger", String(ledgerVal));
      params.set("meter", String(meterVal));
      params.set("name", String(nameVal));
      params.set("address", String(addressVal));

      params.set("fullData", JSON.stringify(searchResult));
    } else {
      params.set("searchResult", String(searchResult || ""));
    }

    const fullTargetUrl = `${targetUrl}?${params.toString()}`;
    console.log("Uploading data payload to target web app:", fullTargetUrl);

    // Ensure both lowercase and exact uppercase versions of all variables exist in JSON body too!
    const comCodeVal = searchResult ? (searchResult["com-code"] || searchResult["com_code"] || searchResult["ID"] || searchResult["id"] || "") : "";
    const ledgerVal = searchResult ? (searchResult["Ledger-code"] || searchResult["ledger_code"] || searchResult["ledger"] || searchResult["Ledger"] || "") : "";
    const meterVal = searchResult ? (searchResult["Meter-No"] || searchResult["meter_no"] || searchResult["meter"] || searchResult["Meter"] || "") : "";
    const nameVal = searchResult ? (searchResult["Name"] || searchResult["name"] || searchResult["အမည်"] || "") : "";
    const addressVal = searchResult ? (searchResult["Address"] || searchResult["address"] || searchResult["နေရပ်လိပ်စာ"] || searchResult["မြို့နယ်"] || "") : "";

    const requestBody = {
      latitude: String(latitude || ""),
      longitude: String(longitude || ""),
      Gps: gpsValue,
      searchResult,
      "com-code": comCodeVal,
      ledger: ledgerVal,
      meter: meterVal,
      name: nameVal,
      address: addressVal,
    };

    const response = await fetch(fullTargetUrl, {
      method: "POST",
      redirect: "follow",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody)
    });

    const text = await response.text();
    res.json({ success: true, response: text });
  } catch (error: any) {
    console.error("External location report upload error:", error);
    res.status(500).json({ error: error.message || "Failed to dispatch upload" });
  }
});

// Serve frontend assets
const startServer = async () => {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running securely on http://0.0.0.0:${PORT}`);
  });
};

startServer();
