import { useRef, useEffect, useCallback, useState } from 'react';
import type { SimConfig } from './simulation/physics';
import { createSystem, stepYoshida, recordTrails, checkDivergence, DEFAULT_CONFIG } from './simulation/physics';
import { initRenderer, render, resetCamera, setRotation, setCameraDistance, setBgMode, setBloomStrength, setStarSpikesVisible, resizeRenderer, disposeRenderer } from './simulation/renderer';
import './App.css';

// ── localStorage helpers ──

const STORAGE_KEY = 'three-body-settings';
const CIV_STORAGE_KEY = 'three-body-civ';

type BgMode = 'nebula' | 'dark' | 'blue' | 'panorama' | 'custom';

interface StoredSettings {
  config: Partial<SimConfig>;
  cameraDistance: number;
  bgMode: BgMode;
  bgCustomColor: string;
  mouseFollow: boolean;
  mouseFollowSpeed: number;
  bloomStrength: number;
  starSpikes: boolean;
}

interface StoredCiv {
  count: number;
}

function loadSettings(): StoredSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveSettings(s: StoredSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* */ }
}

function loadCiv(): StoredCiv {
  try {
    const raw = localStorage.getItem(CIV_STORAGE_KEY);
    return raw ? JSON.parse(raw) : { count: 1 };
  } catch { return { count: 1 }; }
}

function saveCiv(c: StoredCiv) {
  try { localStorage.setItem(CIV_STORAGE_KEY, JSON.stringify(c)); } catch { /* */ }
}

// ── App ──

function App() {
  // Restore persisted settings
  const saved = loadSettings();
  const savedCiv = loadCiv();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bodiesRef = useRef(createSystem({ ...DEFAULT_CONFIG, ...saved?.config }));
  const configRef = useRef<SimConfig>({ ...DEFAULT_CONFIG, ...saved?.config });
  const animRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const [diverged, setDiverged] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [, forceUpdate] = useState(0);
  const divergedRef = useRef(false);

  // Civilization tracking
  const civCountRef = useRef(savedCiv.count);
  const civStartTimeRef = useRef(0);
  const civYearsRef = useRef(0);
  const [civInfo, setCivInfo] = useState({ count: savedCiv.count, years: 0 });
  const CIV_TIME_SCALE = 120;

  // Visual settings refs (restored from localStorage)
  const mouseFollowRef = useRef(saved?.mouseFollow ?? true);
  const mouseFollowSpeedRef = useRef(saved?.mouseFollowSpeed ?? 0.15);
  const bloomStrengthRef = useRef(saved?.bloomStrength ?? 0.8);
  const starSpikesRef = useRef(saved?.starSpikes ?? true);
  const cameraDistanceRef = useRef(saved?.cameraDistance ?? 1.0);
  const bgModeRef = useRef<BgMode>(saved?.bgMode ?? 'panorama');
  const bgCustomColorRef = useRef(saved?.bgCustomColor ?? '#000000');

  // Mouse state
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const rotation = useRef({ x: 0, y: 0 });
  const mousePos = useRef({ x: 0, y: 0 });
  const introRef = useRef(true);
  const introStartRef = useRef(performance.now());

  // Clock refs
  const clockTimeRef = useRef<HTMLSpanElement>(null);
  const clockSecsRef = useRef<HTMLSpanElement>(null);
  const clockDateRef = useRef<HTMLDivElement>(null);

  // Three-body world data refs
  const eraRef = useRef<HTMLSpanElement>(null);
  const eraLabelRef = useRef<HTMLSpanElement>(null);
  const stateRef = useRef<HTMLSpanElement>(null);
  const stateLabelRef = useRef<HTMLSpanElement>(null);
  const tempRef = useRef<HTMLSpanElement>(null);
  const distAlphaRef = useRef<HTMLDivElement>(null);
  const distBetaRef = useRef<HTMLDivElement>(null);
  const distGammaRef = useRef<HTMLDivElement>(null);
  const distAlphaValRef = useRef<HTMLSpanElement>(null);
  const distBetaValRef = useRef<HTMLSpanElement>(null);
  const distGammaValRef = useRef<HTMLSpanElement>(null);
  const civYearsDisplayRef = useRef<HTMLSpanElement>(null);

  // Persist all settings to localStorage
  const persistSettings = useCallback(() => {
    saveSettings({
      config: configRef.current,
      cameraDistance: cameraDistanceRef.current,
      bgMode: bgModeRef.current,
      bgCustomColor: bgCustomColorRef.current,
      mouseFollow: mouseFollowRef.current,
      mouseFollowSpeed: mouseFollowSpeedRef.current,
      bloomStrength: bloomStrengthRef.current,
      starSpikes: starSpikesRef.current,
    });
  }, []);

  const resetSim = useCallback(() => {
    bodiesRef.current = createSystem(configRef.current);
    resetCamera();
    rotation.current = { x: 0, y: 0 };
    setRotation(0, 0);
    setDiverged(false);
    divergedRef.current = false;
    timeRef.current = 0;
    introRef.current = true;
    introStartRef.current = performance.now();
    civCountRef.current += 1;
    civStartTimeRef.current = 0;
    setCivInfo({ count: civCountRef.current, years: 0 });
    saveCiv({ count: civCountRef.current });
  }, []);

  const resetConfig = useCallback(() => {
    configRef.current = { ...DEFAULT_CONFIG };
    mouseFollowRef.current = true;
    mouseFollowSpeedRef.current = 0.15;
    bloomStrengthRef.current = 0.8;
    starSpikesRef.current = true;
    cameraDistanceRef.current = 1.0;
    bgModeRef.current = 'panorama';
    bgCustomColorRef.current = '#000000';
    setCameraDistance(1.0);
    setBgMode('panorama');
    setBloomStrength(0.8);
    setStarSpikesVisible(true);
    civCountRef.current = 1;
    setCivInfo({ count: 1, years: 0 });
    saveCiv({ count: 1 });
    persistSettings();
    // Reset simulation with new defaults
    bodiesRef.current = createSystem(configRef.current);
    resetCamera();
    rotation.current = { x: 0, y: 0 };
    setRotation(0, 0);
    setDiverged(false);
    divergedRef.current = false;
    timeRef.current = 0;
    introRef.current = true;
    introStartRef.current = performance.now();
    civStartTimeRef.current = 0;
    forceUpdate(n => n + 1);
  }, [persistSettings]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    initRenderer(canvas);
    resizeRenderer(window.innerWidth, window.innerHeight);

    // Apply restored visual settings
    setCameraDistance(cameraDistanceRef.current);
    setBgMode(bgModeRef.current, bgCustomColorRef.current);
    setBloomStrength(bloomStrengthRef.current);
    setStarSpikesVisible(starSpikesRef.current);

    let lastTime = performance.now();

    const resize = () => resizeRenderer(window.innerWidth, window.innerHeight);
    window.addEventListener('resize', resize);

    const loop = (now: number) => {
      const frametime = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      timeRef.current += frametime;

      // Mouse-follow rotation (when enabled and not dragging)
      if (mouseFollowRef.current && !isDragging.current) {
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        const dx = (mousePos.current.x - centerX) / window.innerWidth;
        const dy = (mousePos.current.y - centerY) / window.innerHeight;
        rotation.current.x += dx * mouseFollowSpeedRef.current;
        rotation.current.y += dy * mouseFollowSpeedRef.current;
        setRotation(rotation.current.x, rotation.current.y);
      }

      // Intro delay
      const introElapsed = (performance.now() - introStartRef.current) / 1000;
      if (introElapsed > 1.5) {
        if (introRef.current) civStartTimeRef.current = timeRef.current;
        introRef.current = false;
      }

      if (!introRef.current && !divergedRef.current) {
        const substeps = 8;
        for (let s = 0; s < substeps; s++) {
          stepYoshida(bodiesRef.current, configRef.current, frametime / substeps);
        }
        recordTrails(bodiesRef.current, configRef.current);
      }

      if (!introRef.current && !divergedRef.current && checkDivergence(bodiesRef.current, configRef.current)) {
        divergedRef.current = true;
        const civDuration = timeRef.current - civStartTimeRef.current;
        civYearsRef.current = Math.round(civDuration * CIV_TIME_SCALE);
        setCivInfo({ count: civCountRef.current, years: civYearsRef.current });
        setDiverged(true);
      }

      render(bodiesRef.current, window.innerWidth, window.innerHeight, timeRef.current);

      // Clock
      const now2 = new Date();
      const hours = String(now2.getHours()).padStart(2, '0');
      const minutes = String(now2.getMinutes()).padStart(2, '0');
      const seconds = String(now2.getSeconds()).padStart(2, '0');
      const dateStr = `${now2.getFullYear()}/${String(now2.getMonth() + 1).padStart(2, '0')}/${String(now2.getDate()).padStart(2, '0')}`;
      if (clockTimeRef.current) clockTimeRef.current.textContent = `${hours}:${minutes}`;
      if (clockSecsRef.current) clockSecsRef.current.textContent = seconds;
      if (clockDateRef.current) clockDateRef.current.textContent = dateStr;

      // World data
      const bodies = bodiesRef.current;
      const planet = bodies[3];
      const d = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
        Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
      const dAlpha = d(planet, bodies[0]);
      const dBeta = d(planet, bodies[1]);
      const dGamma = d(planet, bodies[2]);
      const radiation = bodies[0].mass / (dAlpha * dAlpha + 0.01)
        + bodies[1].mass / (dBeta * dBeta + 0.01)
        + bodies[2].mass / (dGamma * dGamma + 0.01);
      const temperature = -80 + radiation * 3.5;
      const dMean = (dAlpha + dBeta + dGamma) / 3;
      const dVar = ((dAlpha - dMean) ** 2 + (dBeta - dMean) ** 2 + (dGamma - dMean) ** 2) / 3;
      const isStable = dVar / (dMean * dMean + 0.01) < 0.15;
      const isHabitable = temperature > -20 && temperature < 60;

      if (eraRef.current) eraRef.current.textContent = isStable ? 'Stable Era' : 'Chaotic Era';
      if (eraLabelRef.current) {
        eraLabelRef.current.textContent = isStable ? '恒纪元' : '乱纪元';
        eraLabelRef.current.style.color = isStable ? 'rgba(100, 200, 140, 0.8)' : 'rgba(255, 120, 80, 0.8)';
      }
      if (stateRef.current) stateRef.current.textContent = isHabitable ? 'Rehydration' : 'Dehydration';
      if (stateLabelRef.current) {
        stateLabelRef.current.textContent = isHabitable ? '浸泡' : '脱水';
        stateLabelRef.current.style.color = isHabitable ? 'rgba(100, 180, 220, 0.8)' : 'rgba(220, 160, 80, 0.8)';
      }
      if (tempRef.current) {
        tempRef.current.textContent = `${temperature.toFixed(1)}°C`;
        tempRef.current.style.color = temperature > 60 ? 'rgba(255, 120, 80, 0.8)' : temperature < -20 ? 'rgba(100, 160, 255, 0.8)' : 'rgba(200, 220, 200, 0.7)';
      }
      const maxDist = 5;
      const pct = (v: number) => Math.min(v / maxDist, 1) * 100;
      if (distAlphaRef.current) distAlphaRef.current.style.width = `${pct(dAlpha)}%`;
      if (distBetaRef.current) distBetaRef.current.style.width = `${pct(dBeta)}%`;
      if (distGammaRef.current) distGammaRef.current.style.width = `${pct(dGamma)}%`;
      if (distAlphaValRef.current) distAlphaValRef.current.textContent = dAlpha.toFixed(2);
      if (distBetaValRef.current) distBetaValRef.current.textContent = dBeta.toFixed(2);
      if (distGammaValRef.current) distGammaValRef.current.textContent = dGamma.toFixed(2);

      if (!introRef.current && !divergedRef.current && civYearsDisplayRef.current) {
        const years = Math.round((timeRef.current - civStartTimeRef.current) * CIV_TIME_SCALE);
        civYearsDisplayRef.current.textContent = `${years.toLocaleString()} 年`;
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);

    // Mouse handlers
    const onMouseDown = (e: MouseEvent) => { isDragging.current = true; lastMouse.current = { x: e.clientX, y: e.clientY }; };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      rotation.current.x += (e.clientX - lastMouse.current.x) * 0.3;
      rotation.current.y += (e.clientY - lastMouse.current.y) * 0.3;
      setRotation(rotation.current.x, rotation.current.y);
      lastMouse.current = { x: e.clientX, y: e.clientY };
    };
    const onMouseUp = () => { isDragging.current = false; };
    const onMouseMoveGlobal = (e: MouseEvent) => { mousePos.current = { x: e.clientX, y: e.clientY }; };

    window.addEventListener('mousemove', onMouseMoveGlobal);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    // Touch handlers
    const onTouchStart = (e: TouchEvent) => { isDragging.current = true; lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging.current) return;
      e.preventDefault();
      rotation.current.x += (e.touches[0].clientX - lastMouse.current.x) * 0.3;
      rotation.current.y += (e.touches[0].clientY - lastMouse.current.y) * 0.3;
      setRotation(rotation.current.x, rotation.current.y);
      lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onTouchEnd = () => { isDragging.current = false; };

    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMoveGlobal);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      disposeRenderer();
    };
  }, [resetSim]);

  const cfg = configRef.current;

  const updateConfig = useCallback((key: keyof SimConfig, value: number | boolean) => {
    (configRef.current as unknown as Record<string, unknown>)[key] = value;
    if (key === 'trailLength' && typeof value === 'number') {
      bodiesRef.current.forEach(b => {
        if (b.trail.length > value) b.trail.splice(0, b.trail.length - value);
      });
    }
    persistSettings();
    forceUpdate(n => n + 1);
  }, [persistSettings]);

  return (
    <div className="app">
      <canvas ref={canvasRef} className="sim-canvas" />

      {/* Clock */}
      <div className="clock-overlay">
        <span ref={clockTimeRef} className="clock-time">00:00</span>
        <span ref={clockSecsRef} className="clock-secs">00</span>
        <div ref={clockDateRef} className="clock-date"></div>
      </div>

      {/* Title */}
      <div className="title-overlay">
        <h1>三体问题 | Three-Body</h1>
        <p className="subtitle">实时演算 Real-time Simulation</p>
        <p className="tech-info">Yoshida 4th-order Symplectic Integrator</p>
      </div>

      {/* Left data panel */}
      <div className="data-panel data-panel-left">
        <div className="data-row">
          <span ref={eraLabelRef} className="data-label-zh">恒纪元</span>
          <span ref={eraRef} className="data-value-en">Stable Era</span>
        </div>
        <div className="data-row">
          <span className="data-label-small">State：</span>
          <span ref={stateLabelRef} className="data-label-zh">浸泡</span>
          <span ref={stateRef} className="data-value-en">Rehydration</span>
        </div>
        <div className="data-row">
          <span className="data-label-small">Temperature：</span>
          <span ref={tempRef} className="data-value-temp">22.0°C</span>
        </div>
      </div>

      {/* Right data panel */}
      <div className="data-panel data-panel-right">
        {[['α', distAlphaRef, distAlphaValRef, 'dist-alpha'],
          ['β', distBetaRef, distBetaValRef, 'dist-beta'],
          ['γ', distGammaRef, distGammaValRef, 'dist-gamma']] .map(([label, barRef, valRef, cls]) => (
          <div className="dist-row" key={label as string}>
            <span className="dist-label">{label as string}</span>
            <div className="dist-bar-track">
              <div ref={barRef as React.Ref<HTMLDivElement>} className={`dist-bar-fill ${cls}`} style={{ width: '50%' }}></div>
            </div>
            <span ref={valRef as React.Ref<HTMLSpanElement>} className="dist-val">0.00</span>
          </div>
        ))}
      </div>

      {/* Info panel (above era panel) */}
      <div className="data-panel data-panel-left" style={{ bottom: 200 }}>
        <div className="info-row"><span className="info-label">文明</span><span className="info-value">第 {civInfo.count} 号</span></div>
        <div className="info-row"><span className="info-label">存续</span><span ref={civYearsDisplayRef} className="info-value">0 年</span></div>
        <div className="info-row"><span className="info-label">天体</span><span className="info-value">3 恒星 + 1 行星</span></div>
      </div>

      {/* Drawer toggle (hidden when drawer open) */}
      {!drawerOpen && (
        <button className="drawer-toggle-btn" onClick={() => setDrawerOpen(true)} title="设置">⚙</button>
      )}

      {/* Settings drawer */}
      <div className={`drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <span>设置 | Settings</span>
          <button className="drawer-close" onClick={() => setDrawerOpen(false)}>✕</button>
        </div>
        <div className="drawer-content">
          {/* Quick actions */}
          <div className="drawer-actions">
            <button onClick={resetSim}>↻ 重置</button>
          </div>

          {/* Simulation */}
          <div className="drawer-group">
            <div className="drawer-group-title">模拟 / Simulation</div>
            <div className="slider-row">
              <label className="slider-label">时间尺度</label>
              <input type="range" className="slider-input" min={0.5} max={10} step={0.1}
                value={cfg.timeScale} onChange={e => updateConfig('timeScale', Number(e.target.value))} />
              <span className="slider-value">{cfg.timeScale.toFixed(1)}</span>
            </div>
            <div className="slider-row">
              <label className="slider-label">轨迹长度</label>
              <input type="range" className="slider-input" min={50} max={800} step={10}
                value={cfg.trailLength} onChange={e => updateConfig('trailLength', Number(e.target.value))} />
              <span className="slider-value">{cfg.trailLength}</span>
            </div>
            <div className="checkbox-row">
              <input type="checkbox" id="trailEnabled" checked={cfg.trailEnabled}
                onChange={e => updateConfig('trailEnabled', e.target.checked)} />
              <label htmlFor="trailEnabled">显示轨迹 Trail</label>
            </div>
          </div>

          {/* Body Mass */}
          <div className="drawer-group">
            <div className="drawer-group-title">天体质量 / Body Mass</div>
            {(['mass1', 'mass2', 'mass3'] as const).map((key, i) => (
              <div className="slider-row" key={key}>
                <label className="slider-label">恒星{i + 1}</label>
                <input type="range" className="slider-input" min={1} max={50} step={0.5}
                  value={cfg[key]} onChange={e => updateConfig(key, Number(e.target.value))} />
                <span className="slider-value">{cfg[key]}</span>
              </div>
            ))}
            <div className="slider-row">
              <label className="slider-label">行星</label>
              <input type="range" className="slider-input" min={0.001} max={1} step={0.001}
                value={cfg.fourthMass} onChange={e => updateConfig('fourthMass', Number(e.target.value))} />
              <span className="slider-value">{cfg.fourthMass.toFixed(3)}</span>
            </div>
          </div>

          {/* Visual */}
          <div className="drawer-group">
            <div className="drawer-group-title">视觉 / Visual</div>
            <div className="checkbox-row">
              <input type="checkbox" id="mouseFollow" checked={mouseFollowRef.current}
                onChange={e => { mouseFollowRef.current = e.target.checked; persistSettings(); forceUpdate(n => n + 1); }} />
              <label htmlFor="mouseFollow">光标跟随旋转</label>
            </div>
            {mouseFollowRef.current && (
              <div className="slider-row">
                <label className="slider-label">跟随速度</label>
                <input type="range" className="slider-input" min={0.02} max={0.5} step={0.01}
                  value={mouseFollowSpeedRef.current}
                  onChange={e => { mouseFollowSpeedRef.current = Number(e.target.value); persistSettings(); forceUpdate(n => n + 1); }} />
                <span className="slider-value">{mouseFollowSpeedRef.current.toFixed(2)}</span>
              </div>
            )}
            <div className="slider-row">
              <label className="slider-label">辉光强度</label>
              <input type="range" className="slider-input" min={0} max={3} step={0.1}
                value={bloomStrengthRef.current}
                onChange={e => { bloomStrengthRef.current = Number(e.target.value); setBloomStrength(bloomStrengthRef.current); persistSettings(); forceUpdate(n => n + 1); }} />
              <span className="slider-value">{bloomStrengthRef.current.toFixed(1)}</span>
            </div>
            <div className="checkbox-row">
              <input type="checkbox" id="starSpikes" checked={starSpikesRef.current}
                onChange={e => { starSpikesRef.current = e.target.checked; setStarSpikesVisible(e.target.checked); persistSettings(); forceUpdate(n => n + 1); }} />
              <label htmlFor="starSpikes">恒星星芒 Spikes</label>
            </div>
          </div>

          {/* Camera */}
          <div className="drawer-group">
            <div className="drawer-group-title">视角 / Camera</div>
            <div className="slider-row">
              <label className="slider-label">距离</label>
              <input type="range" className="slider-input" min={0.3} max={3.0} step={0.1}
                value={cameraDistanceRef.current}
                onChange={e => { cameraDistanceRef.current = Number(e.target.value); setCameraDistance(cameraDistanceRef.current); persistSettings(); forceUpdate(n => n + 1); }} />
              <span className="slider-value">{cameraDistanceRef.current.toFixed(1)}</span>
            </div>
          </div>

          {/* Background */}
          <div className="drawer-group">
            <div className="drawer-group-title">背景 / Background</div>
            <div className="bg-selector">
              {([['panorama', '实景'], ['nebula', '星云'], ['dark', '纯黑'], ['blue', '深蓝'], ['custom', '自定义']] as const).map(([mode, label]) => (
                <button key={mode}
                  className={`bg-option ${bgModeRef.current === mode ? 'active' : ''}`}
                  onClick={() => { bgModeRef.current = mode; setBgMode(mode, bgCustomColorRef.current); persistSettings(); forceUpdate(n => n + 1); }}>
                  {label}
                </button>
              ))}
            </div>
            {bgModeRef.current === 'custom' && (
              <div className="color-picker-row">
                <label className="slider-label">颜色</label>
                <input type="color" value={bgCustomColorRef.current}
                  onChange={e => { bgCustomColorRef.current = e.target.value; setBgMode('custom', e.target.value); persistSettings(); forceUpdate(n => n + 1); }}
                  className="color-input" />
                <span className="slider-value">{bgCustomColorRef.current}</span>
              </div>
            )}
          </div>

          {/* Gravity (advanced) */}
          <div className="drawer-group">
            <div className="drawer-group-title">引力 / Gravity</div>
            <div className="slider-row">
              <label className="slider-label">软化距离</label>
              <input type="range" className="slider-input" min={0.01} max={0.5} step={0.01}
                value={cfg.ras} onChange={e => updateConfig('ras', Number(e.target.value))} />
              <span className="slider-value">{cfg.ras.toFixed(2)}</span>
            </div>
            <div className="slider-row">
              <label className="slider-label">软化倍数</label>
              <input type="range" className="slider-input" min={1.5} max={5} step={0.1}
                value={cfg.kSoft} onChange={e => updateConfig('kSoft', Number(e.target.value))} />
              <span className="slider-value">{cfg.kSoft.toFixed(1)}</span>
            </div>
            <div className="slider-row">
              <label className="slider-label">发散阈值</label>
              <input type="range" className="slider-input" min={3} max={30} step={0.5}
                value={cfg.DD} onChange={e => updateConfig('DD', Number(e.target.value))} />
              <span className="slider-value">{cfg.DD.toFixed(1)}</span>
            </div>
            <div className="slider-row">
              <label className="slider-label">约束力</label>
              <input type="range" className="slider-input" min={0} max={5} step={0.1}
                value={cfg.ky} onChange={e => updateConfig('ky', Number(e.target.value))} />
              <span className="slider-value">{cfg.ky.toFixed(1)}</span>
            </div>
            <div className="slider-row">
              <label className="slider-label">约束距离</label>
              <input type="range" className="slider-input" min={0.5} max={10} step={0.1}
                value={cfg.bz} onChange={e => updateConfig('bz', Number(e.target.value))} />
              <span className="slider-value">{cfg.bz.toFixed(1)}</span>
            </div>
          </div>

          {/* Reset */}
          <button className="drawer-reset" onClick={resetConfig}>恢复默认 | Reset Defaults</button>
        </div>
      </div>

      {/* Divergence */}
      {diverged && (
        <div className="diverge-overlay">
          <div className="diverge-civ-info">
            <div className="diverge-civ-number">第 {civInfo.count} 号文明</div>
            <div className="diverge-civ-years">存续 {civInfo.years.toLocaleString()} 年</div>
            <div className="diverge-civ-fate">系统发散 · 文明毁灭</div>
          </div>
          <button className="diverge-restart" onClick={resetSim}>重启 | Restart</button>
        </div>
      )}
    </div>
  );
}

export default App;
