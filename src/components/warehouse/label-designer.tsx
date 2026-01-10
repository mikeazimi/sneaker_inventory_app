"use client"

import { useState, useRef } from "react"
import { X, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import Barcode from "react-barcode"

// Label size presets (in inches)
export const LABEL_SIZES = [
  { id: "2x1", name: "2\" × 1\"", width: 2, height: 1 },
  { id: "2.25x1.25", name: "2.25\" × 1.25\"", width: 2.25, height: 1.25 },
  { id: "3x2", name: "3\" × 2\"", width: 3, height: 2 },
  { id: "4x2", name: "4\" × 2\"", width: 4, height: 2 },
  { id: "4x3", name: "4\" × 3\"", width: 4, height: 3 },
  { id: "4x6", name: "4\" × 6\"", width: 4, height: 6 },
] as const

// Available fields to print
export const LABEL_FIELDS = [
  { id: "sku", name: "SKU", defaultEnabled: true },
  { id: "barcode", name: "Barcode", defaultEnabled: true },
  { id: "productName", name: "Product Name", defaultEnabled: false },
  { id: "location", name: "Bin Location(s)", defaultEnabled: true },
  { id: "quantity", name: "Quantity", defaultEnabled: false },
  { id: "price", name: "Price", defaultEnabled: false },
  { id: "customText", name: "Custom Text", defaultEnabled: false },
] as const

// Calculate barcode dimensions based on label size - FIXED for proper scaling
function getBarcodeConfig(size: typeof LABEL_SIZES[number]) {
  // Base the barcode width on label width, height on label area
  const labelWidthPx = size.width * 96 // 96 DPI
  const labelHeightPx = size.height * 96
  
  // Barcode should take up ~80% of label width
  const barcodeWidthPx = labelWidthPx * 0.85
  
  // Scale factor for react-barcode (it uses a multiplier)
  // Each bar is about 2px wide at width=1, so we need to calculate
  const targetBars = barcodeWidthPx / 2.5 // Approximate bars at width 1
  const width = Math.max(1, Math.min(4, barcodeWidthPx / 100)) // Clamp between 1-4
  
  // Height should be proportional to label size
  const height = Math.min(labelHeightPx * 0.4, 150) // Max 150px, but scale with label
  
  // Font size for barcode text
  const fontSize = Math.max(10, Math.min(20, size.width * 4))
  
  return { width, height, fontSize }
}

export interface LabelConfig {
  size: typeof LABEL_SIZES[number]
  fields: {
    id: string
    enabled: boolean
    value?: string
  }[]
  showBorder: boolean
  copies: number
}

interface LabelDesignerProps {
  isOpen: boolean
  onClose: () => void
  item: {
    sku: string
    name?: string
    barcode?: string
    price?: number | string
    binLocations: { binName: string; qty: number }[]
  } | null
  onPrint: (config: LabelConfig) => void
}

export function LabelDesigner({ isOpen, onClose, item, onPrint }: LabelDesignerProps) {
  const [selectedSize, setSelectedSize] = useState(LABEL_SIZES[3]) // 4x2 default
  const [enabledFields, setEnabledFields] = useState<Record<string, boolean>>({
    sku: true,
    barcode: true,
    productName: false,
    location: true,
    quantity: false,
    price: false,
    customText: false,
  })
  const [customText, setCustomText] = useState("")
  const [customPrice, setCustomPrice] = useState("")
  const [showBorder, setShowBorder] = useState(true)
  const [copies, setCopies] = useState(1)
  const printRef = useRef<HTMLDivElement>(null)
  
  const barcodeConfig = getBarcodeConfig(selectedSize)

  if (!isOpen || !item) return null

  const toggleField = (fieldId: string) => {
    setEnabledFields(prev => ({ ...prev, [fieldId]: !prev[fieldId] }))
  }

  // Calculate font sizes based on label size
  const getFontSizes = () => {
    const base = selectedSize.width * 96
    return {
      sku: Math.max(14, Math.min(32, base / 10)),
      productName: Math.max(10, Math.min(18, base / 16)),
      location: Math.max(10, Math.min(16, base / 14)),
      quantity: Math.max(12, Math.min(24, base / 12)),
      price: Math.max(16, Math.min(36, base / 8)),
      customText: Math.max(10, Math.min(14, base / 20)),
    }
  }
  
  const fontSizes = getFontSizes()

  const handlePrint = () => {
    const config: LabelConfig = {
      size: selectedSize,
      fields: Object.entries(enabledFields).map(([id, enabled]) => ({
        id,
        enabled,
        value: id === "customText" ? customText : undefined,
      })),
      showBorder,
      copies,
    }
    onPrint(config)

    const printContent = printRef.current
    if (printContent) {
      const printWindow = window.open("", "_blank")
      if (printWindow) {
        // Clone the content and get the SVG
        const clone = printContent.cloneNode(true) as HTMLElement
        
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Print Label - ${item.sku}</title>
            <style>
              @page {
                size: ${selectedSize.width}in ${selectedSize.height}in;
                margin: 0;
              }
              * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
              }
              html, body {
                width: ${selectedSize.width}in;
                height: ${selectedSize.height}in;
                margin: 0;
                padding: 0;
              }
              body {
                display: flex;
                flex-direction: column;
              }
              .label-page {
                width: ${selectedSize.width}in;
                height: ${selectedSize.height}in;
                page-break-after: always;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 0.15in;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                ${showBorder ? "border: 1px solid #000;" : ""}
              }
              .label-page:last-child {
                page-break-after: avoid;
              }
              .sku-text {
                font-size: ${fontSizes.sku}px;
                font-weight: bold;
                font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
                text-align: center;
                margin-bottom: ${selectedSize.height >= 3 ? "12px" : "4px"};
              }
              .product-name {
                font-size: ${fontSizes.productName}px;
                color: #333;
                text-align: center;
                margin-bottom: ${selectedSize.height >= 3 ? "8px" : "4px"};
                max-width: 95%;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              }
              .barcode-wrapper {
                display: flex;
                justify-content: center;
                align-items: center;
                width: 100%;
                margin: ${selectedSize.height >= 4 ? "16px" : "8px"} 0;
              }
              .barcode-wrapper svg {
                max-width: 100% !important;
                height: auto !important;
              }
              .locations {
                display: flex;
                flex-wrap: wrap;
                gap: ${selectedSize.height >= 3 ? "8px" : "4px"};
                justify-content: center;
                margin-top: ${selectedSize.height >= 3 ? "12px" : "4px"};
              }
              .location-tag {
                background: #e5e5e5;
                padding: ${selectedSize.height >= 3 ? "4px 12px" : "2px 8px"};
                border-radius: 4px;
                font-size: ${fontSizes.location}px;
                font-weight: 600;
              }
              .quantity-text {
                font-size: ${fontSizes.quantity}px;
                font-weight: bold;
                margin-top: ${selectedSize.height >= 3 ? "12px" : "6px"};
              }
              .price-text {
                font-size: ${fontSizes.price}px;
                font-weight: bold;
                color: #15803d;
                margin-top: ${selectedSize.height >= 3 ? "12px" : "6px"};
              }
              .custom-text {
                font-size: ${fontSizes.customText}px;
                color: #666;
                margin-top: ${selectedSize.height >= 3 ? "8px" : "4px"};
                text-align: center;
              }
            </style>
          </head>
          <body>
            ${Array(copies).fill(`<div class="label-page">${clone.innerHTML}</div>`).join("")}
          </body>
          </html>
        `)
        printWindow.document.close()
        printWindow.focus()
        setTimeout(() => {
          printWindow.print()
          printWindow.close()
        }, 300)
      }
    }
  }

  const totalQty = item.binLocations.reduce((sum, bin) => sum + bin.qty, 0)

  // Preview scale for display (shrink large labels to fit preview area)
  const previewScale = selectedSize.height > 3 ? 0.6 : selectedSize.height > 2 ? 0.8 : 1

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-auto bg-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg font-bold">Label Designer</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Preview */}
          <div className="bg-gray-100 rounded-lg p-4 flex items-center justify-center overflow-hidden">
            <div
              style={{
                transform: `scale(${previewScale})`,
                transformOrigin: "center center",
              }}
            >
              <div
                ref={printRef}
                className="bg-white text-black flex flex-col items-center justify-center"
                style={{
                  width: `${selectedSize.width * 96}px`,
                  height: `${selectedSize.height * 96}px`,
                  padding: `${selectedSize.height >= 3 ? 16 : 8}px`,
                  border: showBorder ? "2px solid #000" : "2px dashed #ccc",
                }}
              >
                {enabledFields.sku && (
                  <div 
                    className="sku-text font-bold font-mono text-center"
                    style={{ fontSize: `${fontSizes.sku}px`, marginBottom: selectedSize.height >= 3 ? 12 : 4 }}
                  >
                    {item.sku}
                  </div>
                )}
                
                {enabledFields.productName && item.name && item.name !== item.sku && (
                  <div 
                    className="product-name text-gray-700 truncate text-center"
                    style={{ 
                      fontSize: `${fontSizes.productName}px`, 
                      marginBottom: selectedSize.height >= 3 ? 8 : 4,
                      maxWidth: "95%"
                    }}
                  >
                    {item.name}
                  </div>
                )}
                
                {enabledFields.barcode && (
                  <div 
                    className="barcode-wrapper flex justify-center items-center w-full"
                    style={{ margin: `${selectedSize.height >= 4 ? 16 : 8}px 0` }}
                  >
                    <Barcode
                      value={item.barcode || item.sku}
                      width={barcodeConfig.width}
                      height={barcodeConfig.height}
                      fontSize={barcodeConfig.fontSize}
                      margin={0}
                      displayValue={true}
                      textMargin={4}
                    />
                  </div>
                )}
                
                {enabledFields.location && item.binLocations.length > 0 && (
                  <div 
                    className="locations flex flex-wrap justify-center"
                    style={{ 
                      gap: selectedSize.height >= 3 ? 8 : 4,
                      marginTop: selectedSize.height >= 3 ? 12 : 4 
                    }}
                  >
                    {item.binLocations.map((bin, i) => (
                      <span 
                        key={i} 
                        className="location-tag bg-gray-200 rounded font-semibold"
                        style={{ 
                          fontSize: `${fontSizes.location}px`,
                          padding: selectedSize.height >= 3 ? "4px 12px" : "2px 8px"
                        }}
                      >
                        {bin.binName}
                      </span>
                    ))}
                  </div>
                )}
                
                {enabledFields.quantity && (
                  <div 
                    className="quantity-text font-bold"
                    style={{ 
                      fontSize: `${fontSizes.quantity}px`,
                      marginTop: selectedSize.height >= 3 ? 12 : 6
                    }}
                  >
                    Qty: {totalQty}
                  </div>
                )}
                
                {enabledFields.price && (
                  <div 
                    className="price-text font-bold text-green-700"
                    style={{ 
                      fontSize: `${fontSizes.price}px`,
                      marginTop: selectedSize.height >= 3 ? 12 : 6
                    }}
                  >
                    ${customPrice || item.price || "0.00"}
                  </div>
                )}
                
                {enabledFields.customText && customText && (
                  <div 
                    className="custom-text text-gray-500 text-center"
                    style={{ 
                      fontSize: `${fontSizes.customText}px`,
                      marginTop: selectedSize.height >= 3 ? 8 : 4
                    }}
                  >
                    {customText}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Label Size Selection */}
          <div>
            <Label className="text-sm font-medium mb-2 block">Label Size</Label>
            <div className="grid grid-cols-3 gap-2">
              {LABEL_SIZES.map((size) => (
                <button
                  key={size.id}
                  onClick={() => setSelectedSize(size)}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    selectedSize.id === size.id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary border-border hover:bg-secondary/80"
                  }`}
                >
                  {size.name}
                </button>
              ))}
            </div>
          </div>

          {/* Fields to Include */}
          <div>
            <Label className="text-sm font-medium mb-2 block">Fields to Print</Label>
            <div className="space-y-2">
              {LABEL_FIELDS.map((field) => (
                <div
                  key={field.id}
                  className="flex items-center justify-between px-3 py-2 bg-secondary rounded-lg"
                >
                  <span className="text-sm font-medium">{field.name}</span>
                  <Switch
                    checked={enabledFields[field.id]}
                    onCheckedChange={() => toggleField(field.id)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Price Input */}
          {enabledFields.price && (
            <div>
              <Label className="text-sm font-medium mb-2 block">Price</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={customPrice}
                  onChange={(e) => setCustomPrice(e.target.value)}
                  placeholder={item?.price?.toString() || "0.00"}
                  className="bg-secondary pl-7"
                />
              </div>
            </div>
          )}

          {/* Custom Text Input */}
          {enabledFields.customText && (
            <div>
              <Label className="text-sm font-medium mb-2 block">Custom Text</Label>
              <Input
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="Enter custom text..."
                className="bg-secondary"
              />
            </div>
          )}

          {/* Options */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                checked={showBorder}
                onCheckedChange={setShowBorder}
              />
              <Label className="text-sm">Show Border</Label>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm">Copies:</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={copies}
                onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20 bg-secondary"
              />
            </div>
          </div>

          {/* Print Button */}
          <Button
            onClick={handlePrint}
            className="w-full h-14 bg-primary hover:bg-primary/90 text-primary-foreground text-lg font-bold"
          >
            <Printer className="w-6 h-6 mr-2" />
            Print {copies > 1 ? `${copies} Labels` : "Label"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
