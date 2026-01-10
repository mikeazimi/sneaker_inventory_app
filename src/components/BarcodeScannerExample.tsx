"use client";

import { useState, useCallback } from "react";
import BarcodeScanner from "./BarcodeScanner";

/**
 * Example usage of the BarcodeScanner component
 */
export default function BarcodeScannerExample() {
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannedCodes, setScannedCodes] = useState<string[]>([]);

  const handleDetected = useCallback((code: string) => {
    console.log("Barcode detected:", code);
    setScannedCodes((prev) => [code, ...prev.slice(0, 9)]); // Keep last 10
    
    // Optionally close scanner after successful scan
    // setIsScannerOpen(false);
  }, []);

  return (
    <div className="example-container">
      <h1 className="example-title">Barcode Scanner Demo</h1>
      
      <button
        onClick={() => setIsScannerOpen(true)}
        className="scan-button"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="7" y1="8" x2="7" y2="16" />
          <line x1="10" y1="8" x2="10" y2="16" />
          <line x1="13" y1="8" x2="13" y2="16" />
          <line x1="16" y1="8" x2="16" y2="16" />
        </svg>
        Open Scanner
      </button>

      {scannedCodes.length > 0 && (
        <div className="results-section">
          <h2 className="results-title">Scanned Codes</h2>
          <ul className="results-list">
            {scannedCodes.map((code, index) => (
              <li key={`${code}-${index}`} className="result-item">
                <code>{code}</code>
                <span className="result-time">
                  {index === 0 ? "Just now" : `${index + 1} scans ago`}
                </span>
              </li>
            ))}
          </ul>
          <button
            onClick={() => setScannedCodes([])}
            className="clear-button"
          >
            Clear History
          </button>
        </div>
      )}

      <BarcodeScanner
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onDetected={handleDetected}
        title="Scan Product Barcode"
      />

      <style jsx>{`
        .example-container {
          min-height: 100vh;
          padding: 48px 24px;
          background: linear-gradient(180deg, #09090b 0%, #0f0f10 100%);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .example-title {
          font-size: 28px;
          font-weight: 700;
          color: #fafafa;
          text-align: center;
          margin: 0 0 32px 0;
          letter-spacing: -0.02em;
        }

        .scan-button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          max-width: 320px;
          margin: 0 auto;
          padding: 16px 24px;
          font-size: 16px;
          font-weight: 600;
          color: #fafafa;
          background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
          border: none;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .scan-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 32px rgba(34, 197, 94, 0.3);
        }

        .scan-button:active {
          transform: translateY(0);
        }

        .results-section {
          max-width: 400px;
          margin: 48px auto 0;
          padding: 24px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
        }

        .results-title {
          font-size: 16px;
          font-weight: 600;
          color: #a1a1aa;
          margin: 0 0 16px 0;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .results-list {
          list-style: none;
          padding: 0;
          margin: 0 0 20px 0;
        }

        .result-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }

        .result-item:last-child {
          border-bottom: none;
        }

        .result-item code {
          font-family: "SF Mono", "Fira Code", monospace;
          font-size: 14px;
          color: #22c55e;
        }

        .result-time {
          font-size: 12px;
          color: #52525b;
        }

        .clear-button {
          width: 100%;
          padding: 10px;
          font-size: 13px;
          font-weight: 500;
          color: #71717a;
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .clear-button:hover {
          color: #a1a1aa;
          border-color: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </div>
  );
}

