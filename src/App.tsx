import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Search, MapPin, ArrowUp, Check, RefreshCw, AlertCircle, Navigation, X, ShieldCheck, Delete
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

  const searchInputRef = useRef<HTMLInputElement>(null);
  const latestQueryRef = useRef("");

  const [localRecords, setLocalRecords] = useState<ExternalRecord[]>([]);

  // Load from LocalStorage instantly on mount and update with background CSV fetch
  useEffect(() => {
    // 1. Try to load instantly from LocalStorage cache (takes ~10-20ms)
    const cachedCsv = localStorage.getItem("cached_csv_records");
    if (cachedCsv) {
      try {
        const parsed = Papa.parse<ExternalRecord>(cachedCsv, { header: true, skipEmptyLines: true });
        if (parsed.data && parsed.data.length > 0) {
          setLocalRecords(parsed.data);
          console.log(`Loaded ${parsed.data.length} records instantly from LocalStorage cache.`);
        }
      } catch (err) {
        console.error("LocalStorage parsing failed:", err);
      }
    }

    // 2. Freshly fetch the compact CSV from server to silent-refresh cache
    const fetchFreshRecords = async () => {
      try {
        const response = await fetch("/api/get-all-records-csv");
        if (response.ok) {
          const csvText = await response.text();
          if (csvText && csvText.trim()) {
            const parsed = Papa.parse<ExternalRecord>(csvText, { header: true, skipEmptyLines: true });
            if (parsed.data && parsed.data.length > 0) {
              setLocalRecords(parsed.data);
              localStorage.setItem("cached_csv_records", csvText);
              console.log(`Loaded & cached ${parsed.data.length} records freshly on client-side.`);
            }
          }
        }
      } catch (err) {
        console.error("Background fresh CSV fetch failed:", err);
      }
    };

    fetchFreshRecords();
  }, []);

  // Triggers the search query instantly in-memory
  const performSearch = (query: string) => {
    latestQueryRef.current = query;
    const cleanQuery = query.trim();

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

    // 1. If we have client-side cached records in memory, search them instantly! (< 1ms!)
    if (localRecords.length > 0) {
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
      // 2. Fallback to server search only if cache is empty (first ever load)
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
        console.error("Server fallback search failed:", err);
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

  // Submit/Upload data handler
  const handleUpload = async () => {
    if (!selectedRecord) {
      alert("အချက်အလက် တစ်ခုအား အရင်ဦးစွာ ရွေးချယ်ပေးပါ။");
      return;
    }
    if (!latitude.trim() || !longitude.trim()) {
      alert("Latitude နှင့် Longitude ကို ဖြည့်စွက်ပေးပါ။");
      return;
    }

    setIsUploading(true);
    setError(null);
    try {
      const response = await fetch("/api/upload-external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchResult: selectedRecord,
          latitude,
          longitude,
        }),
      });

      if (!response.ok) {
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
                      setUploadSuccess(false);
                      setHasSearched(false);
                    }}
                    className="w-full max-w-xs h-14 bg-black hover:bg-zinc-900 text-white font-sans font-bold rounded-full flex items-center justify-center transition-all shadow-md active:scale-[0.98] cursor-pointer"
                  >
                    နောက်သို့ ပြန်သွားရန်
                  </button>
                </motion.div>
              ) : (
                <>
                  {/* Elegant Morphic Search Bar with Circular Search Button on Right */}
                  <form 
                    onSubmit={handleSearchSubmit}
                    className="w-full bg-white border border-zinc-200/80 rounded-full shadow-md p-1.5 pl-5 pr-1.5 flex items-center gap-2"
                  >
                    <input
                      ref={searchInputRef}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      id="instant-search-input"
                      placeholder="ကွန်ကုဒ်တစ်မျိုးထဲသာ ရိုက်ပါ"
                      value={inputValue}
                      onChange={handleInputChange}
                      className="flex-1 bg-transparent text-zinc-800 placeholder-zinc-400 font-sans outline-none text-base"
                    />
                    
                    {inputValue && (
                      <button
                        type="button"
                        onClick={() => {
                          setInputValue("");
                          setSearchResults([]);
                          setSelectedRecord(null);
                          setUploadSuccess(false);
                          setHasSearched(false);
                        }}
                        className="p-1 rounded-full hover:bg-zinc-100 transition-colors"
                      >
                        <X className="w-4 h-4 text-zinc-400 hover:text-zinc-600" />
                      </button>
                    )}

                    <button
                      type="submit"
                      className="w-11 h-11 bg-black text-white rounded-full flex items-center justify-center cursor-pointer transition-all hover:bg-zinc-800 shrink-0 shadow-md"
                      title="Search"
                    >
                      <Search className="w-5 h-5 text-white" strokeWidth={2.5} />
                    </button>
                  </form>

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
                                placeholder="ဥပမာ: 16.8409"
                                value={latitude}
                                onChange={(e) => {
                                  setLatitude(e.target.value);
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
                                placeholder="ဥပမာ: 96.1735"
                                value={longitude}
                                onChange={(e) => {
                                  setLongitude(e.target.value);
                                  setUploadSuccess(false);
                                }}
                                className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:border-zinc-500 transition-colors font-mono text-sm"
                              />
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
                </>
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
