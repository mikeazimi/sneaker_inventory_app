"use client"

import { Wifi, WifiOff } from "lucide-react"

interface HeaderProps {
  isConnected: boolean
}

export function Header({ isConnected }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-4 py-3 bg-card border-b border-border">
      <h1 className="text-xl font-bold tracking-tight text-foreground">Warehouse Sync</h1>
      <div className="flex items-center gap-2">
        {isConnected ? <Wifi className="w-5 h-5 text-success" /> : <WifiOff className="w-5 h-5 text-destructive" />}
        <div className="flex items-center gap-1.5">
          <div
            className={`w-3 h-3 rounded-full ${isConnected ? "bg-success animate-pulse" : "bg-destructive"}`}
            aria-label={isConnected ? "Connected" : "Disconnected"}
          />
          <span className="text-sm font-medium text-muted-foreground">{isConnected ? "Online" : "Offline"}</span>
        </div>
      </div>
    </header>
  )
}
