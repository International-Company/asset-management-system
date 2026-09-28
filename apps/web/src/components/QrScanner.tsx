import { FormEvent, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

/**
 * Scans a QR code with the device camera (spec §33, §68) and always offers a
 * manual code field (asset number, serial or QR text) as a fallback — the
 * camera needs HTTPS and permission, and may be unavailable.
 */
export function QrScanner({ onResult, busy }: { onResult: (code: string) => void; busy?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const last = useRef<{ code: string; at: number } | null>(null);

  useEffect(() => {
    if (!cameraOn) return;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('الكاميرا غير متاحة في هذا المتصفح. أدخل الرمز يدويًا.');
        setCameraOn(false);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (cancelled) return;
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        timer = window.setInterval(() => {
          const c = canvas.current;
          if (!c || v.readyState < 2) return;
          c.width = v.videoWidth;
          c.height = v.videoHeight;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(v, 0, 0, c.width, c.height);
          const found = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
          if (!found?.data) return;
          // Ignore the same code scanned again within 3 seconds.
          const now = Date.now();
          if (last.current && last.current.code === found.data && now - last.current.at < 3000) return;
          last.current = { code: found.data, at: now };
          onResult(found.data);
        }, 300);
      } catch (e) {
        const denied = e instanceof DOMException && e.name === 'NotAllowedError';
        setError(denied ? 'لم يُسمح باستخدام الكاميرا. يمكنك إدخال الرمز يدويًا.' : 'تعذر تشغيل الكاميرا. أدخل الرمز يدويًا.');
        setCameraOn(false);
      }
    })();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [cameraOn, onResult]);

  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    if (manual.trim()) {
      onResult(manual.trim());
      setManual('');
    }
  };

  return (
    <div className="scanner">
      {cameraOn ? (
        <>
          <video ref={video} className="scanner-video" muted playsInline aria-label="معاينة الكاميرا" />
          <canvas ref={canvas} hidden />
          <button type="button" className="btn btn-sm" onClick={() => setCameraOn(false)}>
            إيقاف الكاميرا
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setError(null);
            setCameraOn(true);
          }}
        >
          مسح QR بالكاميرا
        </button>
      )}
      {error && (
        <div className="alert alert-warning" role="status">
          {error}
        </div>
      )}
      <form className="toolbar" onSubmit={submitManual}>
        <div className="field grow">
          <label htmlFor="manual-code">أو أدخل رقم الأصل / الرقم التسلسلي / رمز QR</label>
          <input id="manual-code" className="input" dir="ltr" value={manual} onChange={(e) => setManual(e.target.value)} />
        </div>
        <button type="submit" className="btn" disabled={!manual.trim() || busy}>
          بحث
        </button>
      </form>
    </div>
  );
}
