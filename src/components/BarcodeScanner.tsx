"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Scanner, IDetectedBarcode } from "@yudiel/react-qr-scanner";

// =============================================================================
// TYPES
// =============================================================================

interface BarcodeScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  title?: string;
}

type CameraState = "loading" | "ready" | "denied" | "not-found" | "error";

// =============================================================================
// CONSTANTS
// =============================================================================

// Supported 1D barcode formats for inventory scanning
const SUPPORTED_FORMATS: BarcodeFormat[] = [
  "code_128",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
];

// Beep sound as base64 data URI (short, clean beep)
const BEEP_SOUND_URI =
  "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleREFPZ7U5IlOCg8sktbniF4NERpBj9LskFoFBytWj9frlWwNDhtAlNbomHgRESFGl9jlmXgPDx9Dktfnm3wRERxFktjnmoAQEB1Gk9jom4ERDxxGlNnomIEQDx1FldnpmYIREBxGldnpm4MQER1Gl9rqm4MQDxxHl9rqm4QQDx5HmNrqnIQQEB5ImNvrnYQREBxHmNvrnIQQEB1ImNrqnYQQEB1ImdrrnYQREBxJmdrrnYQQDx5ImtvrnYQQEB1Jm9vrnYQQEBxJm9vrnYUREB1JnNvrnYUQEB1Jndzsn4UREB1Kndztn4UQEBxKnt3tn4YQDx9Knt3tn4YQEB5Kn97tn4YQEB1Kn97toIYQEB1Ln97toIYREB1LoN/uoYYQEB5LoN/uoYcQEB5MoN/uoYcQEB5Mod/voYcREB5Mod/voYcQEB5Mot/vocgREB5Not7vocgREB9Not/vosgQEB9Oo9/vo8gQEB9OpODvpMgQEB9OpODwpMkREB9OpeDwpMkQEB9PpeDwpckREB9PpuHwpckQEB9PpuHwpsoQEB9Pp+Hxp8oQECBPp+HxqMoREB9Qp+LxqMsQECBQqOLxqcsQECBQqOLyqcsRECBQqeLyqcwQECBRqeLyqswQECBRquPyq8wREB9RquPyq80RECBRq+Pzq80RECBRq+TzrM0RECBSrOTzrM4RECBSrOTzrc4RECBSreTzrc4RECBSreT0rs8RECBTIOX0rs8RECBTIOX0r9A=";

// =============================================================================
// COMPONENT
// =============================================================================

export default function BarcodeScanner({
  isOpen,
  onClose,
  onDetected,
  title = "Scan Barcode",
}: BarcodeScannerProps) {
  const [cameraState, setCameraState] = useState<CameraState>("loading");
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scanCooldownRef = useRef<boolean>(false);

  // Initialize audio element
  useEffect(() => {
    if (typeof window !== "undefined") {
      audioRef.current = new Audio(BEEP_SOUND_URI);
      audioRef.current.volume = 0.5;
    }
  }, []);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setCameraState("loading");
      setLastScannedCode(null);
      scanCooldownRef.current = false;
      
      // Auto-switch to ready state after 2 seconds
      const fallbackTimer = setTimeout(() => {
        setCameraState((current) => current === "loading" ? "ready" : current);
      }, 2000);
      
      return () => clearTimeout(fallbackTimer);
    }
  }, [isOpen]);

  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  /**
   * Play feedback sounds and vibration
   */
  const playFeedback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(200);
    }
  }, []);

  /**
   * Handle successful barcode scan
   */
  const handleScan = useCallback(
    (detectedCodes: IDetectedBarcode[]) => {
      if (scanCooldownRef.current || detectedCodes.length === 0) {
        return;
      }

      const code = detectedCodes[0];
      const rawValue = code.rawValue;

      if (rawValue === lastScannedCode) {
        return;
      }

      scanCooldownRef.current = true;
      setTimeout(() => {
        scanCooldownRef.current = false;
      }, 1500);

      setLastScannedCode(rawValue);
      playFeedback();
      onDetected(rawValue);
    },
    [lastScannedCode, onDetected, playFeedback]
  );

  /**
   * Handle camera errors
   */
  const handleError = useCallback((error: unknown) => {
    console.error("Scanner error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("Permission denied") || errorMessage.includes("NotAllowedError")) {
      setCameraState("denied");
    } else if (errorMessage.includes("NotFoundError") || errorMessage.includes("no camera")) {
      setCameraState("not-found");
    } else {
      setCameraState("error");
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/90 backdrop-blur-sm" 
        onClick={onClose} 
      />

      {/* Modal Content */}
      <div className="relative w-full h-full md:w-[90vw] md:h-[85vh] md:max-w-[800px] md:max-h-[700px] md:rounded-2xl md:overflow-hidden flex flex-col bg-[#0a0a0b] md:shadow-2xl">
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-4 bg-gradient-to-b from-[#141416] to-[#0a0a0b] border-b border-white/[0.08]">
          <h2 className="text-lg font-semibold text-zinc-50 tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/[0.06] text-zinc-400 hover:bg-white/10 hover:text-zinc-50 transition-all"
            aria-label="Close scanner"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        {/* Scanner Area */}
        <div className="relative flex-1 overflow-hidden bg-black">
          {cameraState === "denied" && (
            <PermissionDeniedUI onRetry={() => setCameraState("loading")} />
          )}

          {cameraState === "not-found" && <CameraNotFoundUI />}

          {cameraState === "error" && (
            <GenericErrorUI onRetry={() => setCameraState("loading")} />
          )}

          {(cameraState === "loading" || cameraState === "ready") && (
            <>
              <Scanner
                onScan={handleScan}
                onError={handleError}
                formats={SUPPORTED_FORMATS}
                allowMultiple={false}
                scanDelay={500}
                components={{
                  torch: true,
                  finder: false,
                }}
                styles={{
                  container: { width: "100%", height: "100%" },
                  video: { objectFit: "cover" as const },
                }}
              />

              {/* Custom scanning overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="relative w-[280px] h-[160px] max-w-[80%]">
                  {/* Corners */}
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-[3px] border-l-[3px] border-green-500 rounded-tl-lg" />
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-[3px] border-r-[3px] border-green-500 rounded-tr-lg" />
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-[3px] border-l-[3px] border-green-500 rounded-bl-lg" />
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-[3px] border-r-[3px] border-green-500 rounded-br-lg" />
                  {/* Scanning line */}
                  <div 
                    className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-green-500 to-transparent animate-pulse"
                    style={{ 
                      boxShadow: "0 0 12px rgba(34, 197, 94, 0.6)",
                      animation: "scanLine 2s ease-in-out infinite"
                    }} 
                  />
                </div>
              </div>

              {/* Loading indicator */}
              {cameraState === "loading" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70 text-zinc-400 text-sm">
                  <div className="w-10 h-10 border-[3px] border-white/10 border-t-green-500 rounded-full animate-spin" />
                  <p>Starting camera...</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer with last scanned code */}
        <footer className="px-5 py-4 bg-gradient-to-t from-[#141416] to-[#0a0a0b] border-t border-white/[0.08] min-h-[72px] flex items-center justify-center">
          {lastScannedCode ? (
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-xs text-zinc-500 uppercase tracking-wide">Last scanned:</span>
              <code className="font-mono text-base font-medium text-green-500 bg-green-500/10 px-4 py-2 rounded-lg border border-green-500/20">
                {lastScannedCode}
              </code>
            </div>
          ) : (
            <p className="text-sm text-zinc-500 text-center">
              Position barcode within the frame to scan
            </p>
          )}
        </footer>
      </div>
    </div>
  );
}

// =============================================================================
// ERROR STATE COMPONENTS
// =============================================================================

function PermissionDeniedUI({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-gradient-to-b from-[#0f0f10] to-[#0a0a0b] text-center">
      <div className="flex items-center justify-center w-20 h-20 rounded-2xl mb-6 bg-gradient-to-br from-orange-900 to-orange-950 text-orange-400">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
          <line x1="12" y1="2" x2="12" y2="12" />
        </svg>
      </div>
      <h3 className="text-xl font-semibold text-zinc-50 mb-3">Camera Access Required</h3>
      <p className="text-sm text-zinc-400 max-w-[300px] mb-6 leading-relaxed">
        To scan barcodes, please allow camera access in your browser settings.
      </p>
      <div className="flex flex-col gap-3 mb-7 w-full max-w-[320px]">
        {["Click the camera icon in your browser's address bar", 'Select "Allow" for camera permissions', "Refresh the page and try again"].map((step, i) => (
          <p key={i} className="flex items-center gap-3 text-[13px] text-zinc-300 text-left">
            <span className="flex items-center justify-center w-6 h-6 bg-orange-500/15 text-orange-400 rounded-md text-xs font-semibold flex-shrink-0">
              {i + 1}
            </span>
            {step}
          </p>
        ))}
      </div>
      <button 
        onClick={onRetry} 
        className="px-8 py-3 text-sm font-medium text-zinc-50 bg-gradient-to-br from-orange-600 to-orange-700 rounded-lg hover:-translate-y-0.5 hover:shadow-lg hover:shadow-orange-600/30 transition-all"
      >
        Try Again
      </button>
    </div>
  );
}

function CameraNotFoundUI() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-gradient-to-b from-[#0f0f10] to-[#0a0a0b] text-center">
      <div className="flex items-center justify-center w-20 h-20 rounded-2xl mb-6 bg-gradient-to-br from-blue-900 to-blue-950 text-blue-400">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      </div>
      <h3 className="text-xl font-semibold text-zinc-50 mb-3">No Camera Found</h3>
      <p className="text-sm text-zinc-400 max-w-[300px] leading-relaxed">
        We couldn&apos;t detect a camera on your device. Please connect a camera or try on a different device.
      </p>
    </div>
  );
}

function GenericErrorUI({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-gradient-to-b from-[#0f0f10] to-[#0a0a0b] text-center">
      <div className="flex items-center justify-center w-20 h-20 rounded-2xl mb-6 bg-gradient-to-br from-purple-900 to-purple-950 text-purple-400">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h3 className="text-xl font-semibold text-zinc-50 mb-3">Something Went Wrong</h3>
      <p className="text-sm text-zinc-400 max-w-[300px] mb-6 leading-relaxed">
        We encountered an error while starting the camera. Please try again.
      </p>
      <button 
        onClick={onRetry} 
        className="px-8 py-3 text-sm font-medium text-zinc-50 bg-gradient-to-br from-purple-600 to-purple-700 rounded-lg hover:-translate-y-0.5 hover:shadow-lg hover:shadow-purple-600/30 transition-all"
      >
        Try Again
      </button>
    </div>
  );
}
