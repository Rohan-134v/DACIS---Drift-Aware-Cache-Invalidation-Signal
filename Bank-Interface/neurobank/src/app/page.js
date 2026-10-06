"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useToast } from "@/app/components/Toast";

/* ─── WebGL Neural Shader Background ─── */
function NeuralShader() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return;

    function syncSize() {
      const w = canvas.clientWidth || 1280;
      const h = canvas.clientHeight || 720;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(syncSize).observe(canvas);
    syncSize();

    const vs = `attribute vec2 a_position; varying vec2 v_texCoord; void main() { v_texCoord = a_position * 0.5 + 0.5; gl_Position = vec4(a_position, 0.0, 1.0); }`;
    const fs = `precision highp float; varying vec2 v_texCoord; uniform float u_time; uniform vec2 u_resolution; uniform vec2 u_mouse;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.y, u_resolution.x);
  vec2 m = u_mouse / u_resolution - 0.5;
  uv *= 1.2 + dot(uv, uv) * 0.2; uv += m * 0.05;
  vec3 finalColor = vec3(0.0);
  for(float i = 0.0; i < 4.0; i++) {
    float size = 8.0 + i * 4.0; vec2 id = floor(uv * size); vec2 gv = fract(uv * size) - 0.5;
    float n = hash(id); float t = u_time * (0.2 + n * 0.5);
    vec2 p = vec2(sin(t + n * 6.28), cos(t * 0.8 + n * 6.28)) * 0.3;
    float d = length(gv - p); float node = smoothstep(0.08, 0.0, d) * n; float glow = smoothstep(0.4, 0.0, d) * 0.3 * n;
    vec3 col = mix(vec3(1.0, 0.42, 0.0), vec3(1.0, 0.6, 0.1), n);
    finalColor += (node + glow) * col;
    if(n > 0.6) { float line = smoothstep(0.02, 0.0, abs(gv.x - p.x)) * smoothstep(0.5, 0.0, abs(gv.y - p.y)); finalColor += line * col * 0.05; }
  }
  float vignette = 1.0 - length(uv * 0.8); finalColor *= vignette;
  vec3 bgColor = vec3(0.02, 0.02, 0.02);
  gl_FragColor = vec4(mix(bgColor, finalColor, 0.6), 1.0);
}`;

    function cs(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    const prog = gl.createProgram();
    gl.attachShader(prog, cs(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, cs(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(prog, "a_position");
    gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uRes = gl.getUniformLocation(prog, "u_resolution");
    const uMouse = gl.getUniformLocation(prog, "u_mouse");

    let mouse = { x: canvas.width / 2, y: canvas.height / 2 };
    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width && rect.height) { mouse.x = ((e.clientX - rect.left) / rect.width) * canvas.width; mouse.y = (1.0 - (e.clientY - rect.top) / rect.height) * canvas.height; }
    };
    window.addEventListener("mousemove", onMove);

    let animId;
    function render(t) {
      syncSize(); gl.viewport(0, 0, canvas.width, canvas.height);
      if (uTime) gl.uniform1f(uTime, t * 0.001);
      if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
      if (uMouse) gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      animId = requestAnimationFrame(render);
    }
    render(0);
    return () => { cancelAnimationFrame(animId); window.removeEventListener("mousemove", onMove); };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ display: "block" }} />;
}

/* ─── Three.js Biometric Core ─── */
function BiometricCore() {
  const mountRef = useRef(null);

  useEffect(() => {
    let animId;
    const loadThree = async () => {
      const THREE = await import("three");
      const container = mountRef.current;
      if (!container) return;
      const width = container.clientWidth || 500;
      const height = container.clientHeight || 500;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      container.appendChild(renderer.domElement);

      const ambientLight = new THREE.AmbientLight(0x404040, 2);
      scene.add(ambientLight);
      const pointLight = new THREE.PointLight(0xFF6B00, 15, 100);
      pointLight.position.set(5, 5, 5);
      scene.add(pointLight);

      const group = new THREE.Group();
      const coreGeom = new THREE.IcosahedronGeometry(1, 1);
      const coreMat = new THREE.MeshPhongMaterial({ color: 0xFF6B00, emissive: 0x3a1500, shininess: 100, wireframe: true, transparent: true, opacity: 0.8 });
      const core = new THREE.Mesh(coreGeom, coreMat);
      group.add(core);

      const outerGeom = new THREE.IcosahedronGeometry(1.4, 0);
      const outerMat = new THREE.MeshPhongMaterial({ color: 0xFF8C00, wireframe: true, transparent: true, opacity: 0.2 });
      const outer = new THREE.Mesh(outerGeom, outerMat);
      group.add(outer);

      const ringGeom = new THREE.TorusGeometry(1.8, 0.02, 16, 100);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xFF6B00, transparent: true, opacity: 0.4 });
      const ring1 = new THREE.Mesh(ringGeom, ringMat);
      const ring2 = new THREE.Mesh(ringGeom, ringMat.clone());
      ring2.rotation.x = Math.PI / 2;
      group.add(ring1); group.add(ring2);
      scene.add(group);
      camera.position.z = 5;

      let mouseX = 0, mouseY = 0;
      const onMouseMove = (e) => { mouseX = (e.clientX / window.innerWidth) * 2 - 1; mouseY = -(e.clientY / window.innerHeight) * 2 + 1; };
      window.addEventListener("mousemove", onMouseMove);

      const onResize = () => { const w = container.clientWidth; const h = container.clientHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); };
      window.addEventListener("resize", onResize);

      const animate = () => {
        animId = requestAnimationFrame(animate);
        const time = Date.now() * 0.001;
        group.rotation.y += 0.005; group.rotation.z += 0.002;
        group.position.y = Math.sin(time) * 0.2;
        group.rotation.x += (mouseY * 0.5 - group.rotation.x) * 0.05;
        group.rotation.y += (mouseX * 0.5 - group.rotation.y) * 0.05;
        core.rotation.y -= 0.01; ring1.rotation.z += 0.01; ring2.rotation.z -= 0.01;
        renderer.render(scene, camera);
      };
      animate();

      return () => {
        cancelAnimationFrame(animId);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("resize", onResize);
        renderer.dispose(); coreGeom.dispose(); coreMat.dispose(); outerGeom.dispose(); outerMat.dispose(); ringGeom.dispose(); ringMat.dispose();
        if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      };
    };
    const cleanup = loadThree();
    return () => { cancelAnimationFrame(animId); cleanup.then?.(fn => fn?.()); };
  }, []);

  return <div ref={mountRef} className="w-full h-full" />;
}

/* ─── Login Page ─── */
export default function LoginPage() {
  const router = useRouter();
  const toast = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showStatus, setShowStatus] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const email = e.target["neural-id"].value;
    const password = e.target["encryption-key"].value;
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const token = await cred.user.getIdToken(true);
      localStorage.setItem("nb_token", token);
      const [idTokenResult, profileRes] = await Promise.all([
        cred.user.getIdTokenResult(true),
        fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.ok ? r.json() : null).catch(() => null),
      ]);
      if (idTokenResult.claims.role === "admin" || profileRes?.role === "admin") {
        router.push("/admin");
      } else {
        router.push("/dashboard");
      }
    } catch (err) {
      const msg = err.code === "auth/invalid-credential" || err.code === "auth/user-not-found"
        ? "Invalid Neural ID or Encryption Key."
        : err.message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-void-black">
      {/* Background Shader */}
      <div className="absolute inset-0 w-full h-full z-0 opacity-60">
        <NeuralShader />
      </div>

      {/* Main Content */}
      <main className="relative z-10 min-h-screen flex items-center justify-center px-margin-mobile md:px-margin-desktop w-full max-w-[1440px] mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-gutter w-full min-h-[600px] items-center">
          {/* Left Side: 3D Scene */}
          <div className="hidden lg:flex w-full h-full relative items-center justify-center min-h-[500px]">
            <div className="absolute inset-0 w-full h-full">
              <BiometricCore />
            </div>
            <div className="absolute bottom-10 left-0 pointer-events-none z-20">
              <h2 className="text-headline-lg text-pure-white mb-2">Neuro-Core</h2>
              <p className="text-label-sm text-starlight-gray uppercase tracking-widest">Global Node Network Active</p>
            </div>
          </div>

          {/* Right Side: Login Panel */}
          <div className="flex items-center justify-center w-full">
            <div className="glass-panel rounded-xl p-8 md:p-12 w-full max-w-md ambient-glow relative overflow-hidden">
              {/* Top edge highlight */}
              <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-electric-blue to-transparent opacity-50"></div>

              {/* Header */}
              <div className="mb-10">
                <div className="flex items-center gap-3 mb-4">
                  <span className="material-symbols-outlined text-electric-blue text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>hub</span>
                  <h1 className="text-headline-md md:text-headline-lg text-pure-white tracking-tight">Neural Access Point</h1>
                </div>
                <p className="text-label-md text-starlight-gray uppercase tracking-widest">Establish secure uplink to Neuro-Core</p>
              </div>

              {/* Error */}
              {error && (
                <div className="mb-6 flex items-center gap-3 p-4 rounded-xl bg-error-container/20 border border-error/30 text-error text-label-md">
                  <span className="material-symbols-outlined text-[18px]">error</span>
                  {error}
                </div>
              )}

              {/* Form */}
              <form className="space-y-6" onSubmit={handleSubmit}>
                {/* Neural ID */}
                <div className="relative group">
                  <label className="text-label-sm text-on-surface-variant block mb-2 uppercase tracking-wider" htmlFor="neural-id">Neural ID</label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline group-focus-within:text-electric-blue transition-colors">fingerprint</span>
                    <input className="w-full bg-surface-container-lowest/50 border-0 border-b border-outline-variant rounded-t px-4 py-3 pl-10 text-pure-white text-label-md placeholder-outline-variant focus:ring-0 input-glow transition-all duration-300" id="neural-id" placeholder="NODE-XXXX-XXXX" type="text" />
                  </div>
                </div>

                {/* Encryption Key */}
                <div className="relative group">
                  <label className="text-label-sm text-on-surface-variant block mb-2 uppercase tracking-wider flex justify-between" htmlFor="encryption-key">
                    Encryption Key
                    <a onClick={() => toast.info("Contact support@neurobank.io for password reset")} className="text-electric-blue hover:text-primary-fixed transition-colors cursor-pointer">Bypass?</a>
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline group-focus-within:text-electric-blue transition-colors">key</span>
                    <input className="w-full bg-surface-container-lowest/50 border-0 border-b border-outline-variant rounded-t px-4 py-3 pl-10 text-pure-white text-label-md placeholder-outline-variant focus:ring-0 input-glow transition-all duration-300" id="encryption-key" placeholder="••••••••••••" type={showPassword ? "text" : "password"} />
                    <button className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-pure-white transition-colors" type="button" onClick={() => setShowPassword(!showPassword)}>
                      <span className="material-symbols-outlined">{showPassword ? "visibility_off" : "visibility"}</span>
                    </button>
                  </div>
                </div>

                {/* Submit */}
                <div className="pt-4">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-electric-blue text-pure-white text-label-md py-4 rounded uppercase tracking-widest hover:bg-primary-container transition-all duration-300 active:scale-95 flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(255,107,0,0.4)] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <><span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>Authenticating...</>
                    ) : (
                      <><span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>Initialize Session</>
                    )}
                  </button>
                </div>
              </form>

              {/* Footer */}
              <div className="mt-8 pt-6 border-t border-white/10 flex flex-col sm:flex-row justify-between items-center gap-4">
                <a href="/signup" className="text-label-sm text-starlight-gray hover:text-pure-white transition-colors flex items-center gap-1 cursor-pointer">
                  <span className="material-symbols-outlined text-[16px]">add_circle</span>
                  Request Access
                </a>
                <div className="relative">
                  <a onClick={() => setShowStatus((o) => !o)} className="text-label-sm text-starlight-gray hover:text-pure-white transition-colors flex items-center gap-1 cursor-pointer">
                    <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]"></span>
                    System Status
                  </a>
                  {showStatus && (
                    <div className="absolute bottom-8 right-0 w-64 glass-panel rounded-xl p-4 shadow-2xl z-50 border border-white/10" style={{ background: 'rgba(12,13,24,0.9)' }}>
                      <h4 className="text-label-md text-on-surface mb-3">System Health</h4>
                      {[{name:'Auth Service',ok:true},{name:'API Gateway',ok:true},{name:'Firestore DB',ok:true},{name:'DACIS Engine',ok:true}].map((s)=>(
                        <div key={s.name} className="flex justify-between items-center py-1.5">
                          <span className="text-label-sm text-on-surface-variant">{s.name}</span>
                          <span className="flex items-center gap-1 text-label-sm text-green-400"><span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>Online</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
