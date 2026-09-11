'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, ChevronRight, CircleHelp, House, MonitorUp, Pause, Play, RotateCcw, Settings, Volume2, VolumeX, Zap } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

type GameMode = 'ready' | 'playing' | 'paused' | 'over';
type GameVariant = 'classic' | 'zen' | 'arcade';
type Point = { x: number; y: number; t: number };
type Fruit = { id: number; kind: string; x: number; y: number; vx: number; vy: number; radius: number; rotation: number; spin: number; sliced: boolean; bomb: boolean; decorative?: boolean };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string; size?: number; explosive?: boolean };

const FRUITS = ['🍉', '🍊', '🍋', '🍏', '🍑', '🥝', '🍓'];
const COLORS = ['#ff4d6d', '#ff9e00', '#ffe66d', '#55d66b', '#ff8fab', '#9ad45b'];
const VARIANTS: Record<GameVariant, { label: string; duration: number | null; description: string }> = {
  classic: { label: 'КЛАССИКА', duration: null, description: '3 промаха или бомба — конец игры' },
  zen: { label: 'ДЗЕН', duration: 90, description: '90 секунд · без бомб' },
  arcade: { label: 'АРКАДА', duration: 60, description: '60 секунд · бомба −10 очков' },
};

const FRUIT_STYLES: Record<string, { base: string; accent: string; seed?: string }> = {
  '🍉': { base: '#f24263', accent: '#73d45a', seed: '#35131d' }, '🍊': { base: '#ff9e22', accent: '#ffd36b' },
  '🍋': { base: '#ffe25d', accent: '#fff7b0' }, '🍏': { base: '#72d553', accent: '#d9ff91' },
  '🍑': { base: '#ff8da1', accent: '#ffd1a6' }, '🥝': { base: '#8bc45a', accent: '#e9d98b', seed: '#35291a' },
  '🍓': { base: '#ff4961', accent: '#ffa0a8', seed: '#ffe9a5' },
};

function segmentDistance(a: Point, b: Point, x: number, y: number) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy || 1;
  const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length));
  return Math.hypot(x - (a.x + u * dx), y - (a.y + u * dy));
}

export default function FruitGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef(0);
  const modeRef = useRef<GameMode>('ready');
  const fruitRef = useRef<Fruit[]>([]);
  const particleRef = useRef<Particle[]>([]);
  const trailsRef = useRef<Point[][]>([[], []]);
  const lastSpawnRef = useRef(0);
  const idRef = useRef(0);
  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  const comboRef = useRef(0);
  const lastSliceRef = useRef(0);
  const lastTimeRef = useRef(0);
  const gameStartedRef = useRef(0);
  const variantRef = useRef<GameVariant>('arcade');
  const mediaPipeRef = useRef<any>(null);
  const trackingBusyRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);
  const smoothedFingerRef = useRef<{ x: number; y: number } | null>(null);
  const lastFingerSeenRef = useRef(0);
  const gestureActiveRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const [mode, setMode] = useState<GameMode>('ready');
  const [variant, setVariant] = useState<GameVariant>('arcade');
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [lives, setLives] = useState(3);
  const [combo, setCombo] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<'off' | 'loading' | 'ready' | 'error'>('off');
  const [gestureDetected, setGestureDetected] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [debug, setDebug] = useState(false);
  const [difficulty, setDifficulty] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const updateMode = (next: GameMode) => { modeRef.current = next; setMode(next); };
  const ping = useCallback((frequency: number, duration = 0.07) => {
    if (!soundOn) return;
    try {
      const audio = audioRef.current || new AudioContext();
      audioRef.current = audio;
      const oscillator = audio.createOscillator(), gain = audio.createGain();
      oscillator.frequency.value = frequency; oscillator.type = 'sine';
      gain.gain.setValueAtTime(0.08, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
      oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + duration);
    } catch {}
  }, [soundOn]);

  const startGame = useCallback(() => {
    const duration = VARIANTS[variantRef.current].duration;
    fruitRef.current = []; particleRef.current = []; trailsRef.current = [[], []];
    scoreRef.current = 0; livesRef.current = 3; comboRef.current = 0;
    lastSpawnRef.current = performance.now() - 1200; gameStartedRef.current = performance.now();
    setScore(0); setLives(3); setCombo(0); setTimeLeft(duration || 0); updateMode('playing'); ping(520, 0.12);
  }, [ping]);

  const returnToMenu = useCallback(() => {
    fruitRef.current = []; particleRef.current = []; trailsRef.current = [[], []];
    setCombo(0); updateMode('ready');
  }, []);
  const chooseVariant = (next: GameVariant) => { variantRef.current = next; setVariant(next); };

  const stopCamera = useCallback(() => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    mediaPipeRef.current?.close?.(); mediaPipeRef.current = null;
    smoothedFingerRef.current = null; lastVideoTimeRef.current = -1; gestureActiveRef.current = false; setGestureDetected(false);
    setCameraOn(false); setCameraStatus('off');
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !videoRef.current) { setCameraStatus('error'); return; }
    setCameraStatus('loading');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: 'user' }, audio: false });
      const video = videoRef.current; video.srcObject = stream; await video.play(); setCameraOn(true); setCameraStatus('ready');
      if (!(window as any).Hands) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script'); script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js'; script.crossOrigin = 'anonymous';
          script.onload = () => resolve(); script.onerror = () => reject(new Error('MediaPipe failed to load')); document.head.appendChild(script);
        });
      }
      const Hands = (window as any).Hands;
      const hands = new Hands({ locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
      hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.38, minTrackingConfidence: 0.38 });
      hands.onResults((results: any) => {
        const now = performance.now();
        const landmarks = results.multiHandLandmarks?.[0];
        const indexFingerTip = landmarks?.[8], middleFingerTip = landmarks?.[12];
        const joined = Boolean(indexFingerTip && middleFingerTip && Math.hypot(indexFingerTip.x - middleFingerTip.x, indexFingerTip.y - middleFingerTip.y) < .075);
        if (gestureActiveRef.current !== joined) { gestureActiveRef.current = joined; setGestureDetected(joined); }
        if (!joined || !indexFingerTip || !middleFingerTip) { trailsRef.current[0] = []; smoothedFingerRef.current = null; return; }
        const raw = { x: 1 - (indexFingerTip.x + middleFingerTip.x) / 2, y: (indexFingerTip.y + middleFingerTip.y) / 2 };
          const previous = smoothedFingerRef.current;
          // A light, velocity-aware smoothing keeps the tip stable without making it feel delayed.
          const distance = previous ? Math.hypot(raw.x - previous.x, raw.y - previous.y) : 1;
          const follow = distance > .075 ? .82 : .48;
          const point = previous ? { x: previous.x + (raw.x - previous.x) * follow, y: previous.y + (raw.y - previous.y) * follow } : raw;
          smoothedFingerRef.current = point; lastFingerSeenRef.current = now;
          trailsRef.current[0].push({ ...point, t: now });
          trailsRef.current[0] = trailsRef.current[0].filter((point) => now - point.t < 230).slice(-12);
      });
      mediaPipeRef.current = hands;
    } catch { stopCamera(); setCameraStatus('error'); }
  }, [stopCamera]);

  useEffect(() => { setBest(Number(localStorage.getItem('fruit-rush-best') || 0)); return stopCamera; }, [stopCamera]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(context.registerTool({
        name: 'start_fruit_rush_game',
        title: 'Начать Fruit Rush',
        description: 'Начинает новый 60-секундный забег Fruit Rush и сбрасывает текущий счёт.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: () => { startGame(); return { status: 'playing', durationSeconds: 60 }; },
      }, { signal: lifecycle.signal })).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, [startGame]);
  useEffect(() => {
    let disposed = false;
    const track = async () => {
      const video = videoRef.current;
      if (!disposed && cameraOn && mediaPipeRef.current && video?.readyState === 4 && !trackingBusyRef.current && video.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = video.currentTime;
        trackingBusyRef.current = true; try { await mediaPipeRef.current.send({ image: video }); } catch {} trackingBusyRef.current = false;
      }
      if (!disposed) window.requestAnimationFrame(track);
    };
    track(); return () => { disposed = true; };
  }, [cameraOn]);

  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const keys = new Set<string>(), keyboardPoint = { x: 0.5, y: 0.55 };
    const resize = () => { const rect = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2); canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize(); const observer = new ResizeObserver(resize); observer.observe(canvas);
    const addPoint = (x: number, y: number, index = 0) => { const rect = canvas.getBoundingClientRect(), now = performance.now(); trailsRef.current[index].push({ x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height, t: now }); trailsRef.current[index] = trailsRef.current[index].filter((point) => now - point.t < 230).slice(-12); };
    const pointerMove = (event: PointerEvent) => addPoint(event.clientX, event.clientY, event.pointerType === 'touch' && !event.isPrimary ? 1 : 0);
    const keyDown = (event: KeyboardEvent) => { keys.add(event.key); if (event.code === 'Space') { event.preventDefault(); if (modeRef.current === 'playing') updateMode('paused'); else if (modeRef.current === 'paused') updateMode('playing'); } };
    const keyUp = (event: KeyboardEvent) => keys.delete(event.key);
    canvas.addEventListener('pointermove', pointerMove); window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp);

    const spawn = (width: number, height: number, now: number, elapsed: number) => {
      // One clear target at a time: a very slow start that gently accelerates through the round.
      const progress = Math.min(1, elapsed / 60);
      const bombChance = variantRef.current === 'zen' || elapsed < 25 ? 0 : .025 + progress * .035;
      const bomb = Math.random() < bombChance;
      const direction = Math.random() < .5 ? -1 : 1;
      fruitRef.current.push({ id: idRef.current++, kind: bomb ? '💣' : FRUITS[Math.floor(Math.random() * FRUITS.length)], x: width * (0.16 + Math.random() * 0.68), y: height + 48, vx: width * (-0.11 + Math.random() * 0.22), vy: -height * (1.5 + Math.random() * .16 + progress * .08), radius: Math.max(34, width * 0.048), rotation: Math.random() * 4, spin: direction * (3.2 + Math.random() * 2.5), sliced: false, bomb });
      lastSpawnRef.current = now;
    };
    const explodeBomb = (x: number, y: number) => {
      const blast = ['#fff4a3', '#ffbf38', '#ff673d', '#ff365e', '#ffdf68'];
      for (let n = 0; n < 44; n++) { const angle = Math.random() * Math.PI * 2, speed = 90 + Math.random() * 390; particleRef.current.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: .5 + Math.random() * .65, size: 3 + Math.random() * 8, color: blast[n % blast.length], explosive: true }); }
    };
    const addMenuFruitBackdrop = (width: number, height: number) => {
      fruitRef.current = FRUITS.slice(0, 5).map((kind, index) => ({ id: idRef.current++, kind, x: width * [0.14, 0.33, 0.7, 0.87, 0.53][index], y: height * [0.26, 0.72, 0.22, 0.66, 0.43][index], vx: 0, vy: 0, radius: Math.max(35, width * [0.055, 0.045, 0.06, 0.048, 0.04][index]), rotation: [-.4, .5, -.22, .36, -.1][index], spin: 0, sliced: false, bomb: false, decorative: true }));
    };
    const drawFruit = (fruit: Fruit) => {
      if (fruit.bomb) {
        const r = fruit.radius;
        const metal = ctx.createRadialGradient(-r * .28, -r * .35, r * .08, 0, 0, r); metal.addColorStop(0, '#758587'); metal.addColorStop(.42, '#354447'); metal.addColorStop(1, '#0b1012');
        ctx.fillStyle = metal; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#94a5a4'; ctx.lineWidth = Math.max(2, r * .06); ctx.stroke();
        ctx.fillStyle = '#ffcb3d'; ctx.beginPath(); ctx.arc(-r * .25, -r * .28, r * .13, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#bc6c24'; ctx.lineWidth = Math.max(2, r * .08); ctx.beginPath(); ctx.moveTo(r * .05, -r * .82); ctx.quadraticCurveTo(r * .22, -r * 1.28, r * .54, -r * 1.12); ctx.stroke();
        ctx.fillStyle = '#ff7a38'; ctx.shadowColor = '#ff4e37'; ctx.shadowBlur = 13; ctx.beginPath(); ctx.arc(r * .56, -r * 1.13, r * .13, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,.17)'; ctx.beginPath(); ctx.arc(-r * .32, -r * .36, r * .18, 0, Math.PI * 2); ctx.fill(); return;
      }
      const style = FRUIT_STYLES[fruit.kind] || FRUIT_STYLES['🍊'];
      const r = fruit.radius;
      const glow = ctx.createRadialGradient(-r * .25, -r * .35, r * .08, 0, 0, r * 1.25); glow.addColorStop(0, style.accent); glow.addColorStop(.52, style.base); glow.addColorStop(1, '#17231d');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.ellipse(0, 0, r * .92, r, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = Math.max(1, r * .045); ctx.stroke();
      ctx.fillStyle = '#67bd4f'; ctx.beginPath(); ctx.ellipse(r * .18, -r * .86, r * .18, r * .1, -.55, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#5d3b1d'; ctx.lineWidth = Math.max(2, r * .075); ctx.beginPath(); ctx.moveTo(0, -r * .76); ctx.quadraticCurveTo(-r * .05, -r * 1.08, r * .2, -r * 1.12); ctx.stroke();
      if (style.seed) { ctx.fillStyle = style.seed; for (let i = 0; i < 5; i++) { const angle = (Math.PI * 2 * i) / 5; ctx.beginPath(); ctx.arc(Math.cos(angle) * r * .38, Math.sin(angle) * r * .4, Math.max(1.4, r * .07), 0, Math.PI * 2); ctx.fill(); } }
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.ellipse(-r * .32, -r * .34, r * .16, r * .24, -.55, 0, Math.PI * 2); ctx.fill();
    };
    const finish = () => { updateMode('over'); const nextBest = Math.max(scoreRef.current, Number(localStorage.getItem('fruit-rush-best') || 0)); localStorage.setItem('fruit-rush-best', String(nextBest)); setBest(nextBest); };
    const draw = (time: number) => {
      const rect = canvas.getBoundingClientRect(), width = rect.width, height = rect.height;
      const dt = Math.min((time - lastTimeRef.current) / 1000 || 0, 0.032); lastTimeRef.current = time; ctx.clearRect(0, 0, width, height);
      const bg = ctx.createLinearGradient(0, 0, 0, height); bg.addColorStop(0, cameraOn ? 'rgba(5,18,17,.28)' : '#071615'); bg.addColorStop(1, cameraOn ? 'rgba(2,9,9,.62)' : '#020b0a'); ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
      for (let y = 0; y < height; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }

      if (modeRef.current === 'ready' && !fruitRef.current.length) addMenuFruitBackdrop(width, height);

      if (modeRef.current === 'playing') {
        const duration = VARIANTS[variantRef.current].duration;
        const remaining = duration === null ? Infinity : Math.max(0, duration - (time - gameStartedRef.current) / 1000); setTimeLeft(Number.isFinite(remaining) ? Math.ceil(remaining) : 0);
        if ((Number.isFinite(remaining) && remaining <= 0) || (variantRef.current === 'classic' && livesRef.current <= 0)) finish();
        const elapsed = (time - gameStartedRef.current) / 1000;
        const progress = Math.min(1, elapsed / 60);
        const spawnInterval = (3100 - progress * 1000) / difficulty;
        const hasFlyingFruit = fruitRef.current.some((fruit) => !fruit.decorative && !fruit.sliced);
        if (!hasFlyingFruit && time - lastSpawnRef.current > spawnInterval) spawn(width, height, time, elapsed);
        if (keys.size) {
          const speed = 0.7 * dt; if (keys.has('ArrowLeft') || keys.has('a')) keyboardPoint.x -= speed; if (keys.has('ArrowRight') || keys.has('d')) keyboardPoint.x += speed; if (keys.has('ArrowUp') || keys.has('w')) keyboardPoint.y -= speed; if (keys.has('ArrowDown') || keys.has('s')) keyboardPoint.y += speed;
          keyboardPoint.x = Math.max(0, Math.min(1, keyboardPoint.x)); keyboardPoint.y = Math.max(0, Math.min(1, keyboardPoint.y)); trailsRef.current[0].push({ ...keyboardPoint, t: time });
        }
        fruitRef.current.forEach((fruit) => { if (fruit.decorative) return; fruit.vy += height * 1.12 * dt; fruit.x += fruit.vx * dt; fruit.y += fruit.vy * dt; fruit.rotation += fruit.spin * dt; if (!fruit.sliced && fruit.y > height + fruit.radius * 2 && fruit.vy > 0) { fruit.sliced = true; if (!fruit.bomb && variantRef.current === 'classic') { livesRef.current -= 1; setLives(livesRef.current); comboRef.current = 0; setCombo(0); ping(110, 0.15); } } });
        trailsRef.current.forEach((trail) => {
          const recent = trail.filter((point) => time - point.t < 230); trail.splice(0, trail.length, ...recent); if (trail.length < 2) return;
          const a = trail[trail.length - 2], b = trail[trail.length - 1]; const speed = Math.hypot((b.x - a.x) * width, (b.y - a.y) * height) / Math.max(8, b.t - a.t); if (speed < 0.18) return;
          fruitRef.current.forEach((fruit) => {
            const hitRadius = (fruit.radius + 28) / Math.min(width, height);
            const distance = segmentDistance(a, b, fruit.x / width, fruit.y / height);
            if (fruit.sliced || distance > hitRadius) return; fruit.sliced = true;
            if (fruit.bomb) { comboRef.current = 0; setCombo(0); explodeBomb(fruit.x, fruit.y); if (variantRef.current === 'classic') { livesRef.current = 0; setLives(0); } else { scoreRef.current = Math.max(0, scoreRef.current - 10); setScore(scoreRef.current); } ping(85, 0.25); }
            else { comboRef.current = time - lastSliceRef.current < 850 ? comboRef.current + 1 : 1; lastSliceRef.current = time; scoreRef.current += 10 * Math.min(comboRef.current, 5); setScore(scoreRef.current); setCombo(comboRef.current); ping(460 + comboRef.current * 55); const color = COLORS[Math.floor(Math.random() * COLORS.length)]; for (let n = 0; n < 14; n++) particleRef.current.push({ x: fruit.x, y: fruit.y, vx: -140 + Math.random() * 280, vy: -180 + Math.random() * 250, life: 1, color }); }
          });
        });
      }

      fruitRef.current = fruitRef.current.filter((fruit) => fruit.decorative || (!fruit.sliced && fruit.y < height + 140));
      fruitRef.current.forEach((fruit) => { ctx.save(); ctx.translate(fruit.x, fruit.y); ctx.rotate(fruit.rotation); ctx.globalAlpha = fruit.decorative ? .5 : 1; ctx.shadowColor = fruit.bomb ? '#ff4d4d' : 'rgba(0,0,0,.62)'; ctx.shadowBlur = fruit.bomb ? 24 : 18; drawFruit(fruit); ctx.restore(); });
      particleRef.current.forEach((p) => { p.life -= dt * (p.explosive ? 1.15 : 1.8); p.vy += (p.explosive ? 380 : 260) * dt; p.x += p.vx * dt; p.y += p.vy * dt; ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color; if (p.explosive) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.vy, p.vx)); ctx.fillRect(-(p.size || 5) / 2, -(p.size || 5) / 2, (p.size || 5) * 1.8, p.size || 5); ctx.restore(); } else { ctx.beginPath(); ctx.arc(p.x, p.y, 2 + p.life * 4, 0, Math.PI * 2); ctx.fill(); } }); ctx.globalAlpha = 1; particleRef.current = particleRef.current.filter((p) => p.life > 0);
      trailsRef.current.forEach((trail, trailIndex) => { if (trail.length < 2) return; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; for (let i = 1; i < trail.length; i++) { const alpha = i / trail.length; ctx.strokeStyle = trailIndex ? `rgba(255,94,184,${alpha})` : `rgba(183,255,77,${alpha})`; ctx.lineWidth = 2 + alpha * 9; ctx.beginPath(); ctx.moveTo(trail[i - 1].x * width, trail[i - 1].y * height); ctx.lineTo(trail[i].x * width, trail[i].y * height); ctx.stroke(); } });
      const activeFinger = trailsRef.current[0].at(-1);
      if (cameraOn && activeFinger && time - activeFinger.t < 180) { ctx.save(); ctx.translate(activeFinger.x * width, activeFinger.y * height); ctx.strokeStyle = '#d8ff90'; ctx.fillStyle = 'rgba(183,255,77,.13)'; ctx.lineWidth = 2; ctx.shadowColor = '#b7ff4d'; ctx.shadowBlur = 18; ctx.beginPath(); ctx.arc(0, 0, 28, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fillStyle = '#f1ffe0'; ctx.fill(); ctx.restore(); }
      if (debug) { ctx.fillStyle = 'rgba(0,0,0,.62)'; ctx.fillRect(12, height - 62, 210, 48); ctx.fillStyle = '#b7ff4d'; ctx.font = '12px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.fillText(`FPS ${Math.round(1 / Math.max(dt, .001))}  OBJECTS ${fruitRef.current.length}`, 24, height - 38); ctx.fillText(`HANDS ${trailsRef.current.filter((t) => t.length > 1).length}  MODE ${cameraOn ? 'CAM' : 'POINTER'}`, 24, height - 20); }
      frameRef.current = requestAnimationFrame(draw);
    };
    frameRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frameRef.current); observer.disconnect(); canvas.removeEventListener('pointermove', pointerMove); window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); };
  }, [cameraOn, debug, difficulty, ping]);

  const togglePause = () => updateMode(mode === 'playing' ? 'paused' : 'playing');
  const cameraLabel = cameraStatus === 'ready' ? (gestureDetected ? 'Жест найден — режь!' : 'Соедини 2 пальца') : cameraStatus === 'loading' ? 'Подключаем камеру…' : cameraStatus === 'error' ? 'Камера недоступна' : 'Мышь / касание';

  return <main className="game-shell">
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <header className="topbar">
      <a className="brand" href="#game" aria-label="Fruit Rush — к игре"><span className="brand-mark">FR</span><span><b>FRUIT RUSH</b><small>MOTION ARCADE</small></span></a>
      <div className="status-pill" data-state={cameraStatus}><span className="status-dot" /> {cameraLabel}</div>
      <div className="header-actions">{mode !== 'ready' && <button className="icon-button" onClick={returnToMenu} aria-label="Вернуться в меню"><House size={19} /></button>}<button className="icon-button" onClick={() => setHelpOpen(true)} aria-label="Как играть"><CircleHelp size={20} /></button><button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Настройки"><Settings size={20} /></button></div>
    </header>
    <section className="game-layout" id="game">
      <div className="stat-card score-card"><span>СЧЁТ</span><strong>{score.toString().padStart(4, '0')}</strong><small>ЛУЧШИЙ {best.toString().padStart(4, '0')}</small></div>
      <div className="stage-wrap">
        <div className="stage-topline"><span>{VARIANTS[variant].label} · {VARIANTS[variant].duration === null ? '∞' : `${timeLeft} СЕК`}</span><div className="lives" aria-label={`${lives} жизней`}>{variant === 'classic' && [0, 1, 2].map((heart) => <span key={heart} className={heart >= lives ? 'lost' : ''}>♥</span>)}</div></div>
        <div className="stage">
          <video ref={videoRef} className={`camera-feed ${cameraOn ? 'visible' : ''}`} muted playsInline aria-hidden="true" /><canvas ref={canvasRef} aria-label="Игровое поле Fruit Rush. Двигайте мышью, пальцем или рукой перед камерой." />
          {mode !== 'playing' && <div className="game-overlay">
            {mode === 'ready' && <><div className="eyebrow"><Zap size={15} /> РЕАКЦИЯ. РИТМ. РАЗРЕЗ.</div><h1>РЕЖЬ ФРУКТЫ<br /><em>ДВИЖЕНИЕМ</em></h1><p>Соедини <b>указательный и средний пальцы</b> перед камерой — только этот жест режет фрукты. Или используй мышь.</p><div className="variant-switch">{(Object.keys(VARIANTS) as GameVariant[]).map((item) => <button key={item} className={variant === item ? 'selected' : ''} onClick={() => chooseVariant(item)}><b>{VARIANTS[item].label}</b><small>{VARIANTS[item].description}</small></button>)}</div><button className="primary-button" onClick={startGame}><Play size={18} fill="currentColor" /> НАЧАТЬ ИГРУ <ChevronRight size={18} /></button><button className="camera-button" onClick={cameraOn ? stopCamera : startCamera}>{cameraOn ? <CameraOff size={17} /> : <Camera size={17} />} {cameraOn ? 'Выключить камеру' : 'Играть с камерой'}</button></>}
            {mode === 'paused' && <><div className="eyebrow">ПАУЗА</div><h1>ПЕРЕВЕДИ<br /><em>ДЫХАНИЕ</em></h1><button className="primary-button" onClick={togglePause}><Play size={18} /> ПРОДОЛЖИТЬ</button></>}
            {mode === 'over' && <><div className="eyebrow">ЗАБЕГ ЗАВЕРШЁН</div><h1>{score}<br /><em>ОЧКОВ</em></h1><p>{score >= best && score > 0 ? 'Новый рекорд. Очень остро!' : `Лучший результат: ${best}`}</p><button className="primary-button" onClick={startGame}><RotateCcw size={18} /> ЕЩЁ РАЗ</button></>}
          </div>}
          {mode === 'playing' && combo > 1 && <div className="combo-badge">КОМБО ×{Math.min(combo, 5)}</div>}
        </div>
        <div className="stage-footer"><span><i className="swipe-icon">↗</i> Резкое движение разрезает</span><span className="desktop-hint">Стрелки / WASD тоже работают</span><button onClick={mode === 'ready' || mode === 'over' ? startGame : togglePause}>{mode === 'playing' ? <Pause size={16} /> : <Play size={16} />} {mode === 'playing' ? 'Пауза' : 'Старт'}</button></div>
      </div>
      <aside className="side-panel"><div><span className="panel-label">МНОЖИТЕЛЬ</span><strong className="combo-number">×{Math.max(1, Math.min(combo, 5))}</strong><div className="combo-track"><i style={{ width: `${Math.min(combo, 5) * 20}%` }} /></div><small>Режь без пауз, чтобы удержать серию</small></div><div className="separator" /><div className="mini-control"><span><Camera size={17} /> Камера</span><button onClick={cameraOn ? stopCamera : startCamera} aria-pressed={cameraOn}>{cameraOn ? 'Вкл' : 'Выкл'}</button></div><div className="mini-control"><span>{soundOn ? <Volume2 size={17} /> : <VolumeX size={17} />} Звук</span><button onClick={() => setSoundOn(!soundOn)} aria-pressed={soundOn}>{soundOn ? 'Вкл' : 'Выкл'}</button></div><div className="mini-control menu-control"><span><House size={17} /> Меню</span><button onClick={returnToMenu}>Выйти</button></div></aside>
    </section>
    <footer className="page-footer"><span>Подключи ноутбук по HDMI или включи трансляцию телефона — трекер остаётся на этом устройстве.</span><button onClick={() => document.documentElement.requestFullscreen?.()}><MonitorUp size={15} /> На ТВ / полный экран</button></footer>
    <Dialog open={settingsOpen || helpOpen} onOpenChange={(open) => { if (!open) { setSettingsOpen(false); setHelpOpen(false); } }}>
      <DialogContent className="modal">
        {helpOpen ? <><span className="modal-kicker">КАК ИГРАТЬ</span><DialogTitle className="modal-title">Два пальца — лезвие</DialogTitle><ol className="how-list"><li><b>1</b><span>Разреши доступ к камере и соедини в кадре <b>указательный и средний пальцы</b> — либо используй мышь.</span></li><li><b>2</b><span>Делай быстрые взмахи через фрукты. Медленные движения не считаются.</span></li><li><b>3</b><span>Не пропускай фрукты и обходи бомбы. Серии дают больше очков.</span></li></ol></> : <><span className="modal-kicker">НАСТРОЙКИ</span><DialogTitle className="modal-title">Подстрой игру</DialogTitle><div className="setting-row"><span><b>Камера</b><small>Жест: указательный + средний палец</small></span><Switch checked={cameraOn} onCheckedChange={(checked) => checked ? startCamera() : stopCamera()} aria-label="Камера" /></div><div className="setting-row"><span><b>Звук</b><small>Сигналы разреза и промаха</small></span><Switch checked={soundOn} onCheckedChange={setSoundOn} aria-label="Звук" /></div><div className="setting-range"><span><b>Сложность</b><small>{difficulty === 1 ? 'Спокойно' : difficulty < 1.6 ? 'Быстро' : 'Турбо'}</small></span><Slider min={1} max={2} step={0.5} value={[difficulty]} onValueChange={(value) => setDifficulty(value[0])} aria-label="Сложность" /></div><div className="setting-row"><span><b>Режим разработчика</b><small>FPS, объекты и отслеживание</small></span><Switch checked={debug} onCheckedChange={setDebug} aria-label="Режим разработчика" /></div></>}
      </DialogContent>
    </Dialog>
  </main>;
}
