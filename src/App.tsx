import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import {
  Camera,
  CameraOff,
  Eye,
  Hand,
  MousePointer,
  RotateCcw,
  Sparkles,
  Trash2,
  Download,
  HelpCircle,
  X,
  Volume2,
} from 'lucide-react';

type BrushStyle = 'neon' | 'rainbow' | 'liquid' | 'galaxy' | 'fire';

interface Point {
  x: number;
  y: number;
  time: number;
}

interface Stroke {
  points: Point[];
  color: string;
  size: number;
  brushStyle: BrushStyle;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  decay: number;
  life: number;
  type: 'spark' | 'ember' | 'star' | 'bubble';
}

interface GestureState {
  isPinching: boolean;
  pinchDist: number;
  isIndexUp: boolean;
  isOpenPalm: boolean;
  isFist: boolean;
  isTwoHandsApart: boolean;
  isThumbsUp: boolean;
  isThumbsDown: boolean;
  isPeaceSign: boolean;
  isThreeFingers: boolean;
  handCount: number;
  indexPos: { x: number; y: number } | null;
  thumbPos: { x: number; y: number } | null;
  palmPos: { x: number; y: number } | null;
}

const PRESET_COLORS = [
  '#00f0ff', // Cyber Cyan
  '#ff0077', // Neon Magenta
  '#ffe600', // Solar Gold
  '#00ff66', // Acid Green
  '#a855f7', // Mystic Violet
  '#ff5500', // Radiant Orange
  '#ffffff', // Pure White
];

const COLOR_NAMES: Record<string, string> = {
  '#00f0ff': 'CYBER CYAN',
  '#ff0077': 'NEON MAGENTA',
  '#ffe600': 'SOLAR GOLD',
  '#00ff66': 'ACID GREEN',
  '#a855f7': 'MYSTIC VIOLET',
  '#ff5500': 'RADIANT ORANGE',
  '#ffffff': 'PURE WHITE',
};

const BRUSH_SIZES = [
  { label: 'S', size: 6 },
  { label: 'M', size: 14 },
  { label: 'L', size: 26 },
  { label: 'XL', size: 42 },
];

const BRUSH_STYLES: { id: BrushStyle; name: string; icon: string }[] = [
  { id: 'neon', name: 'Neon', icon: '⚡' },
  { id: 'rainbow', name: 'Rainbow', icon: '🌈' },
  { id: 'liquid', name: 'Liquid', icon: '💧' },
  { id: 'galaxy', name: 'Galaxy', icon: '🌌' },
  { id: 'fire', name: 'Fire', icon: '🔥' },
];

export default function App() {
  // Container & Canvas references
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const paintCanvasRef = useRef<HTMLCanvasElement>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);

  // Creative Studio State
  const [activeBrush, setActiveBrush] = useState<BrushStyle>('neon');
  const [activeColor, setActiveColor] = useState<string>(PRESET_COLORS[0]);
  const [brushSize, setBrushSize] = useState<number>(14);

  // Camera opacity: default 0.75 (75%)
  const [cameraOpacity, setCameraOpacity] = useState<number>(0.75);

  const [inputMode, setInputMode] = useState<'hand' | 'touch'>('touch');
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [gestureNotice, setGestureNotice] = useState<string>('Ready • Tap Start Camera or draw with Touch/Mouse');

  // Camera & Tracking Lifecycles
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'requesting' | 'active' | 'denied' | 'error'>('idle');
  const [cameraErrorMsg, setCameraErrorMsg] = useState<string | null>(null);
  const [isModelLoading, setIsModelLoading] = useState<boolean>(false);

  // Responsive Dimensions & Device Pixel Ratio
  const dprRef = useRef<number>(1);
  const canvasSizeRef = useRef<{ width: number; height: number }>({ width: 390, height: 844 });

  // Engine Data & History
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const undoStackRef = useRef<Stroke[][]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const rainbowHueRef = useRef<number>(0);
  const isPointerDownRef = useRef<boolean>(false);

  // Fingertip Smoothing State (Exponential Moving Average)
  const smoothedIndexRef = useRef<{ x: number; y: number } | null>(null);

  // Synchronized state refs for closure access in animation loop
  const activeColorRef = useRef<string>(activeColor);
  const activeBrushRef = useRef<BrushStyle>(activeBrush);
  activeColorRef.current = activeColor;
  activeBrushRef.current = activeBrush;

  // Edge-Trigger Gesture Tracking & Cooldowns
  const wasOpenPalmRef = useRef<boolean>(false);
  const wasTwoHandsApartRef = useRef<boolean>(false);
  const wasPinchingRef = useRef<boolean>(false);
  const wasThumbsUpRef = useRef<boolean>(false);
  const wasThumbsDownRef = useRef<boolean>(false);
  const wasPeaceSignRef = useRef<boolean>(false);
  const wasThreeFingersRef = useRef<boolean>(false);
  const lastPalmBurstTimeRef = useRef<number>(0);
  const lastSupernovaTimeRef = useRef<number>(0);
  const lastUndoGestureTimeRef = useRef<number>(0);
  const lastClearGestureTimeRef = useRef<number>(0);
  const lastColorGestureTimeRef = useRef<number>(0);
  const lastBrushGestureTimeRef = useRef<number>(0);
  const lastHandsDistRef = useRef<number | null>(null);

  // -------------------------------------------------------------
  // 1. RESPONSIVE CANVAS SIZING WITH DPR
  // -------------------------------------------------------------
  const updateDimensions = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const rect = stage.getBoundingClientRect();
    const width = Math.max(280, Math.round(rect.width));
    const height = Math.max(480, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    dprRef.current = dpr;
    canvasSizeRef.current = { width, height };

    [paintCanvasRef, fxCanvasRef, cursorCanvasRef].forEach((ref) => {
      const canvas = ref.current;
      if (!canvas) return;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.resetTransform?.();
        ctx.scale(dpr, dpr);
      }
    });

    redrawAllStrokes();
  }, []);

  useEffect(() => {
    updateDimensions();
    const stage = stageRef.current;
    if (!stage) return;

    const ro = new ResizeObserver(() => updateDimensions());
    ro.observe(stage);

    window.addEventListener('resize', updateDimensions);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateDimensions);
    };
  }, [updateDimensions]);

  // -------------------------------------------------------------
  // 2. MEDIAPIPE MODEL INITIALIZER (ONLY ON DEMAND)
  // -------------------------------------------------------------
  const loadModel = async (): Promise<HandLandmarker> => {
    if (landmarkerRef.current) return landmarkerRef.current;

    setIsModelLoading(true);
    setCameraErrorMsg(null);

    try {
      const filesetResolver = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );

      let instance: HandLandmarker | null = null;
      try {
        instance = await HandLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
        });
      } catch (gpuErr) {
        console.warn('GPU pipeline unavailable, switching to CPU:', gpuErr);
        instance = await HandLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
        });
      }

      landmarkerRef.current = instance;
      setIsModelLoading(false);
      return instance;
    } catch (err: unknown) {
      setIsModelLoading(false);
      setCameraErrorMsg('Failed loading vision model. Falling back to Touch/Mouse.');
      throw err;
    }
  };

  // -------------------------------------------------------------
  // 3. START CAMERA (EXPLICIT USER-TRIGGERED PERMISSION)
  // -------------------------------------------------------------
  const handleStartCamera = async () => {
    setCameraStatus('requesting');
    setCameraErrorMsg(null);

    try {
      await loadModel();

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Webcam API is unavailable in this browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 720 },
          height: { ideal: 1280 },
          facingMode: 'user',
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setCameraStatus('active');
          setInputMode('hand');
          setGestureNotice('Camera active • Raise index finger to draw');
        };
      }
    } catch (err: any) {
      console.warn('Camera initiation failed:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraStatus('denied');
        setCameraErrorMsg('Camera access was denied. You can continue creating art in Touch/Mouse mode!');
      } else {
        setCameraStatus('error');
        setCameraErrorMsg(err.message || 'Unable to start camera.');
      }
      setInputMode('touch');
    }
  };

  const handleStopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setCameraStatus('idle');
    setInputMode('touch');
    setGestureNotice('Camera stopped • Touch mode active');
  };

  // -------------------------------------------------------------
  // 4. PARTICLE PHYSICS ENGINE
  // -------------------------------------------------------------
  const emitParticles = (
    x: number,
    y: number,
    color: string,
    count: number = 3,
    type: Particle['type'] = 'spark',
    spread: number = 2.5
  ) => {
    if (particlesRef.current.length > 140) {
      particlesRef.current.splice(0, count);
    }
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * spread + 0.6;
      particlesRef.current.push({
        x: x + (Math.random() - 0.5) * 4,
        y: y + (Math.random() - 0.5) * 4,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (type === 'ember' ? 1.6 : 0),
        size: Math.random() * 3 + 1.8,
        color,
        alpha: 1,
        decay: Math.random() * 0.03 + 0.02,
        life: 1,
        type,
      });
    }
  };

  const triggerPalmBurst = (x: number, y: number) => {
    for (let i = 0; i < 28; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 7 + 2.5;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 4.5 + 2,
        color: PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)],
        alpha: 1,
        decay: 0.02,
        life: 1,
        type: 'star',
      });
    }
    setGestureNotice('✨ PALM BURST!');
  };

  const triggerArtworkExplosion = () => {
    const { width, height } = canvasSizeRef.current;
    for (let i = 0; i < 45; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 10 + 3;
      particlesRef.current.push({
        x: width / 2 + (Math.random() - 0.5) * 30,
        y: height / 2 + (Math.random() - 0.5) * 30,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 5.5 + 2,
        color: PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)],
        alpha: 1,
        decay: 0.016,
        life: 1,
        type: 'star',
      });
    }
    setGestureNotice('💥 SUPERNOVA BLAST!');
  };

  // -------------------------------------------------------------
  // 5. GESTURE RECOGNITION ALGORITHM
  // -------------------------------------------------------------
  const analyzeGestures = (landmarksList: any[]): GestureState => {
    const { width, height } = canvasSizeRef.current;
    const state: GestureState = {
      isPinching: false,
      pinchDist: 1,
      isIndexUp: false,
      isOpenPalm: false,
      isFist: false,
      isTwoHandsApart: false,
      isThumbsUp: false,
      isThumbsDown: false,
      isPeaceSign: false,
      isThreeFingers: false,
      handCount: landmarksList.length,
      indexPos: null,
      thumbPos: null,
      palmPos: null,
    };

    if (landmarksList.length === 0) {
      smoothedIndexRef.current = null;
      return state;
    }

    const dist = (p1: any, p2: any) =>
      Math.hypot(p1.x - p2.x, p1.y - p2.y, (p1.z || 0) - (p2.z || 0));

    const lm = landmarksList[0];
    const wrist = lm[0];
    const rawX = (1 - lm[8].x) * width;
    const rawY = lm[8].y * height;

    // Exponential Moving Average filter to smooth hand tremble
    const alpha = 0.55;
    if (!smoothedIndexRef.current) {
      smoothedIndexRef.current = { x: rawX, y: rawY };
    } else {
      smoothedIndexRef.current = {
        x: smoothedIndexRef.current.x * (1 - alpha) + rawX * alpha,
        y: smoothedIndexRef.current.y * (1 - alpha) + rawY * alpha,
      };
    }

    state.indexPos = { ...smoothedIndexRef.current };
    state.thumbPos = { x: (1 - lm[4].x) * width, y: lm[4].y * height };
    state.palmPos = { x: (1 - lm[9].x) * width, y: lm[9].y * height };

    const isExt = (tip: number, pip: number) =>
      dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.15;

    const iExt = isExt(8, 6);
    const mExt = isExt(12, 10);
    const rExt = isExt(16, 14);
    const pExt = isExt(20, 18);
    const fourFingersCurled = !iExt && !mExt && !rExt && !pExt;

    state.pinchDist = dist(lm[4], lm[8]);
    state.isPinching = state.pinchDist < 0.075;

    // Thumb extended checks
    const thumbExtended =
      dist(lm[4], lm[9]) > dist(lm[2], lm[9]) * 1.15 &&
      dist(lm[4], lm[2]) > dist(lm[3], lm[2]) * 1.1;

    // Thumbs-Up (Undo): 4 fingers curled, thumb extended pointing up (tip Y < IP Y, MCP Y, wrist Y)
    const thumbPointingUp =
      lm[4].y < lm[3].y - 0.035 &&
      lm[4].y < lm[2].y - 0.05 &&
      lm[4].y < lm[0].y - 0.06 &&
      lm[4].y < lm[5].y;

    // Thumbs-Down (Clear): 4 fingers curled, thumb extended pointing down (tip Y > IP Y, MCP Y, palm Y)
    const thumbPointingDown =
      lm[4].y > lm[3].y + 0.035 &&
      lm[4].y > lm[2].y + 0.04 &&
      lm[4].y > lm[9].y &&
      lm[4].y > lm[5].y;

    // 1. Thumbs-Up: Undo
    state.isThumbsUp =
      fourFingersCurled &&
      thumbExtended &&
      thumbPointingUp &&
      state.pinchDist > 0.08;

    // 2. Thumbs-Down: Clear canvas
    state.isThumbsDown =
      fourFingersCurled &&
      thumbExtended &&
      thumbPointingDown &&
      state.pinchDist > 0.08;

    // 3. Closed Fist: Pause immediately
    state.isFist =
      fourFingersCurled &&
      !state.isThumbsUp &&
      !state.isThumbsDown;

    // 4. Index Finger Up: Draw continuously
    state.isIndexUp = iExt && !mExt && !rExt && !pExt;

    // 5. Peace Sign: Index + Middle extended, Ring + Pinky curled -> Next Color
    state.isPeaceSign = iExt && mExt && !rExt && !pExt;

    // 6. Three Fingers: Index + Middle + Ring extended, Pinky curled -> Next Brush
    state.isThreeFingers = iExt && mExt && rExt && !pExt;

    // Open Palm: All 5 fingers extended -> Particle Burst
    const tExt = dist(lm[4], lm[9]) > dist(lm[2], lm[9]) * 1.15;
    state.isOpenPalm = iExt && mExt && rExt && pExt && tExt;

    if (landmarksList.length >= 2) {
      const cDist = dist(landmarksList[0][0], landmarksList[1][0]);
      if (lastHandsDistRef.current !== null) {
        if (cDist - lastHandsDistRef.current > 0.085) {
          state.isTwoHandsApart = true;
        }
      }
      lastHandsDistRef.current = cDist;
    } else {
      lastHandsDistRef.current = null;
    }

    return state;
  };

  // -------------------------------------------------------------
  // 6. STROKE RENDERING
  // -------------------------------------------------------------
  const redrawAllStrokes = useCallback(() => {
    const canvas = paintCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = canvasSizeRef.current;
    ctx.clearRect(0, 0, width, height);
    strokesRef.current.forEach((s) => renderStroke(ctx, s));
    if (currentStrokeRef.current) {
      renderStroke(ctx, currentStrokeRef.current);
    }
  }, []);

  const renderStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
    const pts = stroke.points;
    if (pts.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (stroke.brushStyle) {
      case 'neon':
        ctx.strokeStyle = stroke.color;
        ctx.shadowColor = stroke.color;
        ctx.shadowBlur = stroke.size * 2;
        ctx.lineWidth = stroke.size;
        drawSmoothPath(ctx, pts);

        ctx.strokeStyle = '#ffffff';
        ctx.shadowBlur = 0;
        ctx.lineWidth = Math.max(2, stroke.size * 0.28);
        drawSmoothPath(ctx, pts);
        break;

      case 'rainbow':
        for (let i = 1; i < pts.length; i++) {
          const p1 = pts[i - 1];
          const p2 = pts[i];
          const hue = (p1.time * 0.16) % 360;
          ctx.beginPath();
          ctx.strokeStyle = `hsl(${hue}, 100%, 60%)`;
          ctx.shadowColor = `hsl(${hue}, 100%, 50%)`;
          ctx.shadowBlur = stroke.size * 1.5;
          ctx.lineWidth = stroke.size;
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = stroke.size * 0.25;
          ctx.stroke();
        }
        break;

      case 'liquid':
        ctx.shadowBlur = 8;
        ctx.shadowColor = stroke.color;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size * 1.15;
        drawSmoothPath(ctx, pts);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = stroke.size * 0.3;
        drawSmoothPath(ctx, pts);
        break;

      case 'galaxy': {
        const grad = ctx.createLinearGradient(pts[0].x, pts[0].y, pts[pts.length - 1].x, pts[pts.length - 1].y);
        grad.addColorStop(0, '#7928ca');
        grad.addColorStop(0.5, '#ff0080');
        grad.addColorStop(1, '#00dfd8');
        ctx.strokeStyle = grad;
        ctx.shadowColor = '#00dfd8';
        ctx.shadowBlur = stroke.size * 1.8;
        ctx.lineWidth = stroke.size;
        drawSmoothPath(ctx, pts);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = Math.max(2, stroke.size * 0.2);
        drawSmoothPath(ctx, pts);
        break;
      }

      case 'fire':
        ctx.strokeStyle = '#ff3300';
        ctx.shadowColor = '#ff8800';
        ctx.shadowBlur = stroke.size * 2;
        ctx.lineWidth = stroke.size * 1.25;
        drawSmoothPath(ctx, pts);

        ctx.strokeStyle = '#ffcc00';
        ctx.lineWidth = stroke.size * 0.65;
        drawSmoothPath(ctx, pts);

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = stroke.size * 0.2;
        drawSmoothPath(ctx, pts);
        break;
    }
    ctx.restore();
  };

  const drawSmoothPath = (ctx: CanvasRenderingContext2D, pts: Point[]) => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 2) {
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.stroke();
      return;
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
  };

  // -------------------------------------------------------------
  // 7. REALTIME LOOP: GESTURES, OVERLAYS & PARTICLES
  // -------------------------------------------------------------
  useEffect(() => {
    let animId: number;

    const loop = (ts: number) => {
      rainbowHueRef.current = (rainbowHueRef.current + 2) % 360;

      if (
        inputMode === 'hand' &&
        cameraStatus === 'active' &&
        landmarkerRef.current &&
        videoRef.current &&
        videoRef.current.readyState >= 2
      ) {
        try {
          const res: HandLandmarkerResult = landmarkerRef.current.detectForVideo(videoRef.current, ts);
          const lmList = res.landmarks || [];
          const g = analyzeGestures(lmList);
          renderOverlays(lmList, g);
          handleGestures(g, ts);
        } catch {
          // frame skipped
        }
      } else if (inputMode === 'touch') {
        clearOverlays();
      }

      renderParticles();
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [inputMode, cameraStatus, activeBrush, activeColor, brushSize]);

  const addPointToStroke = (x: number, y: number) => {
    const pt: Point = { x, y, time: Date.now() };
    if (!currentStrokeRef.current) {
      undoStackRef.current.push([...strokesRef.current]);
      currentStrokeRef.current = {
        points: [pt],
        color: activeBrush === 'rainbow' ? `hsl(${rainbowHueRef.current}, 100%, 60%)` : activeColor,
        size: brushSize,
        brushStyle: activeBrush,
      };
    } else {
      const pts = currentStrokeRef.current.points;
      const last = pts[pts.length - 1];
      if (Math.hypot(x - last.x, y - last.y) > 2.5) {
        pts.push(pt);
      }
    }
    redrawAllStrokes();
  };

  const finishStroke = () => {
    if (currentStrokeRef.current) {
      strokesRef.current.push(currentStrokeRef.current);
      currentStrokeRef.current = null;
      redrawAllStrokes();
    }
  };

  const handleUndo = () => {
    if (undoStackRef.current.length > 0) {
      strokesRef.current = undoStackRef.current.pop() || [];
      redrawAllStrokes();
      setGestureNotice('↩️ UNDO STROKE');
    }
  };

  const handleClear = () => {
    if (strokesRef.current.length > 0) {
      undoStackRef.current.push([...strokesRef.current]);
      strokesRef.current = [];
      redrawAllStrokes();
      triggerArtworkExplosion();
      setGestureNotice('🗑️ CANVAS CLEARED');
    }
  };

  // Debounced Edge-Triggered Gesture Actions
  const handleGestures = (g: GestureState, time: number) => {
    // 1. Two Hands Moving Apart -> Nova blast (Debounced rising edge)
    if (g.isTwoHandsApart) {
      if (!wasTwoHandsApartRef.current && time - lastSupernovaTimeRef.current > 1800) {
        triggerArtworkExplosion();
        lastSupernovaTimeRef.current = time;
      }
      wasTwoHandsApartRef.current = true;
      return;
    } else {
      wasTwoHandsApartRef.current = false;
    }

    // 2. Thumbs-Up Gesture -> Undo last completed stroke
    // Triggers only once, requires return to neutral before re-triggering, with 1000ms cooldown
    if (g.isThumbsUp) {
      if (!wasThumbsUpRef.current && time - lastUndoGestureTimeRef.current > 1000) {
        if (currentStrokeRef.current) finishStroke();
        handleUndo();
        setGestureNotice('👍 THUMBS-UP: UNDO');
        lastUndoGestureTimeRef.current = time;
        if (g.thumbPos) {
          emitParticles(g.thumbPos.x, g.thumbPos.y, '#00f0ff', 6, 'spark', 3);
        }
      }
      wasThumbsUpRef.current = true;
      return;
    } else {
      // Returned to neutral position (hand released thumbs-up)
      wasThumbsUpRef.current = false;
    }

    // 3. Thumbs-Down Gesture -> Clear entire canvas
    // Triggers only once, requires return to neutral before re-triggering, with 1400ms cooldown
    if (g.isThumbsDown) {
      if (!wasThumbsDownRef.current && time - lastClearGestureTimeRef.current > 1400) {
        if (currentStrokeRef.current) finishStroke();
        handleClear();
        setGestureNotice('👎 THUMBS-DOWN: CLEAR CANVAS');
        lastClearGestureTimeRef.current = time;
        if (g.thumbPos) {
          emitParticles(g.thumbPos.x, g.thumbPos.y, '#ff0077', 8, 'spark', 3.5);
        }
      }
      wasThumbsDownRef.current = true;
      return;
    } else {
      // Returned to neutral position (hand released thumbs-down)
      wasThumbsDownRef.current = false;
    }

    // 4. Open Palm -> Particle burst (Debounced rising edge)
    if (g.isOpenPalm && g.palmPos) {
      if (!wasOpenPalmRef.current && time - lastPalmBurstTimeRef.current > 1400) {
        triggerPalmBurst(g.palmPos.x, g.palmPos.y);
        lastPalmBurstTimeRef.current = time;
      }
      wasOpenPalmRef.current = true;
      if (currentStrokeRef.current) finishStroke();
      return;
    } else {
      wasOpenPalmRef.current = false;
    }

    // 5. Fist -> Pause immediately
    if (g.isFist) {
      setGestureNotice('✊ PAUSED (Closed Fist)');
      if (currentStrokeRef.current) finishStroke();
      return;
    }

    // 6. Peace Sign (Index + Middle extended) -> Change to next colour in palette
    // Triggers only once, requires return to neutral before re-triggering, with 750ms cooldown
    if (g.isPeaceSign) {
      if (!wasPeaceSignRef.current && time - lastColorGestureTimeRef.current > 750) {
        if (currentStrokeRef.current) finishStroke();
        const curIdx = PRESET_COLORS.indexOf(activeColorRef.current);
        const nextIdx = (curIdx + 1) % PRESET_COLORS.length;
        const newColor = PRESET_COLORS[nextIdx];
        activeColorRef.current = newColor;
        setActiveColor(newColor);
        setGestureNotice(`✌️ COLOR: ${COLOR_NAMES[newColor] || newColor}`);
        lastColorGestureTimeRef.current = time;
        if (g.indexPos) {
          emitParticles(g.indexPos.x, g.indexPos.y, newColor, 8, 'spark', 3.5);
        }
      }
      wasPeaceSignRef.current = true;
      return;
    } else {
      // Returned to neutral position resets the latch
      wasPeaceSignRef.current = false;
    }

    // 7. Three Fingers (Index + Middle + Ring extended) -> Change to next brush style
    // Triggers only once, requires return to neutral before re-triggering, with 750ms cooldown
    if (g.isThreeFingers) {
      if (!wasThreeFingersRef.current && time - lastBrushGestureTimeRef.current > 750) {
        if (currentStrokeRef.current) finishStroke();
        const curIdx = BRUSH_STYLES.findIndex((b) => b.id === activeBrushRef.current);
        const nextIdx = (curIdx + 1) % BRUSH_STYLES.length;
        const newBrush = BRUSH_STYLES[nextIdx];
        activeBrushRef.current = newBrush.id;
        setActiveBrush(newBrush.id);
        setGestureNotice(`🤟 BRUSH: ${newBrush.name.toUpperCase()} ${newBrush.icon}`);
        lastBrushGestureTimeRef.current = time;
        if (g.indexPos) {
          const pType = newBrush.id === 'fire' ? 'ember' : newBrush.id === 'liquid' ? 'bubble' : 'star';
          emitParticles(g.indexPos.x, g.indexPos.y, activeColorRef.current, 8, pType, 3.5);
        }
      }
      wasThreeFingersRef.current = true;
      return;
    } else {
      // Returned to neutral position resets the latch
      wasThreeFingersRef.current = false;
    }

    // 8. Index Up -> Fluid Neon Drawing (Continuous with index fingertip)
    if (g.isIndexUp && g.indexPos) {
      setGestureNotice('☝️ DRAWING');
      addPointToStroke(g.indexPos.x, g.indexPos.y);
      const pCol =
        activeBrushRef.current === 'rainbow'
          ? `hsl(${rainbowHueRef.current}, 100%, 60%)`
          : activeColorRef.current;
      const pTyp =
        activeBrushRef.current === 'fire' ? 'ember' : activeBrushRef.current === 'liquid' ? 'bubble' : 'spark';
      emitParticles(g.indexPos.x, g.indexPos.y, pCol, 2, pTyp, 2);
    } else {
      // Stop drawing immediately when index finger is no longer raised
      if (currentStrokeRef.current) finishStroke();
      if (
        !g.isOpenPalm &&
        !g.isFist &&
        !g.isThumbsUp &&
        !g.isThumbsDown &&
        !g.isPeaceSign &&
        !g.isThreeFingers
      ) {
        setGestureNotice(g.handCount > 0 ? '✋ HAND TRACKED' : '👀 WAITING FOR HAND');
      }
    }
  };

  const clearOverlays = () => {
    const canvas = cursorCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvasSizeRef.current.width, canvasSizeRef.current.height);
  };

  const renderOverlays = (lmList: any[], g: GestureState) => {
    const canvas = cursorCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = canvasSizeRef.current;
    ctx.clearRect(0, 0, width, height);
    if (lmList.length === 0) return;

    const bones = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [0, 9], [9, 10], [10, 11], [11, 12],
      [0, 13], [13, 14], [14, 15], [15, 16],
      [0, 17], [17, 18], [18, 19], [19, 20],
      [5, 9], [9, 13], [13, 17],
    ];

    lmList.forEach((lm) => {
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
      ctx.lineWidth = 1.6;
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 4;
      bones.forEach(([i, j]) => {
        ctx.beginPath();
        ctx.moveTo((1 - lm[i].x) * width, lm[i].y * height);
        ctx.lineTo((1 - lm[j].x) * width, lm[j].y * height);
        ctx.stroke();
      });
      lm.forEach((pt: any, idx: number) => {
        ctx.beginPath();
        ctx.arc((1 - pt.x) * width, pt.y * height, idx === 8 ? 4.5 : 2, 0, Math.PI * 2);
        ctx.fillStyle = idx === 8 ? '#ffffff' : 'rgba(0, 240, 255, 0.8)';
        ctx.fill();
      });
      ctx.restore();
    });

    if (g.isIndexUp && g.indexPos) {
      const { x, y } = g.indexPos;
      ctx.save();
      ctx.translate(x, y);
      const pulse = Math.sin(Date.now() * 0.009) * 3;
      const r = brushSize / 2 + 8 + pulse;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = activeColorRef.current;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = activeColorRef.current;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
    }

    // Visual indicator for Peace Sign (Change Colour)
    if (g.isPeaceSign && g.indexPos) {
      const { x, y } = g.indexPos;
      ctx.save();
      ctx.translate(x, y - 26);
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.fillStyle = activeColorRef.current + '40';
      ctx.strokeStyle = activeColorRef.current;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = activeColorRef.current;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.stroke();

      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✌️', 0, 0);
      ctx.restore();
    }

    // Visual indicator for Three Fingers (Change Brush)
    if (g.isThreeFingers && g.indexPos) {
      const { x, y } = g.indexPos;
      ctx.save();
      ctx.translate(x, y - 26);
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 230, 0, 0.3)';
      ctx.strokeStyle = '#ffe600';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#ffe600';
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.stroke();

      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🤟', 0, 0);
      ctx.restore();
    }

    // Visual indicator for Closed Fist (Pause)
    if (g.isFist && g.palmPos) {
      const { x, y } = g.palmPos;
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.stroke();

      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✊', 0, 0);
      ctx.restore();
    }

    // Visual indicator for Thumbs Up / Down gestures
    if ((g.isThumbsUp || g.isThumbsDown) && g.thumbPos) {
      const { x, y } = g.thumbPos;
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.fillStyle = g.isThumbsUp ? 'rgba(0, 240, 255, 0.25)' : 'rgba(255, 0, 119, 0.25)';
      ctx.strokeStyle = g.isThumbsUp ? '#00f0ff' : '#ff0077';
      ctx.lineWidth = 2;
      ctx.shadowColor = g.isThumbsUp ? '#00f0ff' : '#ff0077';
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.stroke();

      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(g.isThumbsUp ? '👍' : '👎', 0, 0);
      ctx.restore();
    }
  };

  const renderParticles = () => {
    const canvas = fxCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = canvasSizeRef.current;
    ctx.clearRect(0, 0, width, height);

    for (let i = particlesRef.current.length - 1; i >= 0; i--) {
      const p = particlesRef.current[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= p.decay;
      p.life -= p.decay;

      if (p.alpha <= 0 || p.life <= 0) {
        particlesRef.current.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;

      if (p.type === 'star') {
        ctx.translate(p.x, p.y);
        ctx.beginPath();
        for (let j = 0; j < 4; j++) {
          ctx.rotate(Math.PI / 2);
          ctx.lineTo(p.size * 2, 0);
          ctx.lineTo(p.size * 0.4, p.size * 0.4);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  };

  // -------------------------------------------------------------
  // 8. TOUCH & POINTER CONTROLS (RESPONSIVE FALLBACK)
  // -------------------------------------------------------------
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (inputMode !== 'touch') return;
    isPointerDownRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    addPointToStroke(x, y);
    emitParticles(x, y, activeColor, 4, 'spark', 3);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (inputMode !== 'touch' || !isPointerDownRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    addPointToStroke(x, y);
    const pCol = activeBrush === 'rainbow' ? `hsl(${rainbowHueRef.current}, 100%, 60%)` : activeColor;
    emitParticles(x, y, pCol, 1, 'spark', 1.8);
  };

  const handlePointerUp = () => {
    if (inputMode !== 'touch') return;
    isPointerDownRef.current = false;
    finishStroke();
  };

  // -------------------------------------------------------------
  // 9. EXPORT ARTWORK
  // -------------------------------------------------------------

  const handleSave = () => {
    const paint = paintCanvasRef.current;
    if (!paint) return;
    const exp = document.createElement('canvas');
    exp.width = paint.width;
    exp.height = paint.height;
    const ctx = exp.getContext('2d');
    if (!ctx) return;

    // Dark starry background
    const grad = ctx.createLinearGradient(0, 0, 0, exp.height);
    grad.addColorStop(0, '#060714');
    grad.addColorStop(0.5, '#0c0f24');
    grad.addColorStop(1, '#05060f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, exp.width, exp.height);

    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.7 + 0.2})`;
      ctx.beginPath();
      ctx.arc(Math.random() * exp.width, Math.random() * exp.height, Math.random() * 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.drawImage(paint, 0, 0);
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillText('✨ MAGIC PAINT STUDIO', 24, exp.height - 28);

    const a = document.createElement('a');
    a.download = `magic-paint-${Date.now()}.png`;
    a.href = exp.toDataURL('image/png');
    a.click();
    setGestureNotice('💾 ARTWORK SAVED');
  };

  // -------------------------------------------------------------
  // 10. CAMERA VISIBILITY TOGGLE (0%, 50%, 80%)
  // -------------------------------------------------------------
  const cycleCameraVisibility = () => {
    // Current states:
    // If >= 0.7 (default 0.75 or 0.8) -> cycle to 0
    // If 0 -> cycle to 0.5
    // If 0.5 -> cycle to 0.8
    const next = cameraOpacity >= 0.7 ? 0 : cameraOpacity === 0 ? 0.5 : 0.8;
    setCameraOpacity(next);
    setGestureNotice(`Camera visibility: ${Math.round(next * 100)}%`);
  };

  return (
    <div className="min-h-screen w-full bg-[#030408] flex items-center justify-center p-0 sm:p-4 select-none overflow-hidden font-sans text-white">
      {/* 390 × 844 Mobile Studio Viewport Frame (Responsive on mobile, device bezel on desktop) */}
      <div
        ref={stageRef}
        className="relative w-full h-[100dvh] sm:h-[844px] sm:w-[390px] sm:max-h-[844px] sm:rounded-[44px] bg-[#070913] border-0 sm:border-[5px] sm:border-[#1e2238] shadow-[0_0_60px_rgba(0,240,255,0.18)] overflow-hidden flex flex-col justify-between"
      >
        {/* Dynamic Island Notch */}
        <div className="absolute top-0 inset-x-0 z-40 flex justify-center pt-2 pointer-events-none">
          <div className="w-32 h-5 bg-black/80 backdrop-blur-md rounded-full flex items-center justify-around px-3 border border-white/10 shadow-lg">
            <div
              className={`w-2 h-2 rounded-full ${
                cameraStatus === 'active' ? 'bg-emerald-400 animate-pulse' : 'bg-cyan-400'
              }`}
            />
            <span className="text-[9px] tracking-wider text-cyan-300 font-mono">
              {cameraStatus === 'active' ? 'TRACKING ON' : 'MAGIC STUDIO'}
            </span>
            <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
          </div>
        </div>

        {/* ----------------- TOP STATUS & CONTROLS HUD ----------------- */}
        <header className="relative z-30 pt-9 px-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-cyan-500/30">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-xs font-black tracking-wider bg-gradient-to-r from-cyan-400 via-pink-400 to-amber-300 bg-clip-text text-transparent">
                MAGIC PAINT
              </h1>
              <p className="text-[9px] text-gray-400 font-mono tracking-tighter">
                {inputMode === 'hand' ? 'AI HAND TRACKING' : 'TOUCH / MOUSE MODE'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 bg-black/50 backdrop-blur-md p-1 rounded-2xl border border-white/10 shadow-lg">
            {cameraStatus === 'active' ? (
              <button
                onClick={handleStopCamera}
                className="px-2 py-1 text-[10px] rounded-xl font-bold bg-red-500/25 text-red-300 border border-red-500/40 hover:bg-red-500/40 flex items-center space-x-1 transition"
              >
                <CameraOff className="w-3 h-3 inline" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                onClick={handleStartCamera}
                disabled={cameraStatus === 'requesting'}
                className="px-2.5 py-1 text-[10px] rounded-xl font-bold bg-cyan-500 text-black shadow-md shadow-cyan-500/40 hover:bg-cyan-400 active:scale-95 transition flex items-center space-x-1"
              >
                <Camera className="w-3 h-3 inline text-black" />
                <span>{cameraStatus === 'requesting' ? 'Starting...' : 'Start Cam'}</span>
              </button>
            )}

            <button
              onClick={() => {
                const next = inputMode === 'hand' ? 'touch' : 'hand';
                setInputMode(next);
                setGestureNotice(next === 'hand' ? 'Hand Tracking ON' : 'Touch/Mouse ON');
              }}
              title="Toggle Hand/Touch Mode"
              className={`px-2 py-1 text-[10px] rounded-xl font-medium transition-all flex items-center space-x-1 ${
                inputMode === 'touch' ? 'bg-white/20 text-white font-bold' : 'text-gray-400 hover:text-white'
              }`}
            >
              {inputMode === 'touch' ? <MousePointer className="w-3 h-3" /> : <Hand className="w-3 h-3" />}
              <span>{inputMode === 'touch' ? 'Touch' : 'Hand'}</span>
            </button>

            <button
              onClick={() => setShowHelp(!showHelp)}
              className="w-6 h-6 rounded-xl bg-white/10 flex items-center justify-center text-xs hover:bg-white/20 active:scale-90 transition text-gray-300"
              title="Gesture Guide"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        {/* Gesture Notification Banner */}
        <div className="relative z-30 flex justify-center mt-1 pointer-events-none px-4">
          <div className="px-3 py-0.5 rounded-full bg-black/65 backdrop-blur-md border border-cyan-500/30 text-[10px] font-mono text-cyan-300 shadow-[0_0_12px_rgba(0,240,255,0.2)] truncate max-w-full">
            {gestureNotice}
          </div>
        </div>

        {/* ----------------- CANVAS & VIDEO WORKSPACE ----------------- */}
        <div
          className="absolute inset-0 z-0 touch-none cursor-crosshair overflow-hidden"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {/* Live camera video feed with natural brightness and skin tones */}
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="absolute inset-0 w-full h-full object-cover -scale-x-100 transition-opacity duration-300 pointer-events-none"
            style={{
              opacity: cameraOpacity,
              filter: 'contrast(1.05) brightness(1.05) saturate(1.08)',
            }}
          />

          {/* Reduced dark radial gradient overlay (subtle 0.12 center, 0.25 edge) */}
          <div
            className="absolute inset-0 pointer-events-none transition-all duration-300"
            style={{
              background:
                cameraOpacity === 0
                  ? 'radial-gradient(circle at 50% 35%, rgba(13, 20, 48, 1) 0%, rgba(5, 7, 16, 1) 100%)'
                  : 'radial-gradient(circle at 50% 35%, rgba(13, 20, 48, 0.12) 0%, rgba(5, 7, 16, 0.25) 100%)',
            }}
          />

          <canvas ref={paintCanvasRef} className="absolute inset-0 pointer-events-none" />
          <canvas ref={fxCanvasRef} className="absolute inset-0 pointer-events-none" />
          <canvas ref={cursorCanvasRef} className="absolute inset-0 pointer-events-none" />
        </div>


        {/* ----------------- FLOATING ACTION DOCK (LEFT) ----------------- */}
        <div className="absolute left-3 top-28 z-30 flex flex-col space-y-2 pointer-events-auto">
          {/* Undo */}
          <button
            onClick={handleUndo}
            title="Undo"
            className="w-9 h-9 rounded-2xl bg-black/60 backdrop-blur-lg border border-white/15 flex items-center justify-center text-gray-200 hover:text-white active:scale-90 shadow-lg transition"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Clear */}
          <button
            onClick={handleClear}
            title="Clear Canvas"
            className="w-9 h-9 rounded-2xl bg-black/60 backdrop-blur-lg border border-white/15 flex items-center justify-center text-red-400 hover:text-red-300 active:scale-90 shadow-lg transition"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {/* Camera Visibility Toggle (cycles 0%, 50%, 80%) */}
          <button
            onClick={cycleCameraVisibility}
            title={`Camera Visibility: ${Math.round(cameraOpacity * 100)}% (Click to cycle 0%, 50%, 80%)`}
            className="w-9 h-9 rounded-2xl bg-black/60 backdrop-blur-lg border border-white/15 flex items-center justify-center text-cyan-400 hover:text-cyan-300 active:scale-90 shadow-lg transition"
          >
            <Eye className="w-4 h-4" />
          </button>

          {/* Save PNG */}
          <button
            onClick={handleSave}
            title="Save PNG"
            className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 border border-white/30 flex items-center justify-center text-white active:scale-90 shadow-lg shadow-cyan-500/30 transition"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>

        {/* ----------------- GESTURE HELP MODAL ----------------- */}
        {showHelp && (
          <div className="absolute inset-x-3 top-20 z-50 bg-[#0c1020]/95 backdrop-blur-2xl border border-cyan-500/30 rounded-3xl p-4 shadow-2xl animate-in fade-in duration-200">
            <div className="flex justify-between items-center mb-2.5">
              <h2 className="text-xs font-bold text-cyan-300 flex items-center space-x-1.5">
                <span>⚡</span>
                <span>MAGIC STUDIO GESTURES</span>
              </h2>
              <button
                onClick={() => setShowHelp(false)}
                className="w-5 h-5 rounded-full bg-white/10 text-gray-400 hover:text-white flex items-center justify-center text-[10px]"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="space-y-1.5 text-[11px] text-gray-300">
              <div className="flex items-center space-x-2 bg-white/5 p-1.5 rounded-xl">
                <span className="text-base">☝️</span>
                <div>
                  <strong className="text-white">Index Up:</strong> Draw continuously with fingertip
                </div>
              </div>
              <div className="flex items-center space-x-2 bg-white/5 p-1.5 rounded-xl">
                <span className="text-base">✊</span>
                <div>
                  <strong className="text-white">Closed Fist:</strong> Pause drawing immediately
                </div>
              </div>
              <div className="flex items-center space-x-2 bg-white/5 p-1.5 rounded-xl">
                <span className="text-base">👍</span>
                <div>
                  <strong className="text-white">Thumbs Up:</strong> Undo last completed stroke
                </div>
              </div>
              <div className="flex items-center space-x-2 bg-white/5 p-1.5 rounded-xl">
                <span className="text-base">👎</span>
                <div>
                  <strong className="text-white">Thumbs Down:</strong> Clear entire canvas
                </div>
              </div>
              <div className="flex items-center space-x-2 bg-white/5 p-1.5 rounded-xl">
                <span className="text-base">✌️</span>
                <div>
                  <strong className="text-white">Peace Sign:</strong> Change to next colour in palette
                </div>
              </div>
              <div className="flex items-center space-x-2 bg-white/5 p-1.5 rounded-xl">
                <span className="text-base">🤟</span>
                <div>
                  <strong className="text-white">Three Fingers:</strong> Change to next brush style
                </div>
              </div>
              <div className="flex items-center space-x-2 bg-white/5 p-1.5 rounded-xl">
                <span className="text-base">👐</span>
                <div>
                  <strong className="text-white">Hands Apart:</strong> Supernova particle blast
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ----------------- BOTTOM CREATIVE STUDIO BAR ----------------- */}
        <footer className="relative z-30 pb-5 px-3 pt-2 flex flex-col space-y-1.5 pointer-events-auto">
          {/* Color & Size Strip */}
          <div className="flex items-center justify-between bg-black/65 backdrop-blur-xl border border-white/15 px-2.5 py-1.5 rounded-2xl shadow-xl">
            <span className="text-[9px] font-mono text-gray-400">COLOR</span>
            <div className="flex items-center space-x-1.5">
              {PRESET_COLORS.map((col) => (
                <button
                  key={col}
                  onClick={() => setActiveColor(col)}
                  className={`w-5 h-5 rounded-full transition-transform ${
                    activeColor === col ? 'scale-125 ring-2 ring-white ring-offset-1 ring-offset-black' : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: col, boxShadow: `0 0 8px ${col}66` }}
                />
              ))}
            </div>
            <div className="flex items-center space-x-1 pl-1.5 border-l border-white/10">
              {BRUSH_SIZES.map((b) => (
                <button
                  key={b.size}
                  onClick={() => setBrushSize(b.size)}
                  className={`px-1 py-0.5 rounded text-[9px] font-bold ${
                    brushSize === b.size ? 'bg-cyan-400 text-black' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          {/* Brushes Bar */}
          <div className="grid grid-cols-5 gap-1 bg-black/65 backdrop-blur-xl border border-white/15 p-1 rounded-2xl shadow-xl">
            {BRUSH_STYLES.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  setActiveBrush(b.id);
                  setGestureNotice(`Brush: ${b.name.toUpperCase()}`);
                }}
                className={`flex flex-col items-center py-1 rounded-xl transition-all ${
                  activeBrush === b.id
                    ? 'bg-gradient-to-b from-white/20 to-white/5 border border-cyan-400 text-cyan-300 shadow-[0_0_10px_rgba(0,240,255,0.3)]'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <span className="text-xs">{b.icon}</span>
                <span className="text-[8px] font-semibold tracking-tight mt-0.5">{b.name}</span>
              </button>
            ))}
          </div>
        </footer>

        {/* ----------------- MODEL LOADING OVERLAY ----------------- */}
        {isModelLoading && (
          <div className="absolute inset-0 z-50 bg-black/85 backdrop-blur-lg flex flex-col items-center justify-center p-6 text-center">
            <div className="w-12 h-12 rounded-full border-4 border-cyan-500/20 border-t-cyan-400 animate-spin mb-3" />
            <h2 className="text-sm font-bold text-white tracking-wide">INITIALIZING AI VISION</h2>
            <p className="text-[11px] text-cyan-300/80 mt-1 max-w-[220px]">
              Loading MediaPipe Hand Landmarker neural model...
            </p>
          </div>
        )}

        {/* ----------------- CAMERA ERROR MESSAGE ----------------- */}
        {cameraErrorMsg && (
          <div className="absolute top-16 inset-x-3 z-40 bg-amber-500/20 backdrop-blur-md border border-amber-500/40 rounded-2xl p-2.5 flex items-start space-x-2 text-left">
            <span className="text-amber-400 text-sm">⚠️</span>
            <div className="flex-1">
              <p className="text-[11px] font-medium text-amber-200">{cameraErrorMsg}</p>
              <button
                onClick={() => setCameraErrorMsg(null)}
                className="mt-1 px-2 py-0.5 bg-amber-500/30 text-amber-200 text-[9px] rounded font-mono hover:bg-amber-500/50"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
