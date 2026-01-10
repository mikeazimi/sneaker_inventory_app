"use client";

import { useRef, useCallback } from "react";
import Barcode from "react-barcode";

// =============================================================================
// TYPES
// =============================================================================

interface LabelGeneratorProps {
  sku: string;
  name: string;
  showPreview?: boolean;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Truncate text to specified length with ellipsis
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trim() + "…";
}

// =============================================================================
// COMPONENT
// =============================================================================

export default function LabelGenerator({
  sku,
  name,
  showPreview = true,
}: LabelGeneratorProps) {
  const labelRef = useRef<HTMLDivElement>(null);

  /**
   * Trigger browser print dialog
   */
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const truncatedName = truncateText(name, 30);

  return (
    <>
      {/* Print-only styles */}
      <style jsx global>{`
        @media print {
          /* Hide everything by default */
          body > * {
            display: none !important;
          }

          /* Show only the label container */
          body > #__next,
          body > div:has(.label-print-container) {
            display: block !important;
          }

          #__next > *,
          body > div > * {
            display: none !important;
          }

          .label-print-container {
            display: flex !important;
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            align-items: center !important;
            justify-content: center !important;
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          .label-content {
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            width: 4in !important;
            height: 6in !important;
            padding: 0.5in !important;
            background: white !important;
            border: none !important;
            box-shadow: none !important;
          }

          .label-barcode-wrapper {
            display: flex !important;
            justify-content: center !important;
          }

          .label-barcode-wrapper svg {
            width: auto !important;
            height: auto !important;
            max-width: 3in !important;
          }

          .label-product-name {
            font-family: Arial, Helvetica, sans-serif !important;
            font-size: 14pt !important;
            font-weight: 600 !important;
            color: #000000 !important;
            text-align: center !important;
            margin-top: 0.25in !important;
            line-height: 1.3 !important;
            max-width: 3in !important;
            word-wrap: break-word !important;
          }

          .label-sku-display {
            font-family: "Courier New", Courier, monospace !important;
            font-size: 11pt !important;
            font-weight: 400 !important;
            color: #000000 !important;
            text-align: center !important;
            margin-top: 0.1in !important;
            letter-spacing: 0.05em !important;
          }

          /* Hide UI elements */
          .label-generator-ui,
          .label-actions,
          .label-preview-title {
            display: none !important;
          }
        }

        /* Screen styles for print container */
        @media screen {
          .label-print-container {
            display: none;
          }
        }
      `}</style>

      {/* Screen Preview UI */}
      {showPreview && (
        <div className="label-generator-ui">
          <div className="label-preview-card">
            <h3 className="label-preview-title">Label Preview</h3>

            {/* Preview Content */}
            <div className="label-preview-content">
              <div className="label-preview-barcode">
                <Barcode
                  value={sku}
                  format="CODE128"
                  width={2}
                  height={80}
                  fontSize={14}
                  margin={10}
                  background="#ffffff"
                  lineColor="#000000"
                  displayValue={true}
                  font="monospace"
                  fontOptions="600"
                  textAlign="center"
                  textPosition="bottom"
                  textMargin={6}
                />
              </div>
              <p className="label-preview-name">{truncatedName}</p>
            </div>

            {/* Actions */}
            <div className="label-actions">
              <button onClick={handlePrint} className="print-button">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 6 2 18 2 18 9" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
                Print Label
              </button>
              <p className="print-hint">4&quot; × 6&quot; thermal label format</p>
            </div>
          </div>

          <style jsx>{`
            .label-generator-ui {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                sans-serif;
            }

            .label-preview-card {
              background: linear-gradient(
                145deg,
                rgba(255, 255, 255, 0.05) 0%,
                rgba(255, 255, 255, 0.02) 100%
              );
              border: 1px solid rgba(255, 255, 255, 0.1);
              border-radius: 16px;
              padding: 24px;
              max-width: 400px;
            }

            .label-preview-title {
              font-size: 13px;
              font-weight: 500;
              color: #71717a;
              text-transform: uppercase;
              letter-spacing: 0.08em;
              margin: 0 0 20px 0;
            }

            .label-preview-content {
              background: #ffffff;
              border-radius: 12px;
              padding: 32px 24px;
              display: flex;
              flex-direction: column;
              align-items: center;
              box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
            }

            .label-preview-barcode {
              display: flex;
              justify-content: center;
            }

            .label-preview-barcode :global(svg) {
              display: block;
            }

            .label-preview-name {
              font-family: Arial, Helvetica, sans-serif;
              font-size: 14px;
              font-weight: 600;
              color: #18181b;
              text-align: center;
              margin: 16px 0 0 0;
              line-height: 1.4;
              max-width: 280px;
              word-wrap: break-word;
            }

            .label-actions {
              margin-top: 20px;
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 10px;
            }

            .print-button {
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 10px;
              width: 100%;
              padding: 14px 24px;
              font-size: 15px;
              font-weight: 600;
              color: #18181b;
              background: linear-gradient(180deg, #fafafa 0%, #e4e4e7 100%);
              border: 1px solid rgba(0, 0, 0, 0.1);
              border-radius: 10px;
              cursor: pointer;
              transition: all 0.2s ease;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
            }

            .print-button:hover {
              background: linear-gradient(180deg, #ffffff 0%, #f4f4f5 100%);
              transform: translateY(-1px);
              box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
            }

            .print-button:active {
              transform: translateY(0);
              box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
            }

            .print-hint {
              font-size: 12px;
              color: #52525b;
              margin: 0;
            }
          `}</style>
        </div>
      )}

      {/* Print Container (hidden on screen, visible during print) */}
      <div className="label-print-container" ref={labelRef}>
        <div className="label-content">
          <div className="label-barcode-wrapper">
            <Barcode
              value={sku}
              format="CODE128"
              width={2.5}
              height={100}
              fontSize={16}
              margin={0}
              background="#ffffff"
              lineColor="#000000"
              displayValue={true}
              font="monospace"
              fontOptions="600"
              textAlign="center"
              textPosition="bottom"
              textMargin={8}
            />
          </div>
          <p className="label-product-name">{truncatedName}</p>
          <p className="label-sku-display">{sku}</p>
        </div>
      </div>
    </>
  );
}

// =============================================================================
// COMPACT VARIANT (for inline/list usage)
// =============================================================================

interface LabelGeneratorCompactProps {
  sku: string;
  name: string;
  onPrint?: () => void;
}

export function LabelGeneratorCompact({
  sku,
  name,
  onPrint,
}: LabelGeneratorCompactProps) {
  const handlePrint = useCallback(() => {
    onPrint?.();
    window.print();
  }, [onPrint]);

  return (
    <div className="label-compact">
      <div className="label-compact-barcode">
        <Barcode
          value={sku}
          format="CODE128"
          width={1.5}
          height={50}
          fontSize={10}
          margin={4}
          background="transparent"
          lineColor="#000000"
          displayValue={true}
          font="monospace"
          textAlign="center"
          textPosition="bottom"
          textMargin={4}
        />
      </div>
      <div className="label-compact-info">
        <p className="label-compact-name">{truncateText(name, 30)}</p>
        <p className="label-compact-sku">{sku}</p>
      </div>
      <button
        onClick={handlePrint}
        className="label-compact-print"
        aria-label="Print label"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
      </button>

      <style jsx>{`
        .label-compact {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 12px 16px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
        }

        .label-compact-barcode {
          flex-shrink: 0;
          background: #ffffff;
          border-radius: 6px;
          padding: 8px;
        }

        .label-compact-barcode :global(svg) {
          display: block;
        }

        .label-compact-info {
          flex: 1;
          min-width: 0;
        }

        .label-compact-name {
          font-size: 14px;
          font-weight: 500;
          color: #fafafa;
          margin: 0 0 4px 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .label-compact-sku {
          font-family: "SF Mono", "Fira Code", monospace;
          font-size: 12px;
          color: #71717a;
          margin: 0;
        }

        .label-compact-print {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: #a1a1aa;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .label-compact-print:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #fafafa;
          border-color: rgba(255, 255, 255, 0.15);
        }
      `}</style>
    </div>
  );
}

