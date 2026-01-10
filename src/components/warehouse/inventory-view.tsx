"use client"

import { useState, useRef, useEffect } from "react"
import { Search, Package, Camera, MapPin, Printer, Barcode, ChevronDown, Check } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { Warehouse } from "./settings-view"

export interface InventoryItem {
  id: string
  sku: string
  barcode: string
  name: string
  totalQty: number
  price?: number | string
  binLocations: { binName: string; qty: number }[]
}

interface InventoryViewProps {
  warehouses: Warehouse[]
  selectedWarehouse: Warehouse | null
  onSelectWarehouse: (warehouse: Warehouse) => void
  items: InventoryItem[]
  onScan: () => void
  isScanning: boolean
  isLoading?: boolean
  onPrintLabel: (item: InventoryItem) => void
  scannedQuery?: string | null
}

export function InventoryView({
  warehouses,
  selectedWarehouse,
  onSelectWarehouse,
  items,
  onScan,
  isScanning,
  isLoading = false,
  onPrintLabel,
  scannedQuery,
}: InventoryViewProps) {
  const [query, setQuery] = useState("")
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [showWarehouseList, setShowWarehouseList] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Handle scanned query - automatically search and select if found
  useEffect(() => {
    if (scannedQuery) {
      setQuery(scannedQuery)
      // Find the matching item
      const foundItem = items.find(
        item =>
          item.barcode.toLowerCase() === scannedQuery.toLowerCase() ||
          item.sku.toLowerCase() === scannedQuery.toLowerCase()
      )
      if (foundItem) {
        setSelectedItem(foundItem)
      }
    }
  }, [scannedQuery, items])

  // Show all items when no query, or filtered items when searching
  const filteredItems =
    query.length > 0
      ? items.filter(
          (item) =>
            item.sku.toLowerCase().includes(query.toLowerCase()) ||
            item.barcode.toLowerCase().includes(query.toLowerCase()) ||
            item.name.toLowerCase().includes(query.toLowerCase()),
        )
      : items

  useEffect(() => {
    if (query.length > 0 && filteredItems.length === 1) {
      const exactMatch = filteredItems[0]
      if (
        exactMatch.sku.toLowerCase() === query.toLowerCase() ||
        exactMatch.barcode.toLowerCase() === query.toLowerCase()
      ) {
        setSelectedItem(exactMatch)
      }
    }
  }, [query, filteredItems])

  const handleItemSelect = (item: InventoryItem) => {
    setSelectedItem(item)
    setQuery(item.sku)
  }

  const clearSelection = () => {
    setSelectedItem(null)
    setQuery("")
    inputRef.current?.focus()
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-4 py-3 bg-card border-b border-border">
        <button
          onClick={() => setShowWarehouseList(!showWarehouseList)}
          className="w-full px-4 py-3 bg-secondary border border-border rounded-lg flex items-center justify-between hover:bg-secondary/80 transition-colors"
        >
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            <div className="flex flex-col items-start">
              {selectedWarehouse ? (
                <>
                  <span className="text-base font-semibold text-foreground">{selectedWarehouse.name}</span>
                  <span className="text-xs text-muted-foreground">Latest inventory snapshot</span>
                </>
              ) : (
                <span className="text-muted-foreground">Select a warehouse...</span>
              )}
            </div>
          </div>
          <ChevronDown
            className={`w-5 h-5 text-muted-foreground transition-transform ${showWarehouseList ? "rotate-180" : ""}`}
          />
        </button>

        {/* Warehouse dropdown list */}
        {showWarehouseList && (
          <div className="mt-2 bg-secondary rounded-lg border border-border overflow-hidden">
            {warehouses.length === 0 ? (
              <div className="px-4 py-6 text-center text-muted-foreground text-sm">
                Connect your ShipHero account in Settings to load warehouses
              </div>
            ) : (
              <ul className="divide-y divide-border max-h-64 overflow-auto">
                {warehouses.map((warehouse) => (
                  <li key={warehouse.id}>
                    <button
                      onClick={() => {
                        onSelectWarehouse(warehouse)
                        setShowWarehouseList(false)
                      }}
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-card transition-colors"
                    >
                      <div className="flex flex-col items-start">
                        <span className="text-base font-medium text-foreground">{warehouse.name}</span>
                        <span className="text-xs text-muted-foreground">{warehouse.address}</span>
                      </div>
                      {selectedWarehouse?.id === warehouse.id && <Check className="w-5 h-5 text-primary" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Search/Scan Section - only show if warehouse selected */}
      {selectedWarehouse ? (
        <>
          <div className="p-4 space-y-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                ref={inputRef}
                type="search"
                placeholder="SKU, barcode, or product name..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  if (e.target.value !== selectedItem?.sku) {
                    setSelectedItem(null)
                  }
                }}
                className="pl-10 pr-4 h-14 bg-secondary border-border text-foreground placeholder:text-muted-foreground text-lg"
              />
            </div>

            {/* Scan Button */}
            <Button
              onClick={onScan}
              disabled={isScanning}
              className="w-full h-16 bg-primary hover:bg-primary/90 text-primary-foreground text-lg font-bold rounded-xl disabled:opacity-50"
            >
              {isScanning ? (
                <>
                  <div className="w-6 h-6 mr-3 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <Camera className="w-6 h-6 mr-3" />
                  Scan Barcode
                </>
              )}
            </Button>
          </div>

          {/* Results Area */}
          <div className="flex-1 overflow-auto px-4 pb-24">
            {/* Selected Item Detail - Shows inline with bin locations */}
            {selectedItem ? (
              <div className="space-y-4">
                {/* Item Header Card */}
                <Card className="bg-card border-border">
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-foreground font-mono leading-tight mb-1">
                          {selectedItem.sku}
                        </h3>
                        {selectedItem.name && selectedItem.name !== selectedItem.sku && (
                          <p className="text-sm text-muted-foreground">{selectedItem.name}</p>
                        )}
                        {selectedItem.barcode && selectedItem.barcode !== selectedItem.sku && (
                          <div className="flex items-center gap-1.5 mt-2 text-muted-foreground">
                            <Barcode className="w-3.5 h-3.5" />
                            <span className="text-xs font-mono">{selectedItem.barcode}</span>
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="text-5xl font-bold text-primary">{selectedItem.totalQty}</span>
                        <p className="text-sm text-muted-foreground">Total Units</p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearSelection}
                      className="text-muted-foreground bg-transparent"
                    >
                      ← Back to List
                    </Button>
                  </CardContent>
                </Card>

                {/* Bin Locations - Shown directly without extra click */}
                <Card className="bg-card border-border">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-primary" />
                      Bin Locations ({selectedItem.binLocations.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ul className="divide-y divide-border">
                      {selectedItem.binLocations.map((bin, index) => (
                        <li key={index} className="px-4 py-4 flex items-center justify-between bg-secondary/30 hover:bg-secondary/50">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                              <MapPin className="w-5 h-5 text-primary" />
                            </div>
                            <span className="text-lg font-bold text-foreground">{bin.binName}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-3xl font-bold text-primary">{bin.qty}</span>
                            <p className="text-xs text-muted-foreground">units</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                {/* Print Label Button */}
                <Button
                  onClick={() => onPrintLabel(selectedItem)}
                  className="w-full h-14 bg-primary hover:bg-primary/90 text-primary-foreground text-lg font-bold rounded-xl"
                >
                  <Printer className="w-6 h-6 mr-2" />
                  Print Label
                </Button>
              </div>
            ) : isLoading ? (
              /* Loading state */
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-sm">Loading inventory...</p>
              </div>
            ) : filteredItems.length > 0 ? (
              /* Inventory List */
              <Card className="bg-card border-border overflow-hidden">
                <CardContent className="p-0">
                  <div className="px-4 py-2 bg-secondary/50 border-b border-border">
                    <span className="text-xs text-muted-foreground">
                      {query.length > 0 
                        ? `${filteredItems.length} results for "${query}"`
                        : `${filteredItems.length} items in inventory`}
                    </span>
                  </div>
                  <ul className="divide-y divide-border max-h-[60vh] overflow-auto">
                    {filteredItems.map((item) => (
                      <li key={item.id} className="border-b border-border last:border-b-0">
                        <div className="px-4 py-3">
                          {/* SKU Header Row */}
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex-1">
                              <span className="text-base font-bold text-foreground font-mono">{item.sku}</span>
                              {item.name && item.name !== item.sku && (
                                <p className="text-sm text-muted-foreground">{item.name}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <span className="text-2xl font-bold text-primary">{item.totalQty}</span>
                                <p className="text-xs text-muted-foreground">total</p>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleItemSelect(item)}
                                className="text-primary hover:bg-primary/10"
                              >
                                <Printer className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                          {/* Bin Locations - Always visible */}
                          <div className="flex flex-wrap gap-2">
                            {item.binLocations.map((bin, index) => (
                              <div
                                key={index}
                                className="flex items-center gap-2 px-3 py-1.5 bg-secondary rounded-lg"
                              >
                                <MapPin className="w-3.5 h-3.5 text-primary" />
                                <span className="text-sm font-medium text-foreground">{bin.binName}</span>
                                <span className="text-sm font-bold text-primary">×{bin.qty}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : (
              /* Empty State - No inventory */
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Package className="w-12 h-12 mb-3 opacity-50" />
                <p className="text-sm text-center">
                  {query.length > 0 
                    ? `No items found for "${query}"`
                    : "No inventory data yet.\nSync inventory from Settings to see items here."}
                </p>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Empty state when no warehouse selected */
        <div className="flex flex-col flex-1 items-center justify-center p-4 gap-4">
          <Package className="w-16 h-16 text-muted-foreground opacity-50" />
          <div className="text-center">
            <h2 className="text-xl font-bold text-foreground mb-2">Select a Warehouse</h2>
            <p className="text-muted-foreground text-sm">Choose a warehouse above to view inventory data</p>
          </div>
        </div>
      )}
    </div>
  )
}
