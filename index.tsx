import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import Chart from 'chart.js/auto';
import { Droplet, Info, Settings, Beaker } from 'lucide-react';

export default function App() {
  // 状態管理
  const [diameter, setDiameter] = useState(1000);
  const [depth, setDepth] = useState(1500);
  const [density, setDensity] = useState(8);
  const [weight, setWeight] = useState(5000);
  const [angle, setAngle] = useState(0);

  // キャンバスの参照
  const threeCanvasRef = useRef(null);
  const chartCanvasRef = useRef(null);
  
  // Three.jsとChart.jsのインスタンス保持用
  const chartInstanceRef = useRef(null);
  const threeStateRef = useRef({ angle: 0, currentHc: 0, scale: 1, currentActualV: 0 });

  // ----------------------------------------------------
  // 物理・幾何計算ロジック
  // ----------------------------------------------------

  // 指定角度で容器が保持できる最大体積 (mm^3)
  const getMaxVolume = (theta_deg, R, H) => {
    if (theta_deg >= 89.999) return 0;
    const theta = (theta_deg * Math.PI) / 180;
    if (theta === 0) return Math.PI * R * R * H;
    
    const tanT = Math.tan(theta);
    const x0 = R - H / tanT; // 底面が露出する境界のX座標
    
    if (x0 <= -R) {
      return Math.PI * R * R * (H - R * tanT);
    } else if (x0 >= R) {
      return 0;
    } else {
      const clamp_x0 = Math.min(R, Math.max(-R, x0));
      const term1 = (H - R * tanT) * (R * R * Math.PI / 2 - (clamp_x0 * Math.sqrt(R * R - clamp_x0 * clamp_x0) + R * R * Math.asin(clamp_x0 / R)));
      const term2 = (2 / 3) * tanT * Math.pow(R * R - clamp_x0 * clamp_x0, 1.5);
      return term1 + term2;
    }
  };

  // 指定した中心高さ(hc)のときの体積 (mm^3)
  const getVolumeFromHc = (hc, theta_deg, R) => {
    const theta = (theta_deg * Math.PI) / 180;
    if (theta === 0) return Math.PI * R * R * Math.max(0, hc);
    
    const tanT = Math.tan(theta);
    const x0 = -hc / tanT;
    
    if (x0 <= -R) {
      return Math.PI * Math.pow(R, 2) * hc;
    } else if (x0 >= R) {
      return 0;
    } else {
      const clamp_x0 = Math.min(R, Math.max(-R, x0));
      const term1 = hc * (R * R * Math.PI / 2 - (clamp_x0 * Math.sqrt(R * R - clamp_x0 * clamp_x0) + R * R * Math.asin(clamp_x0 / R)));
      const term2 = (2 / 3) * tanT * Math.pow(R * R - clamp_x0 * clamp_x0, 1.5);
      return term1 + term2;
    }
  };

  // 目標体積を満たす中心高さ(hc)を二分探索で求める
  const findHc = (targetV, theta_deg, R, H) => {
    if (targetV <= 0) return 0;
    const theta = (theta_deg * Math.PI) / 180;
    if (theta === 0) return targetV / (Math.PI * R * R);
    
    const tanT = Math.tan(theta);
    let low = -R * tanT;
    let high = Math.max(H + R * tanT, targetV / (Math.PI * R * R) + R * tanT);
    
    for (let i = 0; i < 50; i++) {
      let mid = (low + high) / 2;
      if (getVolumeFromHc(mid, theta_deg, R) < targetV) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return (low + high) / 2;
  };

  // こぼれ始める角度を二分探索で求める
  const findSpillAngle = (V0, R, H) => {
    if (V0 >= Math.PI * R * R * H) return 0;
    let low = 0;
    let high = 90;
    for (let i = 0; i < 50; i++) {
      let mid = (low + high) / 2;
      if (getMaxVolume(mid, R, H) > V0) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return (low + high) / 2;
  };

  // ----------------------------------------------------
  // シミュレーションデータの計算
  // ----------------------------------------------------
  const R = Math.max(1, diameter) / 2;
  const H = Math.max(1, depth);
  const D = Math.max(0.1, density);
  const W = Math.max(0, weight);

  const { weightData, spillAngle, initialV, initialSpilledWeight } = useMemo(() => {
    const maxV = Math.PI * R * R * H;
    const initialVRaw = (W * 1e6) / D;
    const actInitialV = Math.min(initialVRaw, maxV);
    const initiallySpilled = Math.max(0, W - actInitialV * D * 1e-6);

    let spAngle = 0;
    if (actInitialV < maxV) {
      spAngle = findSpillAngle(actInitialV, R, H);
    }

    const data = [];
    for (let i = 0; i <= 90; i++) {
      const safeT = Math.min(i, 89.999);
      const maxVAtTheta = getMaxVolume(safeT, R, H);
      const actualV = Math.min(actInitialV, maxVAtTheta);
      data.push(actualV * D * 1e-6);
    }

    return { weightData: data, spillAngle: spAngle, initialV: actInitialV, initialSpilledWeight: initiallySpilled };
  }, [diameter, depth, density, weight]);

  const safeAngle = Math.min(angle, 89.999);
  const currentMaxV = Math.max(0, getMaxVolume(safeAngle, R, H));
  const currentActualV = Math.max(0, Math.min(initialV, currentMaxV));
  const currentRemainWeight = currentActualV * D * 1e-6;
  const currentSpilledWeight = initialSpilledWeight + (initialV * D * 1e-6 - currentRemainWeight);

  let currentHc = 0;
  if (currentActualV >= currentMaxV - 1) { 
    currentHc = H - R * Math.tan(safeAngle * Math.PI / 180);
  } else {
    currentHc = findHc(currentActualV, safeAngle, R, H);
  }

  // ----------------------------------------------------
  // 描画エフェクト
  // ----------------------------------------------------
  
  useEffect(() => {
    const scale = 10 / Math.max(R * 2, H);
    threeStateRef.current = { angle, currentHc, scale, currentActualV };
    if (chartInstanceRef.current) {
      chartInstanceRef.current.options.currentAngle = angle;
      chartInstanceRef.current.update();
    }
  }, [angle, currentHc, R, H, currentActualV]);

  useEffect(() => {
    if (!threeCanvasRef.current) return;

    const canvas = threeCanvasRef.current;
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.localClippingEnabled = true;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111827);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(15, 25, 20);
    scene.add(dirLight);

    const scale = 10 / Math.max(R * 2, H);

    // 回転軸（右上の縁）となるPivotグループ
    const pivot = new THREE.Group();
    const pivotY = 4; 
    pivot.position.set(0, pivotY, 0);
    scene.add(pivot);

    // 円筒本体をまとめるグループ
    const containerGroup = new THREE.Group();
    containerGroup.position.set(-R * scale, -H * scale, 0);
    pivot.add(containerGroup);

    // 容器メッシュ
    const containerGeom = new THREE.CylinderGeometry(R * scale, R * scale, H * scale, 64, 1, true);
    containerGeom.translate(0, H * scale / 2, 0);
    const containerMat = new THREE.MeshPhysicalMaterial({
      color: 0xcccccc,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      roughness: 0.1,
      metalness: 0.3,
      depthWrite: false
    });
    containerGroup.add(new THREE.Mesh(containerGeom, containerMat));

    // 底面メッシュ
    const bottomGeom = new THREE.CircleGeometry(R * scale, 64);
    bottomGeom.rotateX(-Math.PI / 2);
    containerGroup.add(new THREE.Mesh(bottomGeom, new THREE.MeshPhysicalMaterial({
      color: 0xcccccc, transparent: true, opacity: 0.4, side: THREE.DoubleSide
    })));

    // 液体メッシュ
    const liquidGeom = new THREE.CylinderGeometry(R * scale * 0.99, R * scale * 0.99, H * scale, 64);
    liquidGeom.translate(0, H * scale / 2, 0);
    const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    const liquidMat = new THREE.MeshStandardMaterial({
      color: 0xe65100,
      roughness: 0.1,
      metalness: 0.2,
      side: THREE.DoubleSide,
      clippingPlanes: [clipPlane]
    });
    const liquidMesh = new THREE.Mesh(liquidGeom, liquidMat);
    containerGroup.add(liquidMesh);

    // カメラアングル状態 (極座標)
    let azimuthAngle = -Math.PI / 2 + 0.3; 
    let polarAngle = Math.PI / 2 - 0.25; // 容器を少しだけ見下ろす適切な角度
    let cameraRadius = 18; // 少し引き気味(半径16→18)に設定して全体をカバー

    // 傾き角度に応じて、回転する容器の「動的な幾何中心」を計算して注視させる
    const getDynamicTarget = (currentAngleDeg) => {
      const theta = (currentAngleDeg || 0) * Math.PI / 180;
      
      // Pivot(0, pivotY, 0)から見た初期重心の相対座標
      const x0 = -R * scale;
      const y0 = -H * scale / 2;
      
      // Z軸回転(時計回り)を考慮した座標変換
      const dynX = x0 * Math.cos(theta) + y0 * Math.sin(theta);
      const dynY = pivotY - x0 * Math.sin(theta) + y0 * Math.cos(theta);
      
      return new THREE.Vector3(dynX, dynY, 0);
    };

    const updateCameraPosition = () => {
      const targetVec = getDynamicTarget(threeStateRef.current.angle);
      polarAngle = Math.max(0.1, Math.min(Math.PI - 0.1, polarAngle));
      
      camera.position.x = targetVec.x + cameraRadius * Math.sin(polarAngle) * Math.cos(azimuthAngle);
      camera.position.y = targetVec.y + cameraRadius * Math.cos(polarAngle);
      camera.position.z = targetVec.z + cameraRadius * Math.sin(polarAngle) * Math.sin(azimuthAngle);
      camera.lookAt(targetVec);
    };

    updateCameraPosition();

    // 親要素のサイズ監視（ResizeObserverで確実なサイズ決定を行う）
    const container = canvas.parentElement;
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        if (width === 0 || height === 0) continue;
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        camera.aspect = width / height;
        cameraRadius = (width / height < 1) ? (28 / (width / height)) : 18;
        camera.updateProjectionMatrix();
        updateCameraPosition();
      }
    });
    if (container) {
      resizeObserver.observe(container);
    }

    // マウス・タッチ操作イベントハンドラ
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    const handleMouseDown = (e) => {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const handleMouseMove = (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - previousMousePosition.x;
      const deltaY = e.clientY - previousMousePosition.y;

      azimuthAngle -= deltaX * 0.007;
      polarAngle -= deltaY * 0.007;

      previousMousePosition = { x: e.clientX, y: e.clientY };
      updateCameraPosition();
    };

    const handleMouseUp = () => {
      isDragging = false;
    };

    const handleTouchStart = (e) => {
      if (e.touches.length === 1) {
        isDragging = true;
        previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const handleTouchMove = (e) => {
      if (!isDragging || e.touches.length === 0) return;
      const deltaX = e.touches[0].clientX - previousMousePosition.x;
      const deltaY = e.touches[0].clientY - previousMousePosition.y;

      azimuthAngle -= deltaX * 0.007;
      polarAngle -= deltaY * 0.007;

      previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      updateCameraPosition();
    };

    const handleWheel = (e) => {
      e.preventDefault();
      cameraRadius += e.deltaY * 0.01;
      cameraRadius = Math.max(5, Math.min(40, cameraRadius)); 
      updateCameraPosition();
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    
    canvas.addEventListener('touchstart', handleTouchStart, { passive: true });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleMouseUp);
    
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    let animationId;
    const animate = () => {
      const state = threeStateRef.current;
      pivot.rotation.z = -state.angle * Math.PI / 180;
      
      const theta = state.angle * Math.PI / 180;
      const yw_relative = (R * state.scale) * Math.sin(theta) + ((state.currentHc - H) * state.scale) * Math.cos(theta);
      clipPlane.constant = pivot.position.y + yw_relative;

      if (state.currentActualV < 1.0 || state.angle >= 89.9) {
        liquidMesh.visible = false;
      } else {
        liquidMesh.visible = true;
      }

      // 注視ターゲットとカメラ位置を常に回転に追従して更新
      updateCameraPosition();

      renderer.render(scene, camera);
      animationId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      
      if (canvas) {
        canvas.removeEventListener('mousedown', handleMouseDown);
        canvas.removeEventListener('touchstart', handleTouchStart);
        canvas.removeEventListener('touchmove', handleTouchMove);
        canvas.removeEventListener('wheel', handleWheel);
      }
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchend', handleMouseUp);
      
      renderer.dispose();
      containerGeom.dispose();
      bottomGeom.dispose();
      liquidGeom.dispose();
    };
  }, [R, H]);

  // Chart.js の初期化と更新
  useEffect(() => {
    if (!chartCanvasRef.current) return;

    const verticalLinePlugin = {
      id: 'verticalLine',
      afterDraw: (chart) => {
        const currAngle = chart.options.currentAngle;
        if (currAngle === undefined) return;
        const x = chart.scales.x.getPixelForValue(currAngle);
        const topY = chart.scales.y.top;
        const bottomY = chart.scales.y.bottom;
        const ctx = chart.ctx;
        ctx.save();
        
        ctx.beginPath();
        ctx.moveTo(x, topY);
        ctx.lineTo(x, bottomY);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        
        const yValue = weightData[Math.round(currAngle)];
        if (yValue !== undefined) {
          const y = chart.scales.y.getPixelForValue(yValue);
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, 2 * Math.PI);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = '#e65100';
          ctx.stroke();
        }
        ctx.restore();
      }
    };

    if (!chartInstanceRef.current) {
      const ctx = chartCanvasRef.current.getContext('2d');
      chartInstanceRef.current = new Chart(ctx, {
        type: 'line',
        data: {
          labels: Array.from({ length: 91 }, (_, i) => i),
          datasets: [{
            label: '残り液体重量 (kg)',
            data: weightData,
            borderColor: '#e65100',
            backgroundColor: 'rgba(230, 81, 0, 0.15)',
            borderWidth: 3,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 6,
            tension: 0.1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          currentAngle: angle,
          interaction: { intersect: false, mode: 'index' },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (ctx) => `傾き: ${ctx[0].label}°`,
                label: (ctx) => `残り: ${ctx.raw.toFixed(1)} kg`
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: '傾き (度)', color: '#9ca3af' },
              ticks: { color: '#9ca3af', stepSize: 15 },
              grid: { color: '#374151' }
            },
            y: {
              title: { display: true, text: '重量 (kg)', color: '#9ca3af' },
              ticks: { color: '#9ca3af' },
              grid: { color: '#374151' },
              min: 0,
              max: Math.ceil(initialV * D * 1e-6 / 1000) * 1000 || 1000
            }
          }
        },
        plugins: [verticalLinePlugin]
      });
    } else {
      chartInstanceRef.current.data.datasets[0].data = weightData;
      chartInstanceRef.current.options.scales.y.max = Math.ceil(initialV * D * 1e-6 / 1000) * 1000 || 1000;
      chartInstanceRef.current.update();
    }
  }, [weightData]);


  return (
    <div className="flex flex-col md:flex-row h-[100dvh] bg-gray-950 text-gray-100 font-sans overflow-hidden select-none">
      
      {/* ビジュアライゼーション (スマホ: 上部, PC: 右側) */}
      <div className="order-1 md:order-2 w-full md:w-2/3 flex flex-col relative h-[55dvh] md:h-full">
        {/* 3D View */}
        <div className="flex-1 w-full relative overflow-hidden bg-gray-900">
          <canvas ref={threeCanvasRef} className="w-full h-full block touch-none cursor-grab active:cursor-grabbing" />
          <div className="absolute top-4 left-4 bg-gray-900/80 backdrop-blur px-3 py-1.5 rounded-md border border-gray-700 text-sm flex items-center gap-2">
            <Beaker className="w-4 h-4 text-orange-400 animate-pulse" />
            <span className="text-gray-200">3D Preview (ドラッグで視点移動)</span>
          </div>
        </div>
        
        {/* Graph View */}
        <div className="h-[30%] min-h-[160px] md:h-[40%] w-full bg-gray-900 p-2 md:p-6 border-t border-gray-800 shadow-[0_-10px_20px_rgba(0,0,0,0.4)] z-10">
          <div className="w-full h-full relative">
            <canvas ref={chartCanvasRef} className="w-full h-full block" />
          </div>
        </div>
      </div>

      {/* コントロールパネル (スマホ: 下部, PC: 左側) */}
      <div className="order-2 md:order-1 w-full md:w-1/3 md:min-w-[320px] p-5 md:p-6 bg-gray-900 shadow-[0_-10px_20px_rgba(0,0,0,0.3)] md:shadow-2xl z-20 flex flex-col overflow-y-auto border-t md:border-t-0 md:border-r border-gray-800 h-[45dvh] md:h-full">
        
        <div className="flex items-center gap-3 mb-6 md:mb-8">
          <Droplet className="text-orange-500 w-7 h-7 md:w-8 md:h-8" />
          <h1 className="text-xl md:text-2xl font-bold text-gray-100">液体傾斜シミュレーター</h1>
        </div>

        {/* パラメータ設定 */}
        <div className="p-4 rounded-xl border border-gray-800 mb-6 bg-gray-950/60">
          <div className="flex items-center gap-2 mb-3 text-orange-400">
            <Settings className="w-5 h-5" />
            <h2 className="font-semibold text-sm md:text-base">容器・液体パラメータ</h2>
          </div>
          
          <div className="grid grid-cols-2 gap-3 md:gap-4">
            <div>
              <label className="block text-xs md:text-sm text-gray-400 mb-1">直径 (mm)</label>
              <input type="number" min="1" value={diameter} onChange={e => setDiameter(Number(e.target.value))} 
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 md:px-3 md:py-2 text-sm md:text-base text-white focus:outline-none focus:border-orange-500 transition-colors" />
            </div>
            <div>
              <label className="block text-xs md:text-sm text-gray-400 mb-1">深さ (mm)</label>
              <input type="number" min="1" value={depth} onChange={e => setDepth(Number(e.target.value))} 
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 md:px-3 md:py-2 text-sm md:text-base text-white focus:outline-none focus:border-orange-500 transition-colors" />
            </div>
            <div>
              <label className="block text-xs md:text-sm text-gray-400 mb-1">密度 (比重)</label>
              <input type="number" min="0.1" step="0.1" value={density} onChange={e => setDensity(Number(e.target.value))} 
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 md:px-3 md:py-2 text-sm md:text-base text-white focus:outline-none focus:border-orange-500 transition-colors" />
            </div>
            <div>
              <label className="block text-xs md:text-sm text-gray-400 mb-1">初期重量 (kg)</label>
              <input type="number" min="0" value={weight} onChange={e => setWeight(Number(e.target.value))} 
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 md:px-3 md:py-2 text-sm md:text-base text-white focus:outline-none focus:border-orange-500 transition-colors" />
            </div>
          </div>
        </div>

        {/* スライダー */}
        <div className="mb-6 px-1 md:px-2">
          <div className="flex justify-between items-end mb-3">
            <label className="text-gray-300 font-medium text-sm md:text-base">傾き調整</label>
            <span className="text-3xl md:text-4xl font-bold text-orange-500">{angle}°</span>
          </div>
          <input 
            type="range" min="0" max="90" step="1" 
            value={angle} 
            onChange={e => setAngle(Number(e.target.value))}
            className="w-full h-4 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-orange-500 outline-none"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-2">
            <span>0° (直立)</span>
            <span>45°</span>
            <span>90° (横倒し)</span>
          </div>
        </div>

        {/* 結果ハイライト */}
        <div className="mt-auto space-y-3 pb-4 md:pb-0">
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-3 md:p-4 flex items-center gap-3 md:gap-4">
            <div className="bg-orange-500 p-2 md:p-3 rounded-lg flex-shrink-0">
              <Info className="w-5 h-5 md:w-6 md:h-6 text-white" />
            </div>
            <div>
              <div className="text-xs md:text-sm text-orange-200 mb-0.5 md:mb-1">こぼれ始める角度</div>
              <div className="text-xl md:text-2xl font-bold text-white">
                {spillAngle > 0 ? `${spillAngle.toFixed(1)}°` : '既にこぼれています'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:gap-4">
            <div className="border border-gray-800 rounded-xl p-3 md:p-4 bg-gray-950/60">
              <div className="text-xs md:text-sm text-gray-400 mb-0.5 md:mb-1">残っている重量</div>
              <div className="text-lg md:text-xl font-bold text-blue-400">
                {currentRemainWeight.toFixed(1)} <span className="text-xs md:text-sm font-normal">kg</span>
              </div>
            </div>
            <div className="border border-gray-800 rounded-xl p-3 md:p-4 bg-gray-950/60">
              <div className="text-xs md:text-sm text-gray-400 mb-0.5 md:mb-1">こぼれた重量</div>
              <div className="text-lg md:text-xl font-bold text-red-400">
                {currentSpilledWeight.toFixed(1)} <span className="text-xs md:text-sm font-normal">kg</span>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}