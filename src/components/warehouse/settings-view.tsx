"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { 
  Printer, Wifi, Volume2, Moon, Info, Key, User, Lock, Loader2, 
  CheckCircle2, XCircle, RefreshCw, Clock, Upload, Settings, 
  Database, Smartphone, ChevronRight, AlertCircle, Timer
} from "lucide-react"
import { CSVUpload } from "./csv-upload"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  authenticateWithCredentials, authenticateWithToken, triggerInventorySnapshot, 
  getSyncSettings, updateSyncSettings, getRecentSyncJobs, syncWarehouses, 
  checkSnapshotStatus, cancelPendingSyncJobs, getWarehouses, syncProducts,
  refreshTokenDirect, getStoredCredentials,
  type SyncJob, type Warehouse as ApiWarehouse 
} from "@/lib/api"

export interface Warehouse {
  id: string
  name: string
  address: string
}

interface SettingsViewProps {
  isConnected: boolean
  onConnectionChange: (connected: boolean, message?: string) => void
  onWarehouseSync?: () => Promise<void>
}

export interface ShipHeroCredentials {
  authType: "user" | "developer"
  username?: string
  password?: string
  developerToken?: string
}

type ConnectionStatus = "idle" | "connecting" | "success" | "error"
type SettingsTab = "connection" | "sync" | "printer" | "app"

const SYNC_INTERVAL_OPTIONS = [
  { value: 1, label: "Every 1 hour" },
  { value: 2, label: "Every 2 hours" },
  { value: 4, label: "Every 4 hours" },
  { value: 6, label: "Every 6 hours" },
  { value: 12, label: "Every 12 hours" },
  { value: 24, label: "Every 24 hours" },
]

export function SettingsView({ isConnected, onConnectionChange, onWarehouseSync }: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("connection")
  const [authType, setAuthType] = useState<"user" | "developer">("developer")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [developerToken, setDeveloperToken] = useState("")
  const [refreshTokenInput, setRefreshTokenInput] = useState("")
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle")
  const [statusMessage, setStatusMessage] = useState("")
  const [tokenExpiresAt, setTokenExpiresAt] = useState<Date | null>(null)
  const [tokenCountdown, setTokenCountdown] = useState<string>("")
  const [isRefreshing, setIsRefreshing] = useState(false)
  
  // Load saved token and refresh token from localStorage on mount and auto-connect
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedToken = localStorage.getItem("shiphero_developer_token")
      const savedRefreshToken = localStorage.getItem("shiphero_refresh_token")
      const savedExpiry = localStorage.getItem("shiphero_token_expires_at")
      
      if (savedRefreshToken) {
        setRefreshTokenInput(savedRefreshToken)
      }
      
      if (savedExpiry) {
        setTokenExpiresAt(new Date(savedExpiry))
      }
      
      if (savedToken) {
        setDeveloperToken(savedToken)
        // Auto-connect if we have a saved token and not already connected
        if (!isConnected) {
          handleAutoConnect(savedToken)
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  
  // Update countdown timer every minute
  useEffect(() => {
    if (!tokenExpiresAt) {
      setTokenCountdown("")
      return
    }
    
    const updateCountdown = () => {
      const now = new Date()
      const diff = tokenExpiresAt.getTime() - now.getTime()
      
      if (diff <= 0) {
        setTokenCountdown("Token expired!")
        return
      }
      
      const days = Math.floor(diff / (1000 * 60 * 60 * 24))
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
      
      if (days > 0) {
        setTokenCountdown(`${days}d ${hours}h until expiry`)
      } else {
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
        setTokenCountdown(`${hours}h ${minutes}m until expiry`)
      }
    }
    
    updateCountdown()
    const interval = setInterval(updateCountdown, 60000) // Update every minute
    
    return () => clearInterval(interval)
  }, [tokenExpiresAt])
  
  // Auto-connect function
  const handleAutoConnect = async (token: string) => {
    setConnectionStatus("connecting")
    setStatusMessage("Auto-connecting with saved token...")
    
    try {
      const result = await authenticateWithToken(token)
      
      if (result.success) {
        setConnectionStatus("success")
        setStatusMessage("Connected!")
        onConnectionChange(true, result.message)
        
        // Sync warehouses
        const warehouseResult = await syncWarehouses()
        if (warehouseResult.success) {
          setStatusMessage(`Connected! ${warehouseResult.message}`)
          const warehouses = await getWarehouses()
          setAvailableWarehouses(warehouses)
        }
      } else {
        setConnectionStatus("error")
        setStatusMessage("Saved token expired. Please re-enter.")
        // Clear invalid token
        localStorage.removeItem("shiphero_developer_token")
        setDeveloperToken("")
      }
    } catch (error) {
      setConnectionStatus("error")
      setStatusMessage("Auto-connect failed")
    }
  }
  
  // Handle refresh token submission
  const handleRefreshToken = async () => {
    if (!refreshTokenInput.trim()) {
      setStatusMessage("Please enter your refresh token")
      return
    }
    
    setIsRefreshing(true)
    setStatusMessage("Refreshing token...")
    
    try {
      const result = await refreshTokenDirect(refreshTokenInput.trim())
      
      if (result.success) {
        // Save refresh token to localStorage
        localStorage.setItem("shiphero_refresh_token", refreshTokenInput.trim())
        
        // Set expiry to 27 days from now (ShipHero tokens last ~28 days)
        const expiryDate = result.expires_at 
          ? new Date(result.expires_at)
          : new Date(Date.now() + 27 * 24 * 60 * 60 * 1000)
        
        setTokenExpiresAt(expiryDate)
        localStorage.setItem("shiphero_token_expires_at", expiryDate.toISOString())
        
        setConnectionStatus("success")
        setStatusMessage("Token refreshed successfully!")
        onConnectionChange(true, "Token refreshed")
        
        // Sync warehouses after refresh
        const warehouseResult = await syncWarehouses()
        if (warehouseResult.success) {
          const warehouses = await getWarehouses()
          setAvailableWarehouses(warehouses)
        }
      } else {
        setConnectionStatus("error")
        setStatusMessage(result.message || "Failed to refresh token")
      }
    } catch (error) {
      setConnectionStatus("error")
      setStatusMessage("Failed to refresh token")
    } finally {
      setIsRefreshing(false)
    }
  }
  
  // Sync settings state
  const [syncIntervalHours, setSyncIntervalHours] = useState(6)
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isCheckingStatus, setIsCheckingStatus] = useState(false)
  const [syncMessage, setSyncMessage] = useState("")
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [recentJobs, setRecentJobs] = useState<SyncJob[]>([])
  const [savingSettings, setSavingSettings] = useState(false)
  const [snapshotStatus, setSnapshotStatus] = useState<string | null>(null)
  const [availableWarehouses, setAvailableWarehouses] = useState<ApiWarehouse[]>([])
  const [selectedSyncWarehouse, setSelectedSyncWarehouse] = useState<number | "all">("all")
  const [isSyncingProducts, setIsSyncingProducts] = useState(false)
  const [productSyncMessage, setProductSyncMessage] = useState("")
  const [showCSVUpload, setShowCSVUpload] = useState(false)
  
  // App settings
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [hapticEnabled, setHapticEnabled] = useState(true)
  const [autoPrintEnabled, setAutoPrintEnabled] = useState(false)
  
  // Auto-polling for pending jobs
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const [isAutoPolling, setIsAutoPolling] = useState(false)
  const [lastPollTime, setLastPollTime] = useState<Date | null>(null)
  const [pollCountdown, setPollCountdown] = useState(30)
  
  // Label settings
  const [defaultLabelSize, setDefaultLabelSize] = useState("4x2")
  const [showLabelBorder, setShowLabelBorder] = useState(true)
  
  const LABEL_SIZE_OPTIONS = [
    { value: "4x6", label: '4" × 6"', description: "Shipping label" },
    { value: "4x2", label: '4" × 2"', description: "Product label" },
    { value: "2x1", label: '2" × 1"', description: "Small label" },
    { value: "3x2", label: '3" × 2"', description: "Medium label" },
    { value: "2.25x1.25", label: '2.25" × 1.25"', description: "Dymo compatible" },
  ]

  // Load sync settings, warehouses, and check for stored credentials on mount
  useEffect(() => {
    async function loadSettings() {
      // Load sync settings
      const settings = await getSyncSettings()
      if (settings) {
        setSyncIntervalHours(settings.sync_interval_hours)
        setAutoSyncEnabled(settings.auto_sync_enabled)
        setLastSyncAt(settings.last_sync_at)
      }
      const jobs = await getRecentSyncJobs(10)
      setRecentJobs(jobs)
      
      // Load available warehouses for sync selection
      const warehouses = await getWarehouses()
      setAvailableWarehouses(warehouses)
      
      // Load label settings from localStorage
      const savedLabelSize = localStorage.getItem("default_label_size")
      if (savedLabelSize) {
        setDefaultLabelSize(savedLabelSize)
      }
      const savedShowBorder = localStorage.getItem("show_label_border")
      if (savedShowBorder !== null) {
        setShowLabelBorder(savedShowBorder === "true")
      }

      // Check for stored credentials in Supabase
      try {
        const stored = await getStoredCredentials()
        if (stored.has_credentials && stored.access_token) {
          console.log("Found stored credentials, expires_at:", stored.expires_at)
          
          // Set the token display
          setDeveloperToken(stored.access_token.substring(0, 20) + "...")
          
          if (stored.refresh_token) {
            setRefreshTokenInput(stored.refresh_token)
          }
          
          if (stored.expires_at) {
            const expiresDate = new Date(stored.expires_at)
            setTokenExpiresAt(expiresDate)
            
            // If not expired, auto-connect
            if (!stored.is_expired) {
              setConnectionStatus("success")
              onConnectionChange(true, "Connected with saved credentials")
            } else if (stored.refresh_token) {
              // Token expired but we have refresh token - try to refresh
              setConnectionStatus("connecting")
              const refreshResult = await refreshTokenDirect(stored.refresh_token)
              if (refreshResult.success) {
                setConnectionStatus("success")
                onConnectionChange(true, "Token refreshed automatically")
                if (refreshResult.expires_at) {
                  setTokenExpiresAt(new Date(refreshResult.expires_at))
                }
              } else {
              setConnectionStatus("idle")
              setStatusMessage("Saved token expired - please reconnect")
            }
          } else {
            setConnectionStatus("idle")
            setStatusMessage("Saved token expired - please reconnect")
            }
          } else {
            // No expiry info but has token - try to use it
            setConnectionStatus("success")
            onConnectionChange(true, "Connected with saved credentials")
          }
        }
      } catch (error) {
        console.error("Error loading stored credentials:", error)
      }
    }
    loadSettings()
  }, [onConnectionChange])

  // Auto-polling for pending/processing jobs
  const performStatusCheck = useCallback(async () => {
    if (!isConnected) return
    
    try {
      const result = await checkSnapshotStatus()
      
      if (result.success) {
        const { completed = 0, still_processing = 0, failed = 0 } = result as { completed?: number; still_processing?: number; failed?: number }
        
        if (completed > 0) {
          setSyncMessage(`✅ ${completed} snapshot(s) completed!`)
          setSnapshotStatus("completed")
        } else if (still_processing > 0) {
          setSyncMessage(`⏳ ${still_processing} still processing...`)
          setSnapshotStatus("processing")
        } else if (failed > 0) {
          setSyncMessage(`❌ ${failed} failed`)
          setSnapshotStatus("failed")
        } else {
          setSnapshotStatus(null)
        }
      }
      
      // Refresh jobs list
      const jobs = await getRecentSyncJobs(10)
      setRecentJobs(jobs)
      setLastPollTime(new Date())
    } catch (error) {
      console.error("Auto-poll error:", error)
    }
  }, [isConnected])

  // Check if there are pending/processing jobs
  const hasPendingJobs = recentJobs.some(job => 
    job.status === "pending" || job.status === "processing"
  )

  // Auto-polling effect
  useEffect(() => {
    // Only poll if connected and have pending jobs
    if (!isConnected || !hasPendingJobs) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      setIsAutoPolling(false)
      return
    }

    setIsAutoPolling(true)
    setPollCountdown(30)

    // Countdown timer (every second)
    const countdownInterval = setInterval(() => {
      setPollCountdown(prev => {
        if (prev <= 1) {
          return 30 // Reset after reaching 0
        }
        return prev - 1
      })
    }, 1000)

    // Actual polling (every 30 seconds)
    pollIntervalRef.current = setInterval(() => {
      performStatusCheck()
      setPollCountdown(30)
    }, 30000)

    return () => {
      clearInterval(countdownInterval)
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [isConnected, hasPendingJobs, performStatusCheck])

  // Helper to calculate elapsed time since job started
  const getElapsedTime = (createdAt: string): { text: string; isStale: boolean } => {
    const created = new Date(createdAt)
    const now = new Date()
    const diffMs = now.getTime() - created.getTime()
    
    const seconds = Math.floor(diffMs / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    
    // Jobs older than 2 hours are considered stale
    const isStale = hours >= 2
    
    let text: string
    if (hours > 0) {
      text = `${hours}h ${minutes % 60}m`
    } else if (minutes > 0) {
      text = `${minutes}m ${seconds % 60}s`
    } else {
      text = `${seconds}s`
    }
    
    return { text, isStale }
  }

  const handleSaveCredentials = async () => {
    setConnectionStatus("connecting")
    setStatusMessage("Connecting to ShipHero...")

    try {
      let result

      if (authType === "developer") {
        if (!developerToken.trim()) {
          setConnectionStatus("error")
          setStatusMessage("Please enter your developer token")
          return
        }
        result = await authenticateWithToken(developerToken.trim())
      } else {
        if (!username.trim() || !password.trim()) {
          setConnectionStatus("error")
          setStatusMessage("Please enter username and password")
          return
        }
        result = await authenticateWithCredentials(username.trim(), password)
      }

      if (result.success) {
        setConnectionStatus("success")
        setStatusMessage(result.message)
        onConnectionChange(true, result.message)
        
        // Save token to localStorage for persistence
        if (authType === "developer" && developerToken.trim()) {
          localStorage.setItem("shiphero_developer_token", developerToken.trim())
        }
        
        if (authType === "user") {
          setPassword("")
        }

        setStatusMessage("Syncing warehouses from ShipHero...")
        const warehouseResult = await syncWarehouses()
        if (warehouseResult.success) {
          setStatusMessage(`Connected! ${warehouseResult.message}`)
          // Refresh warehouse list
          const warehouses = await getWarehouses()
          setAvailableWarehouses(warehouses)
        } else {
          setStatusMessage(`Connected, but warehouse sync failed: ${warehouseResult.message}`)
        }
      } else {
        setConnectionStatus("error")
        setStatusMessage(result.message || "Authentication failed")
        onConnectionChange(false, result.message)
      }
    } catch (error) {
      setConnectionStatus("error")
      const errorMessage = error instanceof Error ? error.message : "Connection failed"
      setStatusMessage(errorMessage)
      onConnectionChange(false, errorMessage)
    }
  }

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case "connecting":
        return <Loader2 className="w-4 h-4 animate-spin" />
      case "success":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />
      case "error":
        return <XCircle className="w-4 h-4 text-red-500" />
      default:
        return null
    }
  }

  const handleSyncNow = async () => {
    setIsSyncing(true)
    const warehouseName = selectedSyncWarehouse === "all" 
      ? "all warehouses" 
      : availableWarehouses.find(w => w.shiphero_id_plain === selectedSyncWarehouse)?.name || `warehouse ${selectedSyncWarehouse}`
    setSyncMessage(`Triggering sync for ${warehouseName}...`)
    setSnapshotStatus("pending")
    
    try {
      const warehouseId = selectedSyncWarehouse === "all" ? undefined : selectedSyncWarehouse
      const result = await triggerInventorySnapshot(warehouseId)
      
      if (result.success) {
        setSyncMessage(result.message || `Sync triggered! Check status to see progress.`)
        const jobs = await getRecentSyncJobs(10)
        setRecentJobs(jobs)
        setLastSyncAt(new Date().toISOString())
      } else {
        setSyncMessage(result.error || "Failed to trigger sync")
        setSnapshotStatus(null)
      }
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Sync failed")
      setSnapshotStatus(null)
    } finally {
      setIsSyncing(false)
    }
  }

  const handleCheckStatus = async () => {
    setIsCheckingStatus(true)
    setSyncMessage("Checking snapshots...")
    
    try {
      const result = await checkSnapshotStatus()
      
      if (result.success) {
        const { completed = 0, still_processing = 0, failed = 0 } = result as { completed?: number; still_processing?: number; failed?: number }
        
        if (completed > 0) {
          setSyncMessage(`✅ ${completed} snapshot(s) ready - importing!`)
          setSnapshotStatus("processing")
        } else if (still_processing > 0) {
          setSyncMessage(`⏳ ${still_processing} still processing...`)
          setSnapshotStatus("pending")
        } else if (failed > 0) {
          setSyncMessage(`❌ ${failed} failed`)
          setSnapshotStatus("failed")
        } else {
          setSyncMessage(result.message || "No pending snapshots")
          setSnapshotStatus(null)
        }
        
        const jobs = await getRecentSyncJobs(10)
        setRecentJobs(jobs)
      } else {
        setSyncMessage(result.message || result.error || "Check failed")
      }
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Check failed")
    } finally {
      setIsCheckingStatus(false)
    }
  }

  const handleSyncProducts = async () => {
    setIsSyncingProducts(true)
    setProductSyncMessage("Syncing product names...")
    
    try {
      const result = await syncProducts(true)
      setProductSyncMessage(result.success ? `✅ ${result.message}` : `❌ ${result.message}`)
    } catch (error) {
      setProductSyncMessage(`❌ ${error instanceof Error ? error.message : "Sync failed"}`)
    } finally {
      setIsSyncingProducts(false)
    }
  }

  const handleCancelPending = async () => {
    setSyncMessage("Cancelling...")
    try {
      const result = await cancelPendingSyncJobs()
      setSyncMessage(result.message)
      setSnapshotStatus(null)
      const jobs = await getRecentSyncJobs(5)
      setRecentJobs(jobs)
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Cancel failed")
    }
  }

  const handleSaveSyncSettings = async () => {
    setSavingSettings(true)
    try {
      const result = await updateSyncSettings(syncIntervalHours, autoSyncEnabled)
      setSyncMessage(result.success ? "Settings saved!" : (result.error || "Failed"))
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Failed")
    } finally {
      setSavingSettings(false)
      setTimeout(() => setSyncMessage(""), 3000)
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never"
    return new Date(dateStr).toLocaleString()
  }

  // Menu items for clean navigation
  const menuItems = [
    { id: "connection" as const, icon: Wifi, label: "Connection", description: "ShipHero API & Auth" },
    { id: "sync" as const, icon: RefreshCw, label: "Inventory Sync", description: "Sync settings & jobs" },
    { id: "printer" as const, icon: Printer, label: "Printing", description: "Label & printer settings" },
    { id: "app" as const, icon: Settings, label: "App Settings", description: "Preferences & about" },
  ]

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Tab Navigation - Clean horizontal pills */}
      <div className="px-4 py-3 bg-card border-b border-border">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === item.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto p-4 pb-24">
        {/* CONNECTION TAB */}
        {activeTab === "connection" && (
          <div className="space-y-4">
            {/* Status Card */}
            <Card className="bg-card border-border">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
                    <div>
                      <p className="font-semibold text-foreground">{isConnected ? "Connected" : "Disconnected"}</p>
                      <p className="text-xs text-muted-foreground">ShipHero API</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Database className="w-3.5 h-3.5" />
                    <span>Supabase OK</span>
                  </div>
                </div>
                
                {isConnected && (
                  <Button
                    onClick={async () => {
                      setStatusMessage("Syncing warehouses...")
                      const result = await syncWarehouses()
                      setStatusMessage(result.success ? result.message : `Failed: ${result.message}`)
                      if (result.success) {
                        const warehouses = await getWarehouses()
                        setAvailableWarehouses(warehouses)
                        if (onWarehouseSync) await onWarehouseSync()
                      }
                      setTimeout(() => setStatusMessage(""), 3000)
                    }}
                    variant="outline"
                    size="sm"
                    className="w-full"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Refresh Warehouses ({availableWarehouses.length})
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Auth Card */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Key className="w-4 h-4 text-primary" />
                  Authentication
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Tabs value={authType} onValueChange={(v) => setAuthType(v as "user" | "developer")} className="w-full">
                  <TabsList className="w-full bg-secondary h-10">
                    <TabsTrigger value="user" className="flex-1 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                      <User className="w-3.5 h-3.5 mr-1.5" />
                      User Login
                    </TabsTrigger>
                    <TabsTrigger value="developer" className="flex-1 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                      <Key className="w-3.5 h-3.5 mr-1.5" />
                      Developer Token
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="user" className="mt-4 space-y-3">
                    <Input
                      type="text"
                      placeholder="Username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="h-11 bg-secondary"
                      disabled={connectionStatus === "connecting"}
                    />
                    <Input
                      type="password"
                      placeholder="Password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-11 bg-secondary"
                      disabled={connectionStatus === "connecting"}
                    />
                  </TabsContent>

                  <TabsContent value="developer" className="mt-4 space-y-3">
                    <Input
                      type="password"
                      placeholder="Developer Access Token"
                      value={developerToken}
                      onChange={(e) => setDeveloperToken(e.target.value)}
                      className="h-11 bg-secondary"
                      disabled={connectionStatus === "connecting"}
                    />
                    <p className="text-xs text-muted-foreground">
                      ShipHero Settings → Developer API
                    </p>
                    
                    {/* Refresh Token Section */}
                    <div className="pt-4 border-t border-border mt-4">
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-sm font-medium flex items-center gap-2">
                          <RefreshCw className="w-4 h-4" />
                          Refresh Token
                        </Label>
                        {tokenCountdown && (
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            tokenCountdown.includes("expired") 
                              ? "bg-red-500/10 text-red-500" 
                              : tokenCountdown.includes("d") && parseInt(tokenCountdown) <= 3
                                ? "bg-yellow-500/10 text-yellow-500"
                                : "bg-green-500/10 text-green-500"
                          }`}>
                            <Clock className="w-3 h-3 inline mr-1" />
                            {tokenCountdown}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Input
                          type="password"
                          placeholder="Paste your refresh token here"
                          value={refreshTokenInput}
                          onChange={(e) => setRefreshTokenInput(e.target.value)}
                          className="h-10 bg-secondary flex-1"
                          disabled={isRefreshing}
                        />
                        <Button
                          onClick={handleRefreshToken}
                          disabled={isRefreshing || !refreshTokenInput.trim()}
                          size="sm"
                          variant="outline"
                          className="h-10 px-4"
                        >
                          {isRefreshing ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <><RefreshCw className="w-4 h-4 mr-1" />Refresh</>
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Use this to get a new access token. Tokens expire after ~28 days.
                      </p>
                    </div>
                  </TabsContent>
                </Tabs>

                {statusMessage && (
                  <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                    connectionStatus === "success" ? "bg-green-500/10 text-green-500" : 
                    connectionStatus === "error" ? "bg-red-500/10 text-red-500" : "bg-muted text-muted-foreground"
                  }`}>
                    {getStatusIcon()}
                    <span className="text-xs">{statusMessage}</span>
                  </div>
                )}

                <Button
                  onClick={handleSaveCredentials}
                  disabled={connectionStatus === "connecting"}
                  className="w-full h-11"
                >
                  {connectionStatus === "connecting" ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Connecting...</>
                  ) : isConnected ? "Reconnect" : "Connect to ShipHero"}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* SYNC TAB */}
        {activeTab === "sync" && (
          <div className="space-y-4">
            {/* Quick Actions */}
            <Card className="bg-card border-border">
              <CardContent className="pt-4 space-y-3">
                <div className="flex gap-2">
                  <Button
                    onClick={handleSyncNow}
                    disabled={!isConnected || isSyncing}
                    className="flex-1 h-12"
                  >
                    {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                    {isSyncing ? "Syncing..." : "Sync Now"}
                  </Button>
                  <Button
                    onClick={handleCheckStatus}
                    disabled={!isConnected || isCheckingStatus}
                    variant="outline"
                    className="flex-1 h-12"
                  >
                    {isCheckingStatus ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4 mr-2" />}
                    Check Status
                  </Button>
                </div>

                {syncMessage && (
                  <div className={`p-3 rounded-lg text-sm ${
                    syncMessage.includes("❌") || syncMessage.includes("failed") 
                      ? "bg-red-500/10 text-red-500" 
                      : "bg-green-500/10 text-green-500"
                  }`}>
                    {syncMessage}
                  </div>
                )}

                {isConnected && (
                  <Button onClick={handleCancelPending} variant="ghost" size="sm" className="w-full text-muted-foreground">
                    Cancel Pending Snapshots
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Sync Configuration */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Settings className="w-4 h-4 text-primary" />
                  Sync Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    Auto-sync
                  </Label>
                  <Switch 
                    checked={autoSyncEnabled} 
                    onCheckedChange={setAutoSyncEnabled} 
                    aria-disabled={!isConnected}
                    className={!isConnected ? "opacity-50 pointer-events-none" : ""}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">Interval</Label>
                  <select
                    value={syncIntervalHours}
                    onChange={(e) => setSyncIntervalHours(Number(e.target.value))}
                    disabled={!isConnected || !autoSyncEnabled}
                    className="w-full h-10 px-3 rounded-md border border-border bg-secondary text-sm disabled:opacity-50"
                  >
                    {SYNC_INTERVAL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">Target Warehouse</Label>
                  <select
                    value={selectedSyncWarehouse}
                    onChange={(e) => setSelectedSyncWarehouse(e.target.value === "all" ? "all" : Number(e.target.value))}
                    disabled={!isConnected}
                    className="w-full h-10 px-3 rounded-md border border-border bg-secondary text-sm disabled:opacity-50"
                  >
                    <option value="all">All Warehouses ({availableWarehouses.length})</option>
                    {availableWarehouses.map((wh) => (
                      <option key={wh.id} value={wh.shiphero_id_plain}>{wh.name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between text-sm py-2 border-t border-border">
                  <span className="text-muted-foreground">Last Sync</span>
                  <span className="font-medium">{formatDate(lastSyncAt)}</span>
                </div>

                <Button onClick={handleSaveSyncSettings} disabled={!isConnected || savingSettings} variant="outline" className="w-full">
                  {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Settings"}
                </Button>
              </CardContent>
            </Card>

            {/* Product Names */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Database className="w-4 h-4 text-primary" />
                  Product Data
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button onClick={() => setShowCSVUpload(true)} variant="outline" className="w-full h-11" disabled={!isConnected}>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Product CSV
                </Button>
                <Button onClick={handleSyncProducts} variant="ghost" size="sm" className="w-full" disabled={!isConnected || isSyncingProducts}>
                  {isSyncingProducts ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  Sync from ShipHero
                </Button>
                {productSyncMessage && (
                  <p className="text-xs text-center text-muted-foreground">{productSyncMessage}</p>
                )}
              </CardContent>
            </Card>

            {/* Live Sync Monitor */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Timer className="w-4 h-4 text-primary" />
                    Sync Jobs
                  </CardTitle>
                  {isAutoPolling && (
                    <div className="flex items-center gap-2">
                      <div className="relative flex items-center">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <span className="ml-2 text-xs text-muted-foreground">
                          Auto-checking in {pollCountdown}s
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {recentJobs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No sync jobs yet</p>
                    <p className="text-xs">Click "Sync Now" to start</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentJobs.slice(0, 10).map((job) => {
                      const whName = job.warehouse_id 
                        ? availableWarehouses.find(w => w.shiphero_id_plain === job.warehouse_id)?.name || `WH ${job.warehouse_id}`
                        : "All Warehouses";
                      const isPending = job.status === "pending" || job.status === "processing"
                      const isProcessing = job.status === "processing"
                      
                      return (
                        <div 
                          key={job.id} 
                          className={`rounded-lg border transition-all ${
                            isPending 
                              ? "border-yellow-500/30 bg-yellow-500/5" 
                              : job.status === "completed"
                                ? "border-green-500/30 bg-green-500/5"
                                : job.status === "failed"
                                  ? "border-red-500/30 bg-red-500/5"
                                  : "border-border bg-card"
                          }`}
                        >
                          <div className="p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                {isPending ? (
                                  <Loader2 className="w-4 h-4 text-yellow-500 animate-spin" />
                                ) : job.status === "completed" ? (
                                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                                ) : job.status === "failed" ? (
                                  <XCircle className="w-4 h-4 text-red-500" />
                                ) : (
                                  <AlertCircle className="w-4 h-4 text-gray-500" />
                                )}
                                <span className="text-sm font-medium text-foreground">{whName}</span>
                              </div>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                job.status === "completed" ? "bg-green-500/20 text-green-500" :
                                job.status === "failed" ? "bg-red-500/20 text-red-500" :
                                job.status === "cancelled" ? "bg-gray-500/20 text-gray-500" :
                                isPending ? "bg-yellow-500/20 text-yellow-500" :
                                "bg-muted text-muted-foreground"
                              }`}>
                                {job.status}
                              </span>
                            </div>
                            
                            {/* Progress bar for pending/processing jobs */}
                            {isPending && (
                              <div className="mb-2">
                                <div className="h-1.5 bg-yellow-500/20 rounded-full overflow-hidden">
                                  <div 
                                    className={`h-full bg-yellow-500 rounded-full ${
                                      isProcessing ? "animate-progress" : "animate-pulse"
                                    }`}
                                    style={{ 
                                      width: isProcessing ? "60%" : "30%",
                                      animation: isProcessing 
                                        ? "progress 2s ease-in-out infinite" 
                                        : undefined 
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                            
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>{new Date(job.created_at).toLocaleTimeString()}</span>
                              {isPending ? (
                                (() => {
                                  const elapsed = getElapsedTime(job.created_at)
                                  return (
                                    <span className={`flex items-center gap-1 ${elapsed.isStale ? "text-red-500 font-semibold" : "text-yellow-500"}`}>
                                      {elapsed.isStale ? <AlertCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                                      {elapsed.isStale ? `STALE (${elapsed.text})` : `${elapsed.text} elapsed`}
                                    </span>
                                  )
                                })()
                              ) : (
                                <span>{new Date(job.created_at).toLocaleDateString()}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                
                {/* Manual refresh button */}
                {recentJobs.length > 0 && (
                  <Button
                    onClick={async () => {
                      const jobs = await getRecentSyncJobs(10)
                      setRecentJobs(jobs)
                    }}
                    variant="ghost"
                    size="sm"
                    className="w-full mt-3 text-xs text-muted-foreground"
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Refresh List
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* PRINTER TAB */}
        {activeTab === "printer" && (
          <div className="space-y-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Printer className="w-4 h-4 text-primary" />
                  Printer Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium">Default Printer</p>
                    <p className="text-xs text-muted-foreground">System Default</p>
                  </div>
                  <Button variant="outline" size="sm">Change</Button>
                </div>
                
                <div className="flex items-center justify-between py-2 border-t border-border">
                  <div>
                    <p className="text-sm font-medium">Auto-print on scan</p>
                    <p className="text-xs text-muted-foreground">Print label when barcode scanned</p>
                  </div>
                  <Switch checked={autoPrintEnabled} onCheckedChange={setAutoPrintEnabled} />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Label Defaults</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium">Default Size</p>
                    <p className="text-xs text-muted-foreground">
                      {LABEL_SIZE_OPTIONS.find(o => o.value === defaultLabelSize)?.description || "Select size"}
                    </p>
                  </div>
                  <select
                    value={defaultLabelSize}
                    onChange={(e) => {
                      setDefaultLabelSize(e.target.value)
                      localStorage.setItem("default_label_size", e.target.value)
                    }}
                    className="h-9 px-3 rounded-md border border-input bg-background text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {LABEL_SIZE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-between py-2 border-t border-border">
                  <div>
                    <p className="text-sm font-medium">Show Border</p>
                    <p className="text-xs text-muted-foreground">Print border around label</p>
                  </div>
                  <Switch 
                    checked={showLabelBorder} 
                    onCheckedChange={(checked) => {
                      setShowLabelBorder(checked)
                      localStorage.setItem("show_label_border", String(checked))
                    }} 
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* APP TAB */}
        {activeTab === "app" && (
          <div className="space-y-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-primary" />
                  Preferences
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <Volume2 className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Sound Effects</p>
                      <p className="text-xs text-muted-foreground">Beep on scan</p>
                    </div>
                  </div>
                  <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
                </div>
                
                <div className="flex items-center justify-between py-2 border-t border-border">
                  <div className="flex items-center gap-3">
                    <Smartphone className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Haptic Feedback</p>
                      <p className="text-xs text-muted-foreground">Vibrate on scan</p>
                    </div>
                  </div>
                  <Switch checked={hapticEnabled} onCheckedChange={setHapticEnabled} />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Info className="w-4 h-4 text-primary" />
                  About
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">Version</span>
                  <span className="text-sm font-mono">1.0.0</span>
                </div>
                <div className="flex items-center justify-between py-2 border-t border-border">
                  <span className="text-sm text-muted-foreground">Backend</span>
                  <span className="text-sm font-mono">Supabase</span>
                </div>
                <div className="flex items-center justify-between py-2 border-t border-border">
                  <span className="text-sm text-muted-foreground">API</span>
                  <span className="text-sm font-mono">ShipHero GraphQL</span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* CSV Upload Modal */}
      <CSVUpload
        isOpen={showCSVUpload}
        onClose={() => setShowCSVUpload(false)}
        onSuccess={(count) => {
          setProductSyncMessage(`✅ Imported ${count} products`)
          setShowCSVUpload(false)
        }}
      />
    </div>
  )
}
