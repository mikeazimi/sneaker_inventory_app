"use client"

import { Package, Settings } from "lucide-react"

export type TabType = "inventory" | "settings"

interface BottomNavProps {
  activeTab: TabType
  onTabChange: (tab: TabType) => void
}

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  const tabs = [
    { id: "inventory" as const, label: "Inventory", icon: Package },
    { id: "settings" as const, label: "Settings", icon: Settings },
  ]

  return (
    <nav className="bg-card border-t border-border safe-area-inset-bottom">
      <div className="flex items-center justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center gap-1 py-3 px-6 flex-1 transition-colors ${
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className={`w-6 h-6 ${isActive ? "stroke-[2.5]" : ""}`} />
              <span className={`text-xs font-medium ${isActive ? "font-bold" : ""}`}>{tab.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
