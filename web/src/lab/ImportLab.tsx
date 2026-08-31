import { useEffect, useRef, useState } from 'react';
import { isUvttError, parse, toLights, toWallSegments } from '../lib/uvtt';
import type { UvttMap, WallSegment, SceneLight } from '../lib/uvtt';

type DetectedItem = {
  kind: string;
  x: number;
  z: number;
  w: number;
  d: number;
  rotationDeg?: number;
  confidence?: number;
  shape?: string;
  style?: string;
};

const KIND_COLORS: Record<string, string> = {
  table: '#4cc9f0',
  seat: '#80ed99',
  barrel: '#f4a261',
  crate: '#ffd166',
  chest: '#c77dff',
};
const kindColor = (kind: string) => KIND_COLORS[kind] ?? '#ef476f';

const CANVAS_WIDTH = 1100;

function imageDataUrl(base64: string): string {
  const mime = base64.startsWith('iVBOR')
    ? 'image/png'
    : base64.startsWith('UklGR')
      ? 'image/webp'
      : 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

export default function ImportLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [map, setMap] = useState<UvttMap | null>(null);
  const [fileName, setFileName] = useState('');
  const [walls, setWalls] = useState<WallSegment[]>([]);
  const [lights, setLights] = useState<SceneLight[]>([]);
  const [items, setItems] = useState<DetectedItem[]>([]);
  const [rawJson, setRawJson] = useState('');
  const [status, setStatus] = useState('load a .uvtt / .dd2vtt file');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState({ grid: false, walls: true, lights: true, furniture: true });

  async function loadFile(file: File) {
    setItems([]);
    setRawJson('');
    try {
      const parsed = parse(JSON.parse(await file.text()));
      if (isUvttError(parsed)) {
        setStatus(`parse error: ${parsed.message}`);
        return;
      }
      setFileName(file.name);
      setMap(parsed);
      let segs = toWallSegments(parsed, {});
      if (segs.length === 0) segs = toWallSegments(parsed, { includeObjects: true });
      setWalls(segs);
      setLights(toLights(parsed));
      imgRef.current = null;
      if (parsed.image) {
        const img = new Image();
        img.onload = () => {
          imgRef.current = img;
          setStatus(
            `${file.name}: ${parsed.resolution.mapSize.x}x${parsed.resolution.mapSize.z} squares, ` +
              `${segs.length} wall segments, ${parsed.lights.length} lights`,
          );
          setMap((m) => (m ? { ...m } : m)); // trigger redraw
        };
        img.src = imageDataUrl(parsed.image);
      } else {
        setStatus(`${file.name}: no embedded image`);
      }
    } catch (e) {
      setStatus(`failed to read file: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function detect() {
    const img = imgRef.current;
    if (!map || !img) return;
    setBusy(true);
    setStatus('detecting furniture…');
    try {
      // Downscale for the API: long edge ≤ 1568px, JPEG.
      const scale = Math.min(1, 1568 / Math.max(img.width, img.height));
      const off = document.createElement('canvas');
      off.width = Math.round(img.width * scale);
      off.height = Math.round(img.height * scale);
      off.getContext('2d')!.drawImage(img, 0, 0, off.width, off.height);
      const dataUrl = off.toDataURL('image/jpeg', 0.9);

      const res = await fetch('/api/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: dataUrl.split(',')[1],
          mediaType: 'image/jpeg',
          gridWidth: map.resolution.mapSize.x,
          gridHeight: map.resolution.mapSize.z,
        }),
      });
      const payload = (await res.json()) as {
        items?: DetectedItem[];
        error?: string;
        ms?: number;
        usage?: { input: number; output: number };
      };
      if (!res.ok || payload.error || !payload.items) {
        setStatus(`detect failed: ${payload.error ?? res.status}`);
      } else {
        setItems(payload.items);
        setRawJson(JSON.stringify(payload.items, null, 2));
        const counts = payload.items.reduce<Record<string, number>>((acc, it) => {
          acc[it.kind] = (acc[it.kind] ?? 0) + 1;
          return acc;
        }, {});
        setStatus(
          `${payload.items.length} items in ${((payload.ms ?? 0) / 1000).toFixed(1)}s ` +
            `(${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}) — ` +
            `${payload.usage?.input ?? '?'} in / ${payload.usage?.output ?? '?'} out tokens`,
        );
      }
    } catch (e) {
      setStatus(`detect failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !map) return;
    const gridW = map.resolution.mapSize.x;
    const gridH = map.resolution.mapSize.z;
    const scale = CANVAS_WIDTH / gridW;
    canvas.width = CANVAS_WIDTH;
    canvas.height = Math.round(gridH * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#10141c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (img) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const px = (v: number) => v * scale;

    if (show.grid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= gridW; x += 1) {
        ctx.beginPath();
        ctx.moveTo(px(x), 0);
        ctx.lineTo(px(x), canvas.height);
        ctx.stroke();
      }
      for (let z = 0; z <= gridH; z += 1) {
        ctx.beginPath();
        ctx.moveTo(0, px(z));
        ctx.lineTo(canvas.width, px(z));
        ctx.stroke();
      }
    }

    if (show.walls) {
      ctx.strokeStyle = '#4cc9f0';
      ctx.lineWidth = 2;
      for (const w of walls) {
        ctx.beginPath();
        ctx.moveTo(px(w.ax), px(w.az));
        ctx.lineTo(px(w.bx), px(w.bz));
        ctx.stroke();
      }
    }

    if (show.lights) {
      for (const l of lights) {
        ctx.fillStyle = '#ffd166';
        ctx.beginPath();
        ctx.arc(px(l.x), px(l.z), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (show.furniture) {
      ctx.font = '11px system-ui';
      for (const it of items) {
        const color = kindColor(it.kind);
        ctx.save();
        ctx.translate(px(it.x), px(it.z));
        ctx.rotate(((it.rotationDeg ?? 0) * Math.PI) / 180);
        ctx.fillStyle = `${color}59`; // ~35% alpha
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        const w = px(it.w);
        const d = px(it.d);
        ctx.fillRect(-w / 2, -d / 2, w, d);
        ctx.strokeRect(-w / 2, -d / 2, w, d);
        ctx.restore();
        ctx.fillStyle = color;
        const label = `${it.kind}${it.style ? `/${it.style}` : ''}${it.shape ? `/${it.shape}` : ''}`;
        ctx.fillText(label, px(it.x) - px(it.w) / 2 + 2, px(it.z) - px(it.d) / 2 - 3);
      }
    }
  }, [map, walls, lights, items, show]);

  return (
    <div className="lab">
      <div className="lab-controls">
        <h2>import lab</h2>
        <input
          type="file"
          accept=".dd2vtt,.uvtt,.df2vtt,application/json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void loadFile(f);
          }}
        />
        <div className="lab-toggles">
          {(Object.keys(show) as (keyof typeof show)[]).map((key) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={show[key]}
                onChange={() => setShow((s) => ({ ...s, [key]: !s[key] }))}
              />
              {key}
            </label>
          ))}
        </div>
        <button disabled={!map || !imgRef.current || busy} onClick={() => void detect()}>
          {busy ? 'detecting…' : 'detect furniture'}
        </button>
        <div className="lab-status">{status}</div>
        <div className="lab-legend">
          {Object.entries(KIND_COLORS).map(([kind, color]) => (
            <span key={kind} className="badge" style={{ borderLeft: `10px solid ${color}` }}>
              {kind}
            </span>
          ))}
        </div>
        {rawJson && (
          <>
            <button onClick={() => void navigator.clipboard.writeText(rawJson)}>copy JSON</button>
            <pre className="lab-json">{rawJson}</pre>
          </>
        )}
        <a href="#/">← back</a>
      </div>
      <div className="lab-canvas-wrap">
        {map ? <canvas ref={canvasRef} /> : <div className="center-note">drop a UVTT file to begin</div>}
        {fileName && <div className="lab-file">{fileName}</div>}
      </div>
    </div>
  );
}
