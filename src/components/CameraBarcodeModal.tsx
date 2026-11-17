import React, { useEffect, useId, useRef, useState } from 'react';
import {
  Html5Qrcode,
  Html5QrcodeSupportedFormats,
  type CameraDevice,
} from 'html5-qrcode';
import {
  Camera,
  CheckCircle2,
  RefreshCw,
  ScanBarcode,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';

export interface CameraScanResult {
  ok: boolean;
  message: string;
}

interface CameraBarcodeModalProps {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => CameraScanResult | void;
  title?: string;
  allowContinuous?: boolean;
  defaultContinuous?: boolean;
}

const GROCERY_FORMATS: Html5QrcodeSupportedFormats[] = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
];

function playBeep(success: boolean) {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = success ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(success ? 1040 : 320, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.11);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 200);
  } catch {
    // Ignore audio context restrictions
  }
}

export const CameraBarcodeModal: React.FC<CameraBarcodeModalProps> = ({
  open,
  onClose,
  onDetected,
  title = 'مسح الباركود بالكاميرا',
  allowContinuous = false,
  defaultContinuous = false,
}) => {
  const reactId = useId();
  const containerId = `camera-scanner-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [continuous, setContinuous] = useState(defaultContinuous);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [starting, setStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lastScanStatus, setLastScanStatus] = useState<CameraScanResult | null>(null);

  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const continuousRef = useRef(continuous);
  continuousRef.current = continuous;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  const lastCodeRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const closingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setContinuous(defaultContinuous);
    setCameraError(null);
    setLastScanStatus(null);
    lastCodeRef.current = { code: '', at: 0 };
    closingRef.current = false;
  }, [open, defaultContinuous]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let html5Qr: Html5Qrcode | null = null;
    let started = false;

    const startScanner = async () => {
      setStarting(true);
      setCameraError(null);

      try {
        html5Qr = new Html5Qrcode(containerId, {
          verbose: false,
          formatsToSupport: GROCERY_FORMATS,
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true,
          },
        });

        const cameraConstraint: string | MediaTrackConstraints = selectedCameraId
          ? selectedCameraId
          : { facingMode: 'environment' };

        await html5Qr.start(
          cameraConstraint,
          {
            fps: 12,
            qrbox: (viewfinderWidth: number, viewfinderHeight: number) => ({
              width: Math.max(180, Math.min(340, Math.floor(viewfinderWidth * 0.84))),
              height: Math.max(110, Math.min(200, Math.floor(viewfinderHeight * 0.55))),
            }),
          },
          (decodedText) => {
            if (cancelled || closingRef.current) return;
            const clean = decodedText.trim();
            if (!clean) return;

            const now = Date.now();
            if (
              lastCodeRef.current.code === clean &&
              now - lastCodeRef.current.at < 1400
            ) {
              return;
            }
            lastCodeRef.current = { code: clean, at: now };

            const result = onDetectedRef.current(clean);
            const ok = result ? result.ok : true;
            const message =
              result?.message || `تمت قراءة الباركود: ${clean}`;

            if (soundEnabledRef.current) {
              playBeep(ok);
            }
            setLastScanStatus({ ok, message });

            if (!continuousRef.current && ok) {
              closingRef.current = true;
              window.setTimeout(() => {
                if (!cancelled) {
                  onCloseRef.current();
                }
              }, 220);
            }
          },
          () => {
            // Ignore per-frame decode misses
          }
        );

        started = true;
        if (cancelled) {
          await html5Qr.stop().catch(() => {});
          html5Qr.clear();
          return;
        }

        // Populate camera list after permission is granted
        try {
          const list = await Html5Qrcode.getCameras();
          if (!cancelled && list.length > 0) {
            setCameras(list);
          }
        } catch {
          // Ignore camera enumeration failure once stream is already running
        }
      } catch (err) {
        if (cancelled) return;
        const raw = err instanceof Error ? err.message : String(err);
        if (/NotAllowedError|Permission|denied/i.test(raw)) {
          setCameraError(
            'تم رفض صلاحية استخدام الكاميرا. يرجى السماح بالوصول للكاميرا من إعدادات المتصفح ثم المحاولة مرة أخرى.'
          );
        } else if (/NotFoundError|Requested device not found|no camera/i.test(raw)) {
          setCameraError('لم يتم العثور على كاميرا متصلة بهذا الجهاز.');
        } else if (/NotReadableError|TrackStartError|in use/i.test(raw)) {
          setCameraError('الكاميرا مستخدمة حالياً من تطبيق آخر. أغلق التطبيق الآخر ثم أعد المحاولة.');
        } else {
          setCameraError('تعذر تشغيل الكاميرا. تأكد من توصيل الكاميرا ومنح الصلاحية.');
        }
      } finally {
        if (!cancelled) {
          setStarting(false);
        }
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      if (html5Qr) {
        const ref = html5Qr;
        if (started) {
          ref
            .stop()
            .then(() => {
              ref.clear();
            })
            .catch(() => {
              try {
                ref.clear();
              } catch {
                // ignore
              }
            });
        } else {
          try {
            ref.clear();
          } catch {
            // ignore
          }
        }
      }
    };
  }, [open, containerId, selectedCameraId]);

  if (!open) return null;

  const handleCycleCamera = () => {
    if (cameras.length < 2) return;
    const currentIndex = cameras.findIndex((c) => c.id === selectedCameraId);
    const nextIndex = (currentIndex + 1) % cameras.length;
    setSelectedCameraId(cameras[nextIndex].id);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg overflow-hidden shadow-xl">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-emerald-700" />
            <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSoundEnabled((s) => !s)}
              className="p-1.5 text-slate-600 hover:bg-slate-200/70 rounded-lg cursor-pointer"
              title={soundEnabled ? 'كتم صوت التنبيه' : 'تفعيل صوت التنبيه'}
            >
              {soundEnabled ? (
                <Volume2 className="w-4 h-4 text-emerald-700" />
              ) : (
                <VolumeX className="w-4 h-4 text-slate-400" />
              )}
            </button>
            {cameras.length > 1 && (
              <button
                type="button"
                onClick={handleCycleCamera}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer"
                title="تبديل الكاميرا"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>تبديل الكاميرا</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 rounded-lg cursor-pointer"
              aria-label="إغلاق"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Camera Viewport */}
        <div className="p-4 space-y-3">
          {cameras.length > 1 && (
            <select
              value={selectedCameraId}
              onChange={(e) => setSelectedCameraId(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="">الكاميرا الخلفية الافتراضية</option>
              {cameras.map((cam, idx) => (
                <option key={cam.id} value={cam.id}>
                  {cam.label || `كاميرا ${idx + 1}`}
                </option>
              ))}
            </select>
          )}

          <div className="relative bg-slate-950 rounded-xl overflow-hidden min-h-[260px] flex items-center justify-center">
            <div id={containerId} className="w-full" />
            {starting && !cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white text-xs bg-slate-950/70">
                <ScanBarcode className="w-6 h-6 animate-pulse text-emerald-400" />
                <span>جاري تشغيل الكاميرا...</span>
              </div>
            )}
          </div>

          {cameraError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs leading-relaxed">
              {cameraError}
            </div>
          )}

          {lastScanStatus && (
            <div
              className={`p-3 rounded-xl text-xs font-semibold border flex items-center gap-2 ${
                lastScanStatus.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{lastScanStatus.message}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {allowContinuous ? (
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={continuous}
                  onChange={(e) => setContinuous(e.target.checked)}
                />
                <span>مسح متتالي مستمر (إضافة عدة أصناف دون إغلاق الكاميرا)</span>
              </label>
            ) : (
              <span className="text-xs text-slate-500">
                وجّه الكاميرا نحو الباركود ليتم التقاطه تلقائياً
              </span>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              {allowContinuous && continuous ? 'إنهاء المسح' : 'إغلاق'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
