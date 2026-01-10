"use client";

import { useState } from "react";
import LabelGenerator, {
  LabelGeneratorCompact,
} from "@/components/LabelGenerator";

// Sample products for demo
const SAMPLE_PRODUCTS = [
  { sku: "WH-12345-BLK", name: "Wireless Bluetooth Headphones - Black Edition" },
  { sku: "KB-98765-RGB", name: "Mechanical Gaming Keyboard RGB" },
  { sku: "MS-54321-WH", name: "Ergonomic Wireless Mouse - White" },
  { sku: "CHG-11111-USB", name: "USB-C Fast Charger 65W" },
  { sku: "CAB-22222-3M", name: "Premium HDMI Cable 3 Meter" },
];

export default function LabelsPage() {
  const [selectedProduct, setSelectedProduct] = useState(SAMPLE_PRODUCTS[0]);
  const [customSku, setCustomSku] = useState("");
  const [customName, setCustomName] = useState("");

  const activeProduct =
    customSku && customName
      ? { sku: customSku, name: customName }
      : selectedProduct;

  return (
    <div className="labels-page">
      <header className="page-header">
        <h1 className="page-title">Label Generator</h1>
        <p className="page-subtitle">
          Generate and print barcode labels for inventory items
        </p>
      </header>

      <div className="page-content">
        {/* Left Column: Controls */}
        <div className="controls-section">
          {/* Custom Product Input */}
          <div className="control-card">
            <h2 className="control-title">Custom Label</h2>
            <div className="input-group">
              <label className="input-label">SKU</label>
              <input
                type="text"
                value={customSku}
                onChange={(e) => setCustomSku(e.target.value.toUpperCase())}
                placeholder="e.g., ABC-12345"
                className="text-input"
              />
            </div>
            <div className="input-group">
              <label className="input-label">Product Name</label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g., Widget Pro Max"
                className="text-input"
              />
            </div>
            {customSku && customName && (
              <button
                onClick={() => {
                  setCustomSku("");
                  setCustomName("");
                }}
                className="clear-button"
              >
                Clear Custom
              </button>
            )}
          </div>

          {/* Sample Products */}
          <div className="control-card">
            <h2 className="control-title">Sample Products</h2>
            <div className="product-list">
              {SAMPLE_PRODUCTS.map((product) => (
                <button
                  key={product.sku}
                  onClick={() => {
                    setSelectedProduct(product);
                    setCustomSku("");
                    setCustomName("");
                  }}
                  className={`product-button ${
                    selectedProduct.sku === product.sku &&
                    !customSku &&
                    !customName
                      ? "active"
                      : ""
                  }`}
                >
                  <span className="product-sku">{product.sku}</span>
                  <span className="product-name">
                    {product.name.length > 25
                      ? product.name.slice(0, 25) + "…"
                      : product.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Preview */}
        <div className="preview-section">
          <LabelGenerator sku={activeProduct.sku} name={activeProduct.name} />
        </div>
      </div>

      {/* Compact Variant Demo */}
      <section className="compact-section">
        <h2 className="section-title">Compact Variant</h2>
        <p className="section-subtitle">
          Use in lists or inline contexts
        </p>
        <div className="compact-list">
          {SAMPLE_PRODUCTS.slice(0, 3).map((product) => (
            <LabelGeneratorCompact
              key={product.sku}
              sku={product.sku}
              name={product.name}
            />
          ))}
        </div>
      </section>

      <style jsx>{`
        .labels-page {
          min-height: 100vh;
          padding: 48px 24px;
          background: linear-gradient(180deg, #09090b 0%, #0f0f10 100%);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .page-header {
          max-width: 1000px;
          margin: 0 auto 48px;
          text-align: center;
        }

        .page-title {
          font-size: 32px;
          font-weight: 700;
          color: #fafafa;
          margin: 0 0 8px 0;
          letter-spacing: -0.02em;
        }

        .page-subtitle {
          font-size: 16px;
          color: #71717a;
          margin: 0;
        }

        .page-content {
          max-width: 1000px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 32px;
          align-items: start;
        }

        @media (max-width: 768px) {
          .page-content {
            grid-template-columns: 1fr;
          }
        }

        .controls-section {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .control-card {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
          padding: 24px;
        }

        .control-title {
          font-size: 14px;
          font-weight: 500;
          color: #71717a;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin: 0 0 20px 0;
        }

        .input-group {
          margin-bottom: 16px;
        }

        .input-label {
          display: block;
          font-size: 13px;
          font-weight: 500;
          color: #a1a1aa;
          margin-bottom: 6px;
        }

        .text-input {
          width: 100%;
          padding: 12px 14px;
          font-size: 14px;
          color: #fafafa;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          outline: none;
          transition: all 0.2s ease;
        }

        .text-input::placeholder {
          color: #52525b;
        }

        .text-input:focus {
          border-color: rgba(34, 197, 94, 0.5);
          box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.1);
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
          margin-top: 8px;
        }

        .clear-button:hover {
          color: #a1a1aa;
          border-color: rgba(255, 255, 255, 0.2);
        }

        .product-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .product-button {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
          padding: 12px 14px;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: left;
        }

        .product-button:hover {
          background: rgba(255, 255, 255, 0.05);
          border-color: rgba(255, 255, 255, 0.1);
        }

        .product-button.active {
          background: rgba(34, 197, 94, 0.1);
          border-color: rgba(34, 197, 94, 0.3);
        }

        .product-sku {
          font-family: "SF Mono", "Fira Code", monospace;
          font-size: 13px;
          font-weight: 500;
          color: #22c55e;
        }

        .product-name {
          font-size: 13px;
          color: #a1a1aa;
        }

        .preview-section {
          position: sticky;
          top: 24px;
        }

        .compact-section {
          max-width: 600px;
          margin: 64px auto 0;
        }

        .section-title {
          font-size: 20px;
          font-weight: 600;
          color: #fafafa;
          margin: 0 0 8px 0;
        }

        .section-subtitle {
          font-size: 14px;
          color: #71717a;
          margin: 0 0 24px 0;
        }

        .compact-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
      `}</style>
    </div>
  );
}

