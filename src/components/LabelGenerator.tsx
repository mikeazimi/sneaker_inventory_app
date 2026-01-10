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
      {/* Screen Preview UI */}
      {showPreview && (
        <div className="font-sans">
          <div 
            className="rounded-2xl p-6 max-w-[400px]"
            style={{
              background: "linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)",
              border: "1px solid rgba(255,255,255,0.1)"
            }}
          >
            <h3 className="text-[13px] font-medium text-zinc-500 uppercase tracking-wider mb-5">
              Label Preview
            </h3>

            {/* Preview Content */}
            <div 
              className="bg-white rounded-xl py-8 px-6 flex flex-col items-center"
              style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.15)" }}
            >
              <div className="flex justify-center">
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
              <p className="font-sans text-sm font-semibold text-zinc-900 text-center mt-4 leading-relaxed max-w-[280px] break-words">
                {truncatedName}
              </p>
            </div>

            {/* Actions */}
            <div className="mt-5 flex flex-col items-center gap-2.5">
              <button 
                onClick={handlePrint} 
                className="flex items-center justify-center gap-2.5 w-full py-3.5 px-6 text-[15px] font-semibold text-zinc-900 rounded-[10px] cursor-pointer transition-all duration-200 hover:-translate-y-px active:translate-y-0"
                style={{
                  background: "linear-gradient(180deg, #fafafa 0%, #e4e4e7 100%)",
                  border: "1px solid rgba(0,0,0,0.1)",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)"
                }}
              >
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
              <p className="text-xs text-zinc-600">4&quot; × 6&quot; thermal label format</p>
            </div>
          </div>
        </div>
      )}

      {/* Print Container (hidden on screen, visible during print) */}
      <div className="label-print-container hidden print:flex" ref={labelRef}>
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
    <div 
      className="flex items-center gap-4 py-3 px-4 rounded-xl"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)"
      }}
    >
      <div className="flex-shrink-0 bg-white rounded-md p-2">
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
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-50 mb-1 truncate">
          {truncateText(name, 30)}
        </p>
        <p className="font-mono text-xs text-zinc-500">{sku}</p>
      </div>
      <button
        onClick={handlePrint}
        className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg text-zinc-400 cursor-pointer transition-all duration-200 hover:text-zinc-50"
        style={{
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)"
        }}
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
    </div>
  );
}
