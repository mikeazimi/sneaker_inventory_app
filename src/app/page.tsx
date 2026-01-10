"use client";

import { useState, useCallback, useEffect } from "react"
import { Header } from "@/components/warehouse/header"
import { BottomNav, type TabType } from "@/components/warehouse/bottom-nav"
import { SettingsView, type Warehouse } from "@/components/warehouse/settings-view"
import { InventoryView, type InventoryItem } from "@/components/warehouse/inventory-view"
import { LabelDesigner, type LabelConfig } from "@/components/warehouse/label-designer"
import BarcodeScanner from "@/components/BarcodeScanner"
import { getWarehouses, getInventoryItems, type Warehouse as ApiWarehouse } from "@/lib/api"
import { supabase } from "@/lib/supabase"

// Extended warehouse type with ShipHero ID
interface ExtendedWarehouse extends Warehouse {
  shipheroId: number;
}

export default function WarehouseDashboard() {
  const [isConnected, setIsConnected] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [isLoadingInventory, setIsLoadingInventory] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>("inventory")
  const [selectedWarehouse, setSelectedWarehouse] = useState<ExtendedWarehouse | null>(null)
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [warehouses, setWarehouses] = useState<ExtendedWarehouse[]>([])
  const [connectionMessage, setConnectionMessage] = useState<string>("")
  const [labelDesignerOpen, setLabelDesignerOpen] = useState(false)
  const [selectedItemForLabel, setSelectedItemForLabel] = useState<InventoryItem | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannedQuery, setScannedQuery] = useState<string | null>(null)

  // Load warehouses and check connection status on mount
  useEffect(() => {
    async function loadData() {
      // Fetch warehouses from database
      console.log("Loading warehouses...")
      const warehouseData = await getWarehouses()
      console.log("Warehouse data from API:", warehouseData)
      
      const mappedWarehouses: ExtendedWarehouse[] = warehouseData.map((w: ApiWarehouse) => ({
        id: w.id,
        name: w.name,
        address: `Warehouse ID: ${w.shiphero_id_plain}`,
        shipheroId: w.shiphero_id_plain,
      }))
      console.log("Mapped warehouses:", mappedWarehouses)
      setWarehouses(mappedWarehouses)

      // Check if we have valid credentials (i.e., already connected)
      const { data: credentials, error: credError } = await supabase
        .from("api_credentials")
        .select("access_token, expires_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      console.log("Credentials check:", { credentials, credError })

      if (credentials?.access_token && credentials.access_token !== "placeholder_access_token") {
        // Check if token is not expired
        const expiresAt = new Date(credentials.expires_at)
        if (expiresAt > new Date()) {
          setIsConnected(true)
        }
      }
    }
    loadData()
  }, [])

  // Function to refresh warehouses (called after sync)
  const refreshWarehouses = useCallback(async () => {
    const warehouseData = await getWarehouses()
    const mappedWarehouses: ExtendedWarehouse[] = warehouseData.map((w: ApiWarehouse) => ({
      id: w.id,
      name: w.name,
      address: `Warehouse ID: ${w.shiphero_id_plain}`,
      shipheroId: w.shiphero_id_plain,
    }))
    setWarehouses(mappedWarehouses)
  }, [])

  const handleScan = useCallback(() => {
    setScannerOpen(true)
    setIsScanning(true)
  }, [])

  const handleBarcodeDetected = useCallback((code: string) => {
    console.log("Barcode detected:", code)
    setScannerOpen(false)
    setIsScanning(false)
    setScannedQuery(code)
    
    // Find the product in inventory by barcode or SKU
    const foundItem = inventory.find(
      item => 
        item.barcode.toLowerCase() === code.toLowerCase() ||
        item.sku.toLowerCase() === code.toLowerCase()
    )
    
    if (foundItem) {
      console.log("Found matching item:", foundItem)
      // The InventoryView will handle showing the item when scannedQuery changes
    } else {
      console.log("No matching item found for code:", code)
    }
  }, [inventory])

  const handleScannerClose = useCallback(() => {
    setScannerOpen(false)
    setIsScanning(false)
  }, [])

  const handlePrintLabel = useCallback((item: InventoryItem) => {
    setSelectedItemForLabel(item)
    setLabelDesignerOpen(true)
  }, [])

  const handleLabelPrint = useCallback((config: LabelConfig) => {
    console.log("Printing label with config:", config)
    // The actual printing is handled inside LabelDesigner
    setLabelDesignerOpen(false)
  }, [])

  const handleSelectWarehouse = useCallback(async (warehouse: Warehouse) => {
    const extWarehouse = warehouse as ExtendedWarehouse
    setSelectedWarehouse(extWarehouse)
    setActiveTab("inventory")
    
    // Load inventory for this warehouse
    if (extWarehouse.shipheroId) {
      setIsLoadingInventory(true)
      try {
        const items = await getInventoryItems(extWarehouse.shipheroId)
        const mappedItems: InventoryItem[] = items.map((item, index) => ({
          id: `${extWarehouse.shipheroId}-${item.sku}-${index}`,
          sku: item.sku,
          barcode: item.barcode || item.sku, // Use barcode from products table, fallback to SKU
          name: item.name || item.sku, // Use product name if available, fallback to SKU
          totalQty: item.totalQty,
          binLocations: item.binLocations.map(bin => ({
            binName: bin.binName,
            qty: bin.qty,
          })),
        }))
        setInventory(mappedItems)
        console.log(`Loaded ${mappedItems.length} inventory items`)
      } catch (error) {
        console.error("Error loading inventory:", error)
        setInventory([])
      } finally {
        setIsLoadingInventory(false)
      }
    }
  }, [])

  const handleConnectionChange = useCallback(async (connected: boolean, message?: string) => {
    setIsConnected(connected)
    if (message) {
      setConnectionMessage(message)
    }
    
    // If connected, refresh warehouses and switch to inventory tab
    if (connected) {
      await refreshWarehouses()
      setTimeout(() => {
        setActiveTab("inventory")
      }, 1500)
    }
  }, [refreshWarehouses])

  return (
    <div className="flex flex-col h-dvh bg-background">
      <Header isConnected={isConnected} />

      <main className="flex-1 flex flex-col overflow-hidden">
        {activeTab === "inventory" && (
          <InventoryView
            warehouses={warehouses}
            selectedWarehouse={selectedWarehouse}
            onSelectWarehouse={handleSelectWarehouse}
            items={inventory}
            onScan={handleScan}
            isScanning={isScanning}
            isLoading={isLoadingInventory}
            onPrintLabel={handlePrintLabel}
            scannedQuery={scannedQuery}
          />
        )}

        {activeTab === "settings" && (
          <SettingsView 
            isConnected={isConnected} 
            onConnectionChange={handleConnectionChange}
            onWarehouseSync={refreshWarehouses}
          />
        )}
      </main>

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Label Designer Modal */}
      <LabelDesigner
        isOpen={labelDesignerOpen}
        onClose={() => setLabelDesignerOpen(false)}
        item={selectedItemForLabel}
        onPrint={handleLabelPrint}
      />

      {/* Barcode Scanner Modal */}
      <BarcodeScanner
        isOpen={scannerOpen}
        onClose={handleScannerClose}
        onDetected={handleBarcodeDetected}
        title="Scan Product Barcode"
      />
    </div>
  )
}
