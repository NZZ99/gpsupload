import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Search, MapPin, ArrowUp, Check, RefreshCw, AlertCircle, Navigation, X, ShieldCheck, Delete, Copy
} from "lucide-react";
import Papa from "papaparse";

interface ExternalRecord {
  [key: string]: any;
}

export default function App() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [searchResults, setSearchResults] = useState<ExternalRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<ExternalRecord | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Coordinate Inputs
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [ddValue, setDdValue] = useState("");
  const [copied, setCopied] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const latestQueryRef = useRef("");

  const [localRecords, setLocalRecords] = useState<ExternalRecord[]>([]);
  const [isDbLoading, setIsDbLoading] = useState(true);

  // Default fallback records for instant client-side testing
  const defaultFallbackRecords = [
    { "ID": "12345", "အမည်": "ဦးကျော်သက်ဦး", "ရာထူး": "မန်နေဂျာ", "မြို့နယ်": "ရန်ကုန်", "ဖုန်း": "0945001122" },
    { "ID": "67890", "အမည်": "ဒေါ်အေးအေးစိုး", "ရာထူး": "စာရင်းကိုင်", "မြို့နယ်": "မန္တလေး", "ဖုန်း": "0925447788" },
    { "ID": "11223", "အမည်": "မောင်မောင်ဦး", "ရာထူး": "ကြီးကြပ်ရေးမှူး", "မြို့နယ်": "နေပြည်တော်", "ဖုန်း": "0979885522" },
    { "ID": "44556", "အမည်": "မသီတာထွန်း", "ရာထူး": "အရောင်းလက်ထောက်", "မြို့နယ်": "ပဲခူး", "ဖုန်း": "0996554411" },
    { "ID": "77889", "အမည်": "ဦးလှမင်း", "ရာထူး": "ယာဉ်မောင်း", "မြို့နယ်": "လှိုင်", "ဖုန်း": "0931223344" }
  ];

  // Load from LocalStorage or CDN Snapshot instantly on mount and update with background CSV fetch
  useEffect(() => {
    let loadedFromCache = false;

    // Safely write to localStorage with quota check and try-catch
    const safeSaveToLocalStorage = (key: string, value: string) => {
      try {
        // 5MB is roughly 5,000,000 characters. Let's limit cache to 3.5MB to be safe and avoid QuotaExceededError
        if (value.length < 3.5 * 1024 * 1024) {
          localStorage.setItem(key, value);
        } else {
          console.log(`Database size (${(value.length / 1024 / 1024).toFixed(2)}MB) is too large for LocalStorage. Skipping cache.`);
        }
      } catch (e) {
        console.warn("Could not save database cache to LocalStorage:", e);
      }
    };

    // 1. Try to load instantly from LocalStorage cache (takes ~10-20ms)
    const cachedCsv = localStorage.getItem("cached_csv_records");
    if (cachedCsv) {
      try {
        const parsed = Papa.parse<ExternalRecord>(cachedCsv, { header: true, skipEmptyLines: true });
        if (parsed.data && parsed.data.length > 5) {
          setLocalRecords(parsed.data);
          loadedFromCache = true;
          setIsDbLoading(false);
          console.log(`Loaded ${parsed.data.length} records instantly from LocalStorage cache.`);
        }
      } catch (err) {
        console.error("LocalStorage parsing failed:", err);
      }
    }

    // 2. If no LocalStorage cache, fetch the pre-compiled CDN snapshot instantly (<200ms)
    if (!loadedFromCache) {
      // Seed fallback records first to be safe
      setLocalRecords(defaultFallbackRecords);

      fetch("/database_snapshot.json")
        .then(res => {
          if (res.ok) return res.json();
          throw new Error();
        })
        .then(data => {
          if (Array.isArray(data) && data.length > 0) {
            setLocalRecords(data);
            setIsDbLoading(false);
            console.log(`Loaded ${data.length} records instantly from CDN snapshot!`);
            safeSaveToLocalStorage("cached_csv_records", Papa.unparse(data));
          }
        })
        .catch(err => {
          console.warn("Could not load database snapshot from CDN:", err);
        });
    }

    // 3. Freshly fetch the compact CSV from server to silent-refresh cache in background
    const fetchFreshRecords = async () => {
      let fetchSuccessful = false;

      try {
        const response = await fetch("/api/get-all-records-csv");
        if (response.ok) {
          const csvText = await response.text();
          if (csvText && csvText.trim()) {
            const parsed = Papa.parse<ExternalRecord>(csvText, { header: true, skipEmptyLines: true });
            if (parsed.data && parsed.data.length > 0) {
              setLocalRecords(parsed.data);
              setIsDbLoading(false);
              safeSaveToLocalStorage("cached_csv_records", csvText);
              console.log(`Loaded & cached ${parsed.data.length} records freshly from server CSV.`);
              fetchSuccessful = true;
            }
          }
        }
      } catch (err) {
        console.warn("Server API fetch not available (expected if running as static hosting on GitHub Pages):", err);
      }

      // If server API fails (e.g. running on GitHub Pages as static site), fetch directly from the Google Apps Script Web App!
      if (!fetchSuccessful) {
        try {
          console.log("Attempting direct cross-origin fetch from Google Apps Script web app...");
          const response = await fetch("https://script.google.com/macros/s/AKfycbzb6iADzGScWMZoRLnu-NKmmxBDJryZXxw3gTfkvE0NXmp6GMteOwUO3qMOLeS0CJGq/exec", {
            method: "GET"
          });
          if (response.ok) {
            const text = await response.text();
            
            // Check if response is HTML warning or error
            if (text && text.trim() && !text.includes("<!DOCTYPE html>") && !text.includes("<html")) {
              let parsedData: ExternalRecord[] = [];
              try {
                const jsonData = JSON.parse(text);
                
                if (Array.isArray(jsonData)) {
                  if (jsonData.length > 0 && Array.isArray(jsonData[0])) {
                    const headers = jsonData[0].map((h: any) => String(h || "").trim());
                    parsedData = jsonData.slice(1).map((row: any, rIdx: number) => {
                      const obj: any = {};
                      headers.forEach((header, cIdx) => {
                        const key = header || `Column_${cIdx + 1}`;
                        obj[key] = row[cIdx] !== undefined ? row[cIdx] : "";
                      });
                      if (!obj.ID && !obj.id) obj.ID = String(rIdx + 1);
                      return obj;
                    });
                  } else {
                    parsedData = jsonData;
                  }
                } else if (jsonData && typeof jsonData === "object") {
                  const list = jsonData.data || jsonData.rows || jsonData.records || jsonData.items;
                  if (Array.isArray(list)) {
                    if (list.length > 0 && Array.isArray(list[0])) {
                      const headers = list[0].map((h: any) => String(h || "").trim());
                      parsedData = list.slice(1).map((row: any, rIdx: number) => {
                        const obj: any = {};
                        headers.forEach((header, cIdx) => {
                          const key = header || `Column_${cIdx + 1}`;
                          obj[key] = row[cIdx] !== undefined ? row[cIdx] : "";
                        });
                        if (!obj.ID && !obj.id) obj.ID = String(rIdx + 1);
                        return obj;
                      });
                    } else {
                      parsedData = list;
                    }
                  } else {
                    parsedData = [jsonData];
                  }
                }
              } catch (e) {
                // If JSON parsing fails, attempt to parse as CSV
                const parsed = Papa.parse<ExternalRecord>(text, { header: true, skipEmptyLines: true });
                if (parsed.data && parsed.data.length > 0) {
                  parsedData = parsed.data;
                }
              }

              if (parsedData.length > 0) {
                setLocalRecords(parsedData);
                setIsDbLoading(false);
                const serialized = Papa.unparse(parsedData);
                safeSaveToLocalStorage("cached_csv_records", serialized);
                console.log(`Loaded & cached ${parsedData.length} records directly from Google Apps Script Web App.`);
                fetchSuccessful = true;
              }
            }
          }
        } catch (directErr) {
          console.error("Direct Google Apps Script fetch failed too:", directErr);
        }
      }

      // If all fails, make sure we stop loading so they can use defaultFallbackRecords!
      if (!fetchSuccessful) {
        setIsDbLoading(false);
      }
    };

    fetchFreshRecords();
  }, []);

  // Triggers the search query instantly in-memory
  const performSearch = (query: string) => {
    latestQueryRef.current = query;
    const cleanQuery = query.trim();

    // Clear old coordinate fields when searching for a new code
    setLatitude("");
    setLongitude("");
    setDdValue("");

    if (cleanQuery === "") {
      setSearchResults([]);
      setHasSearched(false);
      setSelectedRecord(null);
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    setError(null);
    setSelectedRecord(null);
    setUploadSuccess(false);

    const cleanQueryLower = cleanQuery.toLowerCase();
    const hasRealData = localRecords.length > 10;

    // 1. If we have real client-side cached records loaded in memory, search them instantly! (< 1ms!)
    if (hasRealData) {
      const results = localRecords.filter((item) => {
        if (!item) return false;
        return Object.values(item).some(val => 
          String(val || "").toLowerCase().includes(cleanQueryLower)
        );
      });

      setSearchResults(results);
      if (results.length > 0) {
        setSelectedRecord(results[0]);
      } else {
        setSelectedRecord(null);
      }
      setIsSearching(false);
    } else {
      // 2. Smart fallback search if snapshot is still loading (first ever load)
      fetch("/api/search-external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: cleanQuery }),
      })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        if (latestQueryRef.current === query) {
          const results = data.results || [];
          setSearchResults(results);
          if (results.length > 0) {
            setSelectedRecord(results[0]);
          } else {
            setSelectedRecord(null);
          }
        }
      })
      .catch((err) => {
        console.error("Server fallback search failed, using fallback:", err);
        const fallbackResults = defaultFallbackRecords.filter((item) => {
          return Object.values(item).some(val => 
            String(val || "").toLowerCase().includes(cleanQueryLower)
          );
        });
        if (latestQueryRef.current === query) {
          setSearchResults(fallbackResults);
          if (fallbackResults.length > 0) {
            setSelectedRecord(fallbackResults[0]);
          } else {
            setSelectedRecord(null);
          }
        }
      })
      .finally(() => {
        if (latestQueryRef.current === query) {
          setIsSearching(false);
        }
      });
    }
  };

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    performSearch(inputValue);
  };

  // Filter keys for input values (Accepts numbers only - search triggered manually by Enter or Search icon)
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const numericVal = val.replace(/[^0-9]/g, "");
    setInputValue(numericVal);
    if (numericVal === "") {
      setSelectedRecord(null);
      setSearchResults([]);
      setHasSearched(false);
      // Clear coordinates when the input is cleared
      setLatitude("");
      setLongitude("");
      setDdValue("");
    }
  };

  // GPS Coordinates helper
  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      alert("သင့်ဘရောက်ဇာသည် တည်နေရာကို ရယူနိုင်ခြင်းမရှိပါ။");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        setUploadSuccess(false);
      },
      (error) => {
        console.error("Geolocation error:", error);
        alert("တည်နေရာရယူရန် ငြင်းပယ်ထားသည်။ ကိုယ်တိုင်ဖြည့်သွင်းပေးပါ။");
      }
    );
  };

  // Sanitizer to allow only decimal coordinates (numbers, one decimal point, and one leading minus)
  const cleanCoordinateInput = (val: string, isLongitude = false) => {
    let cleaned = val.replace(/[^0-9.-]/g, "");
    if (cleaned.startsWith("-")) {
      cleaned = "-" + cleaned.slice(1).replace(/-/g, "");
    } else {
      cleaned = cleaned.replace(/-/g, "");
    }
    const parts = cleaned.split(".");
    if (parts.length > 2) {
      cleaned = parts[0] + "." + parts.slice(1).join("");
    }
    if (isLongitude) {
      if (cleaned.startsWith("0") && cleaned.length > 1 && cleaned[1] !== ".") {
        cleaned = cleaned.replace(/^0+/, "");
      } else if (cleaned.startsWith("-0") && cleaned.length > 2 && cleaned[2] !== ".") {
        cleaned = "-" + cleaned.slice(2).replace(/^0+/, "");
      }
      // If we stripped all zeros before a number (e.g. "00"), make sure it doesn't become empty if it was just zeros
      if (cleaned === "" && val.includes("0")) cleaned = "0";
      if (cleaned === "-" && val.includes("-0")) cleaned = "-0";
    }
    return cleaned;
  };

  // Converts various DMS, DDM, and raw coordinate string formats to standard DD (Decimal Degrees)
  const convertToDecimalDegrees = (val: string): string => {
    const trimmed = val.trim();
    if (!trimmed) return "";

    const isNegative = trimmed.startsWith("-");
    // Clean all characters except numbers, dots, and minus sign, but keep spaces/symbols as delimiters
    // We can use a regex to match integers and decimals.
    const matches = trimmed.match(/\d+(\.\d+)?/g);
    if (!matches || matches.length === 0) return trimmed;

    if (matches.length === 3) {
      const deg = parseFloat(matches[0]);
      const min = parseFloat(matches[1]);
      const sec = parseFloat(matches[2]);
      const dd = deg + (min / 60) + (sec / 3600);
      return (isNegative ? -dd : dd).toFixed(6);
    }

    if (matches.length === 2) {
      const deg = parseFloat(matches[0]);
      const min = parseFloat(matches[1]);
      const dd = deg + (min / 60);
      return (isNegative ? -dd : dd).toFixed(6);
    }

    if (matches.length === 1) {
      const numStr = matches[0];
      const dotIndex = numStr.indexOf('.');
      const integerPart = dotIndex !== -1 ? numStr.slice(0, dotIndex) : numStr;
      const decimalPart = dotIndex !== -1 ? numStr.slice(dotIndex) : "";
      const L = integerPart.length;

      if (L >= 5) {
        // DDMMSS.ssss format
        const secStr = integerPart.slice(L - 2) + decimalPart;
        const minStr = integerPart.slice(L - 4, L - 2);
        const degStr = integerPart.slice(0, L - 4);
        
        const deg = parseFloat(degStr || "0");
        const min = parseFloat(minStr || "0");
        const sec = parseFloat(secStr || "0");
        
        const dd = deg + (min / 60) + (sec / 3600);
        return (isNegative ? -dd : dd).toFixed(6);
      } else if (L === 3 || L === 4) {
        // DDMM.mmmm format
        const minStr = integerPart.slice(L - 2) + decimalPart;
        const degStr = integerPart.slice(0, L - 2);
        
        const deg = parseFloat(degStr || "0");
        const min = parseFloat(minStr || "0");
        
        const dd = deg + (min / 60);
        return (isNegative ? -dd : dd).toFixed(6);
      } else {
        // Already DD format
        const dd = parseFloat(numStr);
        return (isNegative ? -dd : dd).toFixed(6);
      }
    }

    return trimmed;
  };

  // Synchronize decimal degrees (DD) value when latitude or longitude changes
  useEffect(() => {
    if (document.activeElement?.id === "decimalDegrees") {
      return;
    }
    const computedLat = convertToDecimalDegrees(latitude);
    const computedLng = convertToDecimalDegrees(longitude);
    if (computedLat && computedLng) {
      setDdValue(`${computedLat}, ${computedLng}`);
    } else if (!computedLat && !computedLng) {
      setDdValue("");
    } else {
      setDdValue(`${computedLat || ""}${computedLat && computedLng ? ", " : ""}${computedLng || ""}`);
    }
  }, [latitude, longitude]);

  // Handle direct manual copy of the Decimal Degrees (DD) format
  const handleCopyDD = () => {
    if (!ddValue.trim()) return;
    navigator.clipboard.writeText(ddValue.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Handle direct manual editing or pasting into the Decimal Degrees (DD) field
  const handleDdChange = (val: string) => {
    setDdValue(val);
    setUploadSuccess(false);

    // Clean split logic if user pasted or types comma-separated coordinates
    if (!val.trim()) {
      setLatitude("");
      setLongitude("");
      return;
    }

    const parts = val.split(",");
    if (parts.length >= 2) {
      const latPart = cleanCoordinateInput(parts[0].trim());
      const lngPart = cleanCoordinateInput(parts[1].trim(), true);

      setLatitude(latPart);
      setLongitude(lngPart);
    } else {
      // If typing and no comma yet, update latitude only
      const latPart = cleanCoordinateInput(val.trim());
      setLatitude(latPart);
    }
  };

  // Format DD field on blur to clean any unformatted coordinate styles
  const handleDdBlur = () => {
    if (!ddValue.trim()) return;
    const parts = ddValue.split(",");
    if (parts.length >= 2) {
      const originalLat = parts[0].trim();
      const originalLng = parts[1].trim();
      setLatitude(originalLat);
      setLongitude(originalLng);
      
      const latPart = convertToDecimalDegrees(originalLat);
      const lngPart = convertToDecimalDegrees(originalLng);
      setDdValue(`${latPart}, ${lngPart}`);
    } else {
      const originalLat = ddValue.trim();
      setLatitude(originalLat);
      const latPart = convertToDecimalDegrees(originalLat);
      setDdValue(latPart);
    }
  };

  // Submit/Upload data handler
  const handleUpload = async () => {
    if (!selectedRecord) {
      alert("အချက်အလက် တစ်ခုအား အရင်ဦးစွာ ရွေးချယ်ပေးပါ။");
      return;
    }
    
    // Ensure we convert coordinates to proper Decimal Degrees before validating or sending
    const finalLat = convertToDecimalDegrees(latitude);
    const finalLng = convertToDecimalDegrees(longitude);
    const finalDd = `${finalLat}, ${finalLng}`;

    // Update state to show the formatted value in the DD UI (do NOT overwrite Latitude and Longitude boxes)
    setDdValue(finalDd);

    if (!finalLat.trim() || !finalLng.trim()) {
      alert("Latitude နှင့် Longitude ကို ဖြည့်စွက်ပေးပါ။");
      return;
    }

    setIsUploading(true);
    setError(null);
    try {
      let uploadSuccess = false;

      // 1. First, try the local API proxy (works perfectly in local/production Node server context)
      try {
        console.log("Trying local server upload API proxy...");
        const response = await fetch("/api/upload-external", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            searchResult: selectedRecord,
            latitude: finalLat,
            longitude: finalLng,
            ddValue: finalDd, // Send converted DD coordinates
          }),
        });

        if (response.ok) {
          uploadSuccess = true;
          console.log("Local server upload API proxy succeeded!");
        } else {
          console.warn("Local server upload API proxy failed or returned not-ok status:", response.status);
        }
      } catch (localErr) {
        console.warn("Local server upload API proxy threw error, falling back to direct client-side Google Apps Script upload:", localErr);
      }

      // 2. If local server proxy fails or is unavailable (e.g. on static hosting like GitHub Pages),
      // we perform a direct client-side call to Google Apps Script Web App.
      if (!uploadSuccess) {
        console.log("Initiating direct client-side Google Apps Script upload (fallback for GitHub hosting)...");
        const targetUrl = "https://script.google.com/macros/s/AKfycbymBas6qUXKdtbcwYqBmniLjCHDSWuJtRmZf9KpX6S6RpfgfxCnI5rQHjQUEomP6k95Ag/exec";

        // Build URL parameters for Apps Script
        const params = new URLSearchParams();
        const gpsValue = finalDd.trim() || `${finalLat || ""}, ${finalLng || ""}`;
        params.set("latitude", String(finalLat || ""));
        params.set("longitude", String(finalLng || ""));
        params.set("Gps", gpsValue);

        // Dynamically copy all original properties from the selected record to params
        if (selectedRecord) {
          for (const [k, v] of Object.entries(selectedRecord)) {
            if (v !== undefined && v !== null) {
              params.set(k, String(v));
            }
          }
        }
        
        const comCodeVal = selectedRecord ? (selectedRecord["com-code"] || selectedRecord["com_code"] || selectedRecord["ID"] || selectedRecord["id"] || "") : "";
        const ledgerVal = selectedRecord ? (selectedRecord["Ledger-code"] || selectedRecord["ledger_code"] || selectedRecord["ledger"] || selectedRecord["Ledger"] || "") : "";
        const meterVal = selectedRecord ? (selectedRecord["Meter-No"] || selectedRecord["meter_no"] || selectedRecord["meter"] || selectedRecord["Meter"] || "") : "";
        const nameVal = selectedRecord ? (selectedRecord["Name"] || selectedRecord["name"] || selectedRecord["အမည်"] || "") : "";
        const addressVal = selectedRecord ? (selectedRecord["Address"] || selectedRecord["address"] || selectedRecord["နေရပ်လိပ်စာ"] || selectedRecord["မြို့နယ်"] || "") : "";

        params.set("com-code", String(comCodeVal));
        params.set("ledger", String(ledgerVal));
        params.set("meter", String(meterVal));
        params.set("name", String(nameVal));
        params.set("address", String(addressVal));
        params.set("fullData", JSON.stringify(selectedRecord));

        const directUrl = `${targetUrl}?${params.toString()}`;

        // We use mode: "no-cors" so that the browser successfully completes the request redirect flow
        // to Google's content servers without throwing CORS/Same-Origin exception blockages.
        await fetch(directUrl, {
          method: "POST",
          mode: "no-cors"
        });

        uploadSuccess = true;
        console.log("Direct client-side Google Apps Script upload succeeded under no-cors mode.");
      }

      if (!uploadSuccess) {
        throw new Error("ပေးပို့မှု မအောင်မြင်ပါ။ ပြန်လည်ကြိုးစားကြည့်ပါ။");
      }

      setUploadSuccess(true);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "အချက်အလက် ပို့ဆောင်စဉ် အမှားအယွင်းဖြစ်ပွားခဲ့သည်။");
    } finally {
      setIsUploading(false);
    }
  };

  const getRecordLabel = (record: ExternalRecord) => {
    const commonKeys = ["အမည်", "Name", "name", "title", "label", "rawText", "value", "id"];
    for (const key of commonKeys) {
      if (record[key]) return String(record[key]);
    }
    const values = Object.values(record);
    return values.length > 0 ? String(values[0]) : "Unnamed Record";
  };

  const handleSquircleClick = () => {
    setIsExpanded(true);
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 250);
  };

  return (
    <div className="min-h-screen bg-[#f4f5f8] text-zinc-900 font-sans antialiased flex flex-col justify-between">
      
      {/* Blank elegant top margin instead of header titles */}
      <div className="h-16" />

      {/* Main Container */}
      <main className="flex-1 max-w-xl w-full mx-auto px-5 py-6 flex flex-col justify-center">
        
        <AnimatePresence mode="wait">
          {!isExpanded ? (
            // CENTRAL MINIMALIST SQUIRCLE ICON VIEW (ONLY VISIBLE UNTIL CLICKED)
            <div className="flex-1 flex items-center justify-center py-24">
              <motion.button
                key="squircle-btn"
                onClick={handleSquircleClick}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: "spring", stiffness: 350, damping: 26 }}
                className="w-36 h-36 bg-black text-white rounded-[38px] flex items-center justify-center shadow-2xl cursor-pointer"
                style={{ touchAction: "manipulation" }}
              >
                <Search className="w-12 h-12" strokeWidth={2.5} />
              </motion.button>
            </div>
          ) : (
            // EXPANDED INTERACTIVE PORTAL
            <motion.div
              key="expanded-portal"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className="w-full flex flex-col gap-5"
            >
              
              {uploadSuccess ? (
                // SUCCESS SCREEN (matches the 4th phone image from the 3rd image)
                <motion.div
                  key="success-screen"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 200, damping: 25 }}
                  className="bg-white border border-zinc-200/80 rounded-3xl p-8 flex flex-col items-center justify-center text-center shadow-lg py-12"
                >
                  {/* Elegant Shield Check Icon */}
                  <div className="w-20 h-20 bg-black text-white rounded-full flex items-center justify-center mb-6 shadow-md">
                    <ShieldCheck className="w-10 h-10 text-white" strokeWidth={1.5} />
                  </div>

                  {/* Title */}
                  <h2 className="text-2xl font-bold font-sans text-zinc-900 tracking-tight mb-2">
                    Success!
                  </h2>

                  {/* Message */}
                  <p className="text-sm text-zinc-500 font-sans leading-relaxed max-w-xs mb-8">
                    ရွေးချယ်ထားသော အချက်အလက်နှင့် တည်နေရာကို အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ။
                  </p>

                  {/* Back/New Search Button (Replaces "Start using") */}
                  <button
                    type="button"
                    onClick={() => {
                      setInputValue("");
                      setSearchResults([]);
                      setSelectedRecord(null);
                      setLatitude("");
                      setLongitude("");
                      setDdValue("");
                      setUploadSuccess(false);
                      setHasSearched(false);
                    }}
                    className="w-full max-w-xs h-14 bg-black hover:bg-zinc-900 text-white font-sans font-bold rounded-full flex items-center justify-center transition-all shadow-md active:scale-[0.98] cursor-pointer"
                  >
                    နောက်သို့ ပြန်သွားရန်
                  </button>
                </motion.div>
              ) : (
                <div className="w-full flex flex-col gap-1.5">
                  {/* Elegant Morphic Search Bar with Circular Search Button on Right */}
                  <form 
                    onSubmit={handleSearchSubmit}
                    className={`w-full bg-white border border-zinc-200/80 rounded-full shadow-md p-1.5 pl-5 pr-1.5 flex items-center gap-2 transition-all ${isDbLoading ? "opacity-60 cursor-not-allowed bg-zinc-50" : ""}`}
                  >
                    <input
                      ref={searchInputRef}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      id="instant-search-input"
                      placeholder={isDbLoading ? "ခေတ္တစောင့်ဆိုင်းပါ..." : "ကွန်ကုဒ်တစ်မျိုးထဲသာ ရိုက်ပါ"}
                      value={inputValue}
                      onChange={handleInputChange}
                      disabled={isDbLoading}
                      className="flex-1 bg-transparent text-zinc-800 placeholder-zinc-400 font-sans outline-none text-base disabled:text-zinc-400 disabled:cursor-not-allowed"
                    />
                    
                    {inputValue && !isDbLoading && (
                      <button
                        type="button"
                        onClick={() => {
                          setInputValue("");
                          setSearchResults([]);
                          setSelectedRecord(null);
                          setUploadSuccess(false);
                          setHasSearched(false);
                          // Clear coordinates when the search is cleared
                          setLatitude("");
                          setLongitude("");
                          setDdValue("");
                        }}
                        className="p-1 rounded-full hover:bg-zinc-100 transition-colors"
                      >
                        <X className="w-4 h-4 text-zinc-400 hover:text-zinc-600" />
                      </button>
                    )}

                    <button
                      type="submit"
                      disabled={isDbLoading}
                      className="w-11 h-11 bg-black text-white rounded-full flex items-center justify-center cursor-pointer transition-all hover:bg-zinc-800 shrink-0 shadow-md disabled:bg-zinc-200 disabled:text-zinc-400 disabled:cursor-not-allowed"
                      title="Search"
                    >
                      <Search className="w-5 h-5 text-white" strokeWidth={2.5} />
                    </button>
                  </form>

                  {/* Clean Minimalist Database Status Indicator (Below Search Bar, No Box) */}
                  {/* Only visible when not searching / typing */}
                  {(!inputValue.trim() && !hasSearched) && (
                    <div className="w-full flex flex-col items-center justify-center py-2">
                      {isDbLoading ? (
                        <div className="flex items-center gap-2 text-zinc-500 font-sans text-xs">
                          <span>Database ရယူနေသည်</span>
                          <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-black rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                            <span className="w-1.5 h-1.5 bg-black rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                            <span className="w-1.5 h-1.5 bg-black rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                          </span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center gap-1">
                          <div className="w-5 h-5 rounded-full bg-black flex items-center justify-center shadow-xs">
                            <Check className="w-3 h-3 text-white" strokeWidth={3.5} />
                          </div>
                          <span className="text-xs font-bold text-zinc-800 font-sans">
                            ရှာဖွေနိုင်ပါပြီ
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Wrapper for search results/box so that the spacing is extremely close (0.5 spacing or 1 spacing) to the search bar */}
                  <div className="w-full flex flex-col gap-4 mt-0.5">
                    {/* Search Loading or Empty Results Feedback (No small box shown) */}
                    {hasSearched && (
                      <div>
                        {isSearching ? (
                          <div className="bg-white border border-zinc-200/80 rounded-2xl p-6 text-center flex flex-col items-center justify-center shadow-xs">
                            <RefreshCw className="w-5 h-5 animate-spin text-zinc-400" />
                            <p className="text-xs text-zinc-400 font-sans mt-2">ရှာဖွေနေပါသည်...</p>
                          </div>
                        ) : searchResults.length === 0 ? (
                          <div className="bg-white border border-zinc-200/80 rounded-2xl p-6 text-center text-zinc-400 text-sm font-sans shadow-xs">
                            ရှာဖွေမှုနှင့် ကိုက်ညီသော အချက်အလက် မတွေ့ပါ။
                          </div>
                        ) : null}
                      </div>
                    )}

                    {/* Data Record Details and Location inputs (Only shown when a record is selected) */}
                    <AnimatePresence mode="wait">
                      {selectedRecord && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="flex flex-col gap-5 w-full"
                        >
                          
                          {/* Selected Item Properties Display Card (Keys are now bold black!) */}
                          <div className="bg-white border border-zinc-200/80 rounded-2xl shadow-xs p-5">
                            <div className="space-y-2.5">
                              {Object.entries(selectedRecord)
                                .filter(([key]) => {
                                  const kLower = key.toLowerCase();
                                  return kLower !== "id" && kLower !== "column_1";
                                })
                                .map(([key, value]) => (
                                  <div key={key} className="grid grid-cols-3 gap-2 py-1.5 border-b border-zinc-100 last:border-0 text-xs sm:text-sm">
                                    <span className="font-sans font-bold text-black uppercase tracking-wide">{key}</span>
                                    <span className="col-span-2 text-zinc-800 font-medium break-all">{String(value)}</span>
                                  </div>
                                ))}
                            </div>
                          </div>

                          {/* Coordinates Selection Box */}
                          <div className="bg-white border border-zinc-200/80 rounded-2xl shadow-xs p-5 space-y-4">
                            <div className="flex items-center gap-1 border-b border-zinc-100 pb-2">
                              <MapPin className="w-4 h-4 text-black" />
                              <span className="text-xs font-display font-bold uppercase tracking-wider text-black">
                                LOCATION COORDINATES
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <label htmlFor="latitude" className="block text-[10px] font-bold text-black mb-1">
                                  Latitude (လတ္တီတွဒ်)
                                </label>
                                <input
                                  type="text"
                                  id="latitude"
                                  inputMode="decimal"
                                  pattern="[0-9.-]*"
                                  placeholder="ဥပမာ: 16.8409"
                                  value={latitude}
                                  onChange={(e) => {
                                    const cleaned = cleanCoordinateInput(e.target.value);
                                    setLatitude(cleaned);
                                    setUploadSuccess(false);
                                  }}
                                  className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:border-zinc-500 transition-colors font-mono text-sm"
                                />
                              </div>

                              <div>
                                <label htmlFor="longitude" className="block text-[10px] font-bold text-black mb-1">
                                  Longitude (လောင်ဂျီတွဒ်)
                                </label>
                                <input
                                  type="text"
                                  id="longitude"
                                  inputMode="decimal"
                                  pattern="[0-9.-]*"
                                  placeholder="ဥပမာ: 96.1735"
                                  value={longitude}
                                  onChange={(e) => {
                                    const cleaned = cleanCoordinateInput(e.target.value, true);
                                    setLongitude(cleaned);
                                    setUploadSuccess(false);
                                  }}
                                  className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:border-zinc-500 transition-colors font-mono text-sm"
                                />
                              </div>
                            </div>

                            {/* Decimal Degrees (DD) Converter Box */}
                            <div className="pt-3 border-t border-zinc-100">
                              <label htmlFor="decimalDegrees" className="block text-[10px] font-bold text-black mb-1">
                                Decimal Degrees (DD)
                              </label>
                              <div className="relative flex items-center">
                                <input
                                  type="text"
                                  id="decimalDegrees"
                                  placeholder="ဥပမာ: 16.8409, 96.1735"
                                  value={ddValue}
                                  onChange={(e) => handleDdChange(e.target.value)}
                                  onBlur={handleDdBlur}
                                  className="w-full p-3 pr-12 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:border-zinc-500 transition-colors font-mono text-sm"
                                />
                                <button
                                  type="button"
                                  onClick={handleCopyDD}
                                  className="absolute right-2 p-2 text-zinc-500 hover:text-black hover:bg-zinc-100 rounded-lg transition-colors cursor-pointer"
                                  title="Copy Decimal Degrees"
                                >
                                  {copied ? (
                                    <Check className="w-4 h-4 text-emerald-600" />
                                  ) : (
                                    <Copy className="w-4 h-4" />
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Elongated Black Pill Dispatch Button */}
                          <div className="w-full flex flex-col items-center gap-3 pt-3">
                            <button
                              type="button"
                              onClick={handleUpload}
                              disabled={isUploading}
                              className="relative flex items-center justify-between w-full max-w-sm h-14 bg-[#18191d] text-white rounded-full pl-6 pr-2.5 transition-all shadow-md select-none group focus:outline-none cursor-pointer active:scale-[0.98] hover:bg-black"
                            >
                              {/* Status/Progress Label */}
                              <span className="font-sans font-bold tracking-wide text-sm text-zinc-100 transition-all">
                                {isUploading ? (
                                  <span className="flex items-center gap-2">
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    Uploading...
                                  </span>
                                ) : (
                                  "Upload"
                                )}
                              </span>

                              {/* Internal circular icon badge */}
                              <div className="w-10 h-10 rounded-full flex items-center justify-center transition-all bg-zinc-800 group-hover:bg-zinc-700">
                                <ArrowUp className="w-4 h-4 text-white" strokeWidth={2.5} />
                              </div>
                            </button>

                            {/* feedback info */}
                            <AnimatePresence>
                              {error && (
                                <motion.div
                                  initial={{ opacity: 0, y: 5 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  className="text-red-500 text-xs font-sans flex items-center gap-1.5 max-w-sm text-center"
                                >
                                  <AlertCircle className="w-4 h-4 shrink-0" />
                                  <span>{error}</span>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>

                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}

            </motion.div>
          )}
        </AnimatePresence>

      </main>

      {/* Simplified, Humble Minimalist Dot Footer */}
      <footer className="w-full py-10 flex flex-col items-center justify-center">
        <div className="w-2.5 h-2.5 rounded-full bg-zinc-300 animate-pulse" />
      </footer>
    </div>
  );
}
