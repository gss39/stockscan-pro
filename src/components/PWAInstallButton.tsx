import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  // If already running as an installed standalone PWA, hide the button
  if (isInstalled) {
    return null;
  }

  // Direct 1-click Chromium / Android / Desktop install flow when beforeinstallprompt has fired
  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-900 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors min-h-[38px] whitespace-nowrap cursor-pointer shadow-xs"
        title="Install StockScan App on Phone / PC"
      >
        <Download className="w-3.5 h-3.5" />
        <span>Install App</span>
      </button>
    );
  }

  // Fallback button for iOS Safari or browsers where beforeinstallprompt hasn't fired yet
  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuideModal(true)}
        className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors min-h-[38px] whitespace-nowrap cursor-pointer"
        title="Add StockScan App to Home Screen"
      >
        <Smartphone className="w-3.5 h-3.5 text-blue-600" />
        <span>Install App</span>
      </button>

      {showGuideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Install StockScan App
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="mt-3 text-xs text-slate-600 space-y-2">
                <p className="font-semibold text-slate-800">
                  Install on iPhone / iPad (Safari):
                </p>
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>
                    Tap the <strong>Share</strong> button at the bottom of Safari.
                  </li>
                  <li>
                    Scroll down and tap <strong>Add to Home Screen</strong>.
                  </li>
                  <li>
                    Tap <strong>Add</strong> in the top-right corner.
                  </li>
                </ol>
              </div>
            ) : (
              <div className="mt-3 text-xs text-slate-600 space-y-2">
                <p className="font-semibold text-slate-800">
                  Install on Android / Chrome:
                </p>
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>
                    Tap the <strong>3-dots menu (⋮)</strong> in the top-right corner of Chrome.
                  </li>
                  <li>
                    Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                  </li>
                </ol>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="mt-4 w-full rounded-xl bg-slate-900 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};
