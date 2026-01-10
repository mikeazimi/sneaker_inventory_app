"use client"

import { useState, useRef } from "react"
import { Upload, X, FileText, CheckCircle2, AlertCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { supabase } from "@/lib/supabase"

interface CSVUploadProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (count: number) => void
}

interface ProductRow {
  sku: string
  name: string | null
  barcode: string | null
}

export function CSVUpload({ isOpen, onClose, onSuccess }: CSVUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [preview, setPreview] = useState<ProductRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ success: boolean; count: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!isOpen) return null

  const parseCSV = (text: string): ProductRow[] => {
    const lines = text.split(/\r?\n/).filter(line => line.trim())
    if (lines.length < 2) {
      throw new Error("CSV must have a header row and at least one data row")
    }

    // Detect delimiter (tab or comma)
    const delimiter = lines[0].includes('\t') ? '\t' : ','
    
    // Parse header
    const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase())
    
    // Find column indices
    const skuIndex = headers.findIndex(h => h === 'sku')
    const nameIndex = headers.findIndex(h => h === 'name' || h === 'product_name' || h === 'product name')
    const barcodeIndex = headers.findIndex(h => h === 'barcode' || h === 'upc')

    if (skuIndex === -1) {
      throw new Error("CSV must have a 'SKU' column")
    }
    if (nameIndex === -1) {
      throw new Error("CSV must have a 'Name' or 'Product Name' column")
    }

    // Parse data rows
    const products: ProductRow[] = []
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(delimiter)
      const sku = values[skuIndex]?.trim()
      const name = values[nameIndex]?.trim()
      const barcode = barcodeIndex !== -1 ? values[barcodeIndex]?.trim() : null

      if (sku && name) {
        products.push({ sku, name, barcode: barcode || null })
      }
    }

    return products
  }

  const handleFile = async (selectedFile: File) => {
    setFile(selectedFile)
    setError(null)
    setResult(null)
    setPreview([])

    try {
      const text = await selectedFile.text()
      const products = parseCSV(text)
      
      if (products.length === 0) {
        throw new Error("No valid products found in CSV")
      }

      setPreview(products.slice(0, 5)) // Show first 5 as preview
      console.log(`Parsed ${products.length} products from CSV`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse CSV")
      setFile(null)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && (droppedFile.type === 'text/csv' || droppedFile.name.endsWith('.csv') || droppedFile.name.endsWith('.txt'))) {
      handleFile(droppedFile)
    } else {
      setError("Please upload a CSV file")
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      handleFile(selectedFile)
    }
  }

  const handleUpload = async () => {
    if (!file) return

    setIsProcessing(true)
    setError(null)

    try {
      const text = await file.text()
      const products = parseCSV(text)

      // Deduplicate by SKU (keep last occurrence)
      const skuMap = new Map<string, ProductRow>()
      for (const product of products) {
        skuMap.set(product.sku, product)
      }
      const uniqueProducts = Array.from(skuMap.values())
      console.log(`Deduplicated ${products.length} rows to ${uniqueProducts.length} unique SKUs`)

      // Batch upsert to Supabase
      const BATCH_SIZE = 500
      let totalUpserted = 0

      for (let i = 0; i < uniqueProducts.length; i += BATCH_SIZE) {
        const batch = uniqueProducts.slice(i, i + BATCH_SIZE)
        
        const { error: upsertError } = await supabase
          .from("products")
          .upsert(
            batch.map(p => ({
              sku: p.sku,
              name: p.name,
              barcode: p.barcode,
            })),
            { onConflict: "sku", ignoreDuplicates: false }
          )

        if (upsertError) {
          console.error("Upsert error details:", JSON.stringify(upsertError, null, 2))
          console.error("Upsert error code:", upsertError.code)
          console.error("Upsert error hint:", upsertError.hint)
          console.error("Upsert error details:", upsertError.details)
          throw new Error(`Failed to save: ${upsertError.message || upsertError.code || 'RLS policy error'}`)
        }

        totalUpserted += batch.length
        console.log(`Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}, total: ${totalUpserted}`)
      }

      setResult({ success: true, count: uniqueProducts.length })
      onSuccess(totalUpserted)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
      setResult({ success: false, count: 0 })
    } finally {
      setIsProcessing(false)
    }
  }

  const resetUpload = () => {
    setFile(null)
    setPreview([])
    setError(null)
    setResult(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-auto bg-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg font-bold">Upload Product CSV</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Instructions */}
          <div className="text-sm text-muted-foreground bg-secondary/50 p-3 rounded-lg">
            <p className="font-medium mb-1">Required columns:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li><code className="text-primary">SKU</code> - Product SKU</li>
              <li><code className="text-primary">Name</code> - Product name</li>
              <li><code className="text-primary">Barcode</code> (optional) - UPC/Barcode</li>
            </ul>
            <p className="mt-2 text-xs">Supports CSV (comma-separated) or TSV (tab-separated) files.</p>
          </div>

          {/* Drop Zone */}
          {!file && !result && (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                isDragging 
                  ? "border-primary bg-primary/10" 
                  : "border-border hover:border-primary/50 hover:bg-secondary/50"
              }`}
            >
              <Upload className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
              <p className="text-base font-medium">Drop CSV file here or click to browse</p>
              <p className="text-sm text-muted-foreground mt-1">CSV or TXT files accepted</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* File Selected - Preview */}
          {file && !result && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-secondary rounded-lg">
                <FileText className="w-8 h-8 text-primary" />
                <div className="flex-1">
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {preview.length > 0 ? `${preview.length}+ products found` : "Parsing..."}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={resetUpload}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Preview Table */}
              {preview.length > 0 && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="bg-secondary px-3 py-2 text-xs font-medium text-muted-foreground">
                    Preview (first 5 rows)
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">SKU</th>
                        <th className="px-3 py-2 text-left font-medium">Name</th>
                        <th className="px-3 py-2 text-left font-medium">Barcode</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {preview.map((row, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 font-mono text-xs">{row.sku}</td>
                          <td className="px-3 py-2 truncate max-w-[200px]">{row.name}</td>
                          <td className="px-3 py-2 font-mono text-xs">{row.barcode || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Upload Button */}
              <Button
                onClick={handleUpload}
                disabled={isProcessing || preview.length === 0}
                className="w-full h-12 bg-primary hover:bg-primary/90"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5 mr-2" />
                    Upload {preview.length}+ Products
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Success Result */}
          {result?.success && (
            <div className="text-center py-6">
              <CheckCircle2 className="w-16 h-16 mx-auto text-green-500 mb-3" />
              <h3 className="text-xl font-bold mb-1">Upload Complete!</h3>
              <p className="text-muted-foreground">
                Successfully imported {result.count} products
              </p>
              <div className="flex gap-2 mt-4 justify-center">
                <Button variant="outline" onClick={resetUpload}>
                  Upload Another
                </Button>
                <Button onClick={onClose}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

