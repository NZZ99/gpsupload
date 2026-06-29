import fs from "fs";
import path from "path";

const TARGET_URL = "https://script.google.com/macros/s/AKfycbzb6iADzGScWMZoRLnu-NKmmxBDJryZXxw3gTfkvE0NXmp6GMteOwUO3qMOLeS0CJGq/exec";
const OUT_FILE = path.join(process.cwd(), "public", "database_snapshot.json");

async function fetchSnapshot() {
  console.log("Generating high-performance database snapshot for static hosting / CDN...");
  try {
    const response = await fetch(TARGET_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    if (text.includes("<!DOCTYPE html>") || text.includes("<html") || text.includes("The script completed")) {
      throw new Error("Returned HTML or script warning instead of data");
    }
    
    let parsedData: any[] = [];
    try {
      const jsonData = JSON.parse(text);
      if (Array.isArray(jsonData)) {
        if (jsonData.length > 0 && Array.isArray(jsonData[0])) {
          const headers = jsonData[0].map(h => String(h || "").trim());
          parsedData = jsonData.slice(1).map((row, rIdx) => {
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
          parsedData = jsonData;
        }
      } else if (jsonData && typeof jsonData === "object") {
        const list = jsonData.data || jsonData.rows || jsonData.records || jsonData.items;
        if (Array.isArray(list)) {
          if (list.length > 0 && Array.isArray(list[0])) {
            const headers = list[0].map(h => String(h || "").trim());
            parsedData = list.slice(1).map((row: any, rIdx: number) => {
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
            parsedData = list;
          }
        }
      }
    } catch (e) {
      console.warn("JSON parse failed during snapshot download. Skipping compilation.");
      return;
    }

    if (parsedData.length > 0) {
      fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
      fs.writeFileSync(OUT_FILE, JSON.stringify(parsedData), "utf8");
      console.log(`Successfully compiled ${parsedData.length} records into public database snapshot!`);
    }
  } catch (err: any) {
    console.warn("Warning: Could not fetch database snapshot during build:", err.message);
  }
}

fetchSnapshot();
