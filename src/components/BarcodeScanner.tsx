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
      
      // Fallback: Force ready state after 2 seconds if camera doesn't fire onReady
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
    // Play beep sound
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {
        // Audio play failed (user interaction required or blocked)
      });
    }

    // Vibrate device (mobile only)
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(200);
    }
  }, []);

  /**
   * Handle successful barcode scan
   */
  const handleScan = useCallback(
    (detectedCodes: IDetectedBarcode[]) => {
      // Prevent duplicate scans within cooldown period
      if (scanCooldownRef.current || detectedCodes.length === 0) {
        return;
      }

      const code = detectedCodes[0];
      const rawValue = code.rawValue;

      // Skip if same code scanned recently
      if (rawValue === lastScannedCode) {
        return;
      }

      // Set cooldown to prevent rapid-fire scans
      scanCooldownRef.current = true;
      setTimeout(() => {
        scanCooldownRef.current = false;
      }, 1500);

      // Update state and provide feedback
      setLastScannedCode(rawValue);
      playFeedback();

      // Call parent callback
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

    if (
      errorMessage.includes("Permission denied") ||
      errorMessage.includes("NotAllowedError")
    ) {
      setCameraState("denied");
    } else if (
      errorMessage.includes("NotFoundError") ||
      errorMessage.includes("no camera")
    ) {
      setCameraState("not-found");
    } else {
      setCameraState("error");
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className="scanner-modal">
      {/* Backdrop */}
      <div className="scanner-backdrop" onClick={onClose} />

      {/* Modal Content */}
      <div className="scanner-container">
        {/* Header */}
        <header className="scanner-header">
          <h2 className="scanner-title">{title}</h2>
          <button
            onClick={onClose}
            className="scanner-close-btn"
            aria-label="Close scanner"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        {/* Scanner Area */}
        <div className="scanner-viewport">
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
                  container: {
                    width: "100%",
                    height: "100%",
                  },
                  video: {
                    objectFit: "cover",
                  },
                }}
                onReady={() => setCameraState("ready")}
              />

              {/* Custom scanning overlay */}
              <div className="scanner-overlay">
                <div className="scanner-frame">
                  <div className="scanner-corner scanner-corner-tl" />
                  <div className="scanner-corner scanner-corner-tr" />
                  <div className="scanner-corner scanner-corner-bl" />
                  <div className="scanner-corner scanner-corner-br" />
                  <div className="scanner-line" />
                </div>
              </div>

              {/* Loading indicator - auto-hides after 1.5s */}
              {cameraState === "loading" && (
                <div className="scanner-loading" style={{ animation: "fadeOut 0.3s ease 1.5s forwards" }}>
                  <div className="scanner-spinner" />
                  <p>Starting camera...</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer with last scanned code */}
        <footer className="scanner-footer">
          {lastScannedCode ? (
            <div className="scanner-result">
              <span className="scanner-result-label">Last scanned:</span>
              <code className="scanner-result-code">{lastScannedCode}</code>
            </div>
          ) : (
            <p className="scanner-hint">
              Position barcode within the frame to scan
            </p>
          )}
        </footer>
      </div>

      {/* Styles */}
      <style jsx>{`
        .scanner-modal {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .scanner-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.9);
          backdrop-filter: blur(8px);
        }

        .scanner-container {
          position: relative;
          width: 100%;
          height: 100%;
          max-width: 100vw;
          max-height: 100vh;
          display: flex;
          flex-direction: column;
          background: #0a0a0b;
        }

        @media (min-width: 768px) {
          .scanner-container {
            width: 90vw;
            height: 85vh;
            max-width: 800px;
            max-height: 700px;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 25px 80px rgba(0, 0, 0, 0.6);
          }
        }

        .scanner-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          background: linear-gradient(180deg, #141416 0%, #0a0a0b 100%);
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }

        .scanner-title {
          font-family: "SF Pro Display", -apple-system, BlinkMacSystemFont,
            sans-serif;
          font-size: 18px;
          font-weight: 600;
          color: #fafafa;
          letter-spacing: -0.02em;
          margin: 0;
        }

        .scanner-close-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border: none;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.06);
          color: #a1a1aa;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .scanner-close-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #fafafa;
        }

        .scanner-viewport {
          position: relative;
          flex: 1;
          overflow: hidden;
          background: #000;
        }

        .scanner-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
        }

        .scanner-frame {
          position: relative;
          width: 280px;
          height: 160px;
          max-width: 80%;
        }

        .scanner-corner {
          position: absolute;
          width: 24px;
          height: 24px;
          border-color: #22c55e;
          border-style: solid;
          border-width: 0;
        }

        .scanner-corner-tl {
          top: 0;
          left: 0;
          border-top-width: 3px;
          border-left-width: 3px;
          border-top-left-radius: 8px;
        }

        .scanner-corner-tr {
          top: 0;
          right: 0;
          border-top-width: 3px;
          border-right-width: 3px;
          border-top-right-radius: 8px;
        }

        .scanner-corner-bl {
          bottom: 0;
          left: 0;
          border-bottom-width: 3px;
          border-left-width: 3px;
          border-bottom-left-radius: 8px;
        }

        .scanner-corner-br {
          bottom: 0;
          right: 0;
          border-bottom-width: 3px;
          border-right-width: 3px;
          border-bottom-right-radius: 8px;
        }

        .scanner-line {
          position: absolute;
          left: 8px;
          right: 8px;
          height: 2px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            #22c55e 20%,
            #22c55e 80%,
            transparent 100%
          );
          box-shadow: 0 0 12px rgba(34, 197, 94, 0.6);
          animation: scan 2s ease-in-out infinite;
        }

        @keyframes scan {
          0%,
          100% {
            top: 8px;
            opacity: 0.8;
          }
          50% {
            top: calc(100% - 10px);
            opacity: 1;
          }
        }

        .scanner-loading {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          background: rgba(0, 0, 0, 0.7);
          color: #a1a1aa;
          font-size: 14px;
        }

        .scanner-spinner {
          width: 40px;
          height: 40px;
          border: 3px solid rgba(255, 255, 255, 0.1);
          border-top-color: #22c55e;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes fadeOut {
          to {
            opacity: 0;
            visibility: hidden;
          }
        }

        .scanner-footer {
          padding: 16px 20px;
          background: linear-gradient(0deg, #141416 0%, #0a0a0b 100%);
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          min-height: 72px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .scanner-hint {
          font-size: 14px;
          color: #71717a;
          text-align: center;
          margin: 0;
        }

        .scanner-result {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
        }

        .scanner-result-label {
          font-size: 12px;
          color: #71717a;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .scanner-result-code {
          font-family: "SF Mono", "Fira Code", monospace;
          font-size: 16px;
          font-weight: 500;
          color: #22c55e;
          background: rgba(34, 197, 94, 0.1);
          padding: 8px 16px;
          border-radius: 8px;
          border: 1px solid rgba(34, 197, 94, 0.2);
        }
      `}</style>
    </div>
  );
}

// =============================================================================
// ERROR STATE COMPONENTS
// =============================================================================

function PermissionDeniedUI({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="error-state">
      <div className="error-icon error-icon-denied">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
          <line x1="12" y1="2" x2="12" y2="12" />
        </svg>
      </div>
      <h3 className="error-title">Camera Access Required</h3>
      <p className="error-description">
        To scan barcodes, please allow camera access in your browser settings.
      </p>
      <div className="error-steps">
        <p className="error-step">
          <span className="error-step-num">1</span>
          Click the camera icon in your browser&apos;s address bar
        </p>
        <p className="error-step">
          <span className="error-step-num">2</span>
          Select &quot;Allow&quot; for camera permissions
        </p>
        <p className="error-step">
          <span className="error-step-num">3</span>
          Refresh the page and try again
        </p>
      </div>
      <button onClick={onRetry} className="error-retry-btn">
        Try Again
      </button>

      <style jsx>{`
        .error-state {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 32px;
          background: linear-gradient(180deg, #0f0f10 0%, #0a0a0b 100%);
          text-align: center;
        }

        .error-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 80px;
          height: 80px;
          border-radius: 20px;
          margin-bottom: 24px;
        }

        .error-icon-denied {
          background: linear-gradient(135deg, #7c2d12 0%, #431407 100%);
          color: #fb923c;
        }

        .error-title {
          font-family: "SF Pro Display", -apple-system, sans-serif;
          font-size: 20px;
          font-weight: 600;
          color: #fafafa;
          margin: 0 0 12px 0;
        }

        .error-description {
          font-size: 14px;
          color: #a1a1aa;
          max-width: 300px;
          margin: 0 0 24px 0;
          line-height: 1.6;
        }

        .error-steps {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 28px;
          width: 100%;
          max-width: 320px;
        }

        .error-step {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 13px;
          color: #d4d4d8;
          text-align: left;
          margin: 0;
        }

        .error-step-num {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          background: rgba(251, 146, 60, 0.15);
          color: #fb923c;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          flex-shrink: 0;
        }

        .error-retry-btn {
          padding: 12px 32px;
          font-size: 14px;
          font-weight: 500;
          color: #fafafa;
          background: linear-gradient(135deg, #ea580c 0%, #c2410c 100%);
          border: none;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .error-retry-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(234, 88, 12, 0.3);
        }
      `}</style>
    </div>
  );
}

function CameraNotFoundUI() {
  return (
    <div className="error-state">
      <div className="error-icon error-icon-notfound">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      </div>
      <h3 className="error-title">No Camera Found</h3>
      <p className="error-description">
        We couldn&apos;t detect a camera on your device. Please connect a camera
        or try on a different device.
      </p>

      <style jsx>{`
        .error-state {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 32px;
          background: linear-gradient(180deg, #0f0f10 0%, #0a0a0b 100%);
          text-align: center;
        }

        .error-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 80px;
          height: 80px;
          border-radius: 20px;
          margin-bottom: 24px;
        }

        .error-icon-notfound {
          background: linear-gradient(135deg, #1e3a5f 0%, #172554 100%);
          color: #60a5fa;
        }

        .error-title {
          font-family: "SF Pro Display", -apple-system, sans-serif;
          font-size: 20px;
          font-weight: 600;
          color: #fafafa;
          margin: 0 0 12px 0;
        }

        .error-description {
          font-size: 14px;
          color: #a1a1aa;
          max-width: 300px;
          margin: 0;
          line-height: 1.6;
        }
      `}</style>
    </div>
  );
}

function GenericErrorUI({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="error-state">
      <div className="error-icon error-icon-generic">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h3 className="error-title">Something Went Wrong</h3>
      <p className="error-description">
        We encountered an error while starting the camera. Please try again.
      </p>
      <button onClick={onRetry} className="error-retry-btn">
        Try Again
      </button>

      <style jsx>{`
        .error-state {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 32px;
          background: linear-gradient(180deg, #0f0f10 0%, #0a0a0b 100%);
          text-align: center;
        }

        .error-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 80px;
          height: 80px;
          border-radius: 20px;
          margin-bottom: 24px;
        }

        .error-icon-generic {
          background: linear-gradient(135deg, #4c1d95 0%, #2e1065 100%);
          color: #a78bfa;
        }

        .error-title {
          font-family: "SF Pro Display", -apple-system, sans-serif;
          font-size: 20px;
          font-weight: 600;
          color: #fafafa;
          margin: 0 0 12px 0;
        }

        .error-description {
          font-size: 14px;
          color: #a1a1aa;
          max-width: 300px;
          margin: 0 0 24px 0;
          line-height: 1.6;
        }

        .error-retry-btn {
          padding: 12px 32px;
          font-size: 14px;
          font-weight: 500;
          color: #fafafa;
          background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%);
          border: none;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .error-retry-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(124, 58, 237, 0.3);
        }
      `}</style>
    </div>
  );
}

