"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useToast } from "@/app/components/Toast";

/* ─── Reuse the same WebGL Neural Shader from login ─── */
function NeuralShader() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return;
    function syncSize() {
      const w = canvas.clientWidth || 1280, h = canvas.clientHeight || 720;
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

/* ─── Signup Page ─── */
export default function SignupPage() {
  const router = useRouter();
  const toast = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "", agree: false });
  const [showModal, setShowModal] = useState(null); // 'terms' or 'privacy'
  const [showStatus, setShowStatus] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirm) { setError("Encryption keys do not match."); return; }
    if (!form.agree) { setError("You must accept the Neural Access Agreement."); return; }
    setLoading(true);
    try {
      // 1. Create Firebase Auth user
      const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
      await updateProfile(cred.user, { displayName: form.name });
      const token = await cred.user.getIdToken();
      localStorage.setItem("nb_token", token);

      // 2. Create Firestore profile via backend
      await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: form.name, email: form.email, password: form.password }),
      });

      router.push("/dashboard");
    } catch (err) {
      const msg = err.code === "auth/email-already-in-use"
        ? "A node with this Neural ID already exists."
        : err.message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-void-black">
      <div className="absolute inset-0 w-full h-full z-0 opacity-60">
        <NeuralShader />
      </div>

      <main className="relative z-10 min-h-screen flex items-center justify-center px-margin-mobile md:px-margin-desktop w-full max-w-[1440px] mx-auto py-12">
        <div className="w-full max-w-lg">
          <div className="glass-panel rounded-2xl p-8 md:p-12 ambient-glow relative overflow-hidden">
            {/* Top edge highlight */}
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-electric-blue to-transparent opacity-50" />

            {/* Header */}
            <div className="mb-10">
              <div className="flex items-center gap-3 mb-4">
                <span className="material-symbols-outlined text-electric-blue text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>hub</span>
                <h1 className="text-headline-md md:text-headline-lg text-pure-white tracking-tight">Register Node</h1>
              </div>
              <p className="text-label-md text-starlight-gray uppercase tracking-widest">Create your Neural Access credentials</p>
            </div>

            {/* Error */}
            {error && (
              <div className="mb-6 flex items-center gap-3 p-4 rounded-xl bg-error-container/20 border border-error/30 text-error text-label-md">
                <span className="material-symbols-outlined text-[18px]">error</span>
                {error}
              </div>
            )}

            {/* Form */}
            <form className="space-y-5" onSubmit={handleSubmit}>
              {/* Full Name */}
              <div className="relative group">
                <label className="text-label-sm text-on-surface-variant block mb-2 uppercase tracking-wider" htmlFor="full-name">Full Name</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline group-focus-within:text-electric-blue transition-colors">badge</span>
                  <input
                    id="full-name"
                    type="text"
                    required
                    placeholder="Alexander Chen"
                    value={form.name}
                    onChange={set("name")}
                    className="w-full bg-surface-container-lowest/50 border-0 border-b border-outline-variant rounded-t px-4 py-3 pl-10 text-pure-white text-label-md placeholder-outline-variant focus:ring-0 input-glow transition-all duration-300"
                  />
                </div>
              </div>

              {/* Email */}
              <div className="relative group">
                <label className="text-label-sm text-on-surface-variant block mb-2 uppercase tracking-wider" htmlFor="email">Neural ID (Email)</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline group-focus-within:text-electric-blue transition-colors">fingerprint</span>
                  <input
                    id="email"
                    type="email"
                    required
                    placeholder="node@neurobank.io"
                    value={form.email}
                    onChange={set("email")}
                    className="w-full bg-surface-container-lowest/50 border-0 border-b border-outline-variant rounded-t px-4 py-3 pl-10 text-pure-white text-label-md placeholder-outline-variant focus:ring-0 input-glow transition-all duration-300"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="relative group">
                <label className="text-label-sm text-on-surface-variant block mb-2 uppercase tracking-wider" htmlFor="password">Encryption Key</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline group-focus-within:text-electric-blue transition-colors">key</span>
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    placeholder="Min. 8 characters"
                    value={form.password}
                    onChange={set("password")}
                    className="w-full bg-surface-container-lowest/50 border-0 border-b border-outline-variant rounded-t px-4 py-3 pl-10 text-pure-white text-label-md placeholder-outline-variant focus:ring-0 input-glow transition-all duration-300"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-pure-white transition-colors">
                    <span className="material-symbols-outlined">{showPassword ? "visibility_off" : "visibility"}</span>
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div className="relative group">
                <label className="text-label-sm text-on-surface-variant block mb-2 uppercase tracking-wider" htmlFor="confirm">Confirm Key</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline group-focus-within:text-electric-blue transition-colors">lock</span>
                  <input
                    id="confirm"
                    type={showConfirm ? "text" : "password"}
                    required
                    placeholder="Re-enter encryption key"
                    value={form.confirm}
                    onChange={set("confirm")}
                    className="w-full bg-surface-container-lowest/50 border-0 border-b border-outline-variant rounded-t px-4 py-3 pl-10 text-pure-white text-label-md placeholder-outline-variant focus:ring-0 input-glow transition-all duration-300"
                  />
                  <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-pure-white transition-colors">
                    <span className="material-symbols-outlined">{showConfirm ? "visibility_off" : "visibility"}</span>
                  </button>
                </div>
              </div>

              {/* Agreement */}
              <label className="flex items-start gap-3 cursor-pointer group pt-1">
                <div className="relative mt-0.5 shrink-0">
                  <input type="checkbox" checked={form.agree} onChange={set("agree")} className="sr-only peer" />
                  <div className="w-5 h-5 rounded border border-outline-variant peer-checked:bg-electric-blue peer-checked:border-electric-blue transition-all flex items-center justify-center">
                    {form.agree && <span className="material-symbols-outlined text-pure-white text-[14px]">check</span>}
                  </div>
                </div>
                <span className="text-label-sm text-on-surface-variant group-hover:text-on-surface transition-colors leading-relaxed">
                  I accept the{" "}
                  <span onClick={() => setShowModal('terms')} className="text-electric-blue hover:text-primary cursor-pointer">Neural Access Agreement</span>
                  {" "}and{" "}
                  <span onClick={() => setShowModal('privacy')} className="text-electric-blue hover:text-primary cursor-pointer">Privacy Protocol</span>
                </span>
              </label>

              {/* Submit */}
              <div className="pt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-electric-blue text-pure-white text-label-md py-4 rounded uppercase tracking-widest hover:bg-primary-container transition-all duration-300 active:scale-95 flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(255,107,0,0.4)] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                      Initializing...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>rocket_launch</span>
                      Activate Node
                    </>
                  )}
                </button>
              </div>
            </form>

            {/* Footer */}
            <div className="mt-8 pt-6 border-t border-white/10 flex flex-col sm:flex-row justify-between items-center gap-4">
              <Link href="/" className="text-label-sm text-starlight-gray hover:text-pure-white transition-colors flex items-center gap-1">
                <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                Already have access?
              </Link>
                <div className="relative">
                  <a onClick={() => setShowStatus((o) => !o)} className="text-label-sm text-starlight-gray hover:text-pure-white transition-colors flex items-center gap-1 cursor-pointer">
                    <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]" />
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
      </main>

      {/* Agreement Modals */}
      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-void-black/60 backdrop-blur-sm" onClick={() => setShowModal(null)}>
          <div className="glass-modal rounded-2xl p-8 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto custom-scroll" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-headline-md text-pure-white">{showModal === 'terms' ? 'Neural Access Agreement' : 'Privacy Protocol'}</h3>
              <button onClick={() => setShowModal(null)} className="text-on-surface-variant hover:text-on-surface transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="text-body-md text-on-surface-variant space-y-4 leading-relaxed">
              {showModal === 'terms' ? (
                <>
                  <p>By accessing NeuroBank services, you agree to the following terms and conditions governing your use of the Neural Banking Platform.</p>
                  <p><strong className="text-on-surface">1. Account Security.</strong> You are responsible for maintaining the confidentiality of your Neural ID and Encryption Key. All activities under your credentials are your responsibility.</p>
                  <p><strong className="text-on-surface">2. DACIS Security System.</strong> Your account is protected by the DACIS (Digital Autonomous Cybersecurity & Intrusion Sentinel) system. Anomalous activity may trigger automatic account freezes.</p>
                  <p><strong className="text-on-surface">3. Transaction Monitoring.</strong> All transactions are monitored for fraud prevention. Suspicious patterns may be flagged for manual review.</p>
                  <p><strong className="text-on-surface">4. Service Availability.</strong> NeuroBank aims for 99.9% uptime. Scheduled maintenance windows will be communicated in advance.</p>
                  <p><strong className="text-on-surface">5. Liability.</strong> NeuroBank is not liable for losses due to unauthorized access resulting from user negligence in credential management.</p>
                </>
              ) : (
                <>
                  <p>NeuroBank is committed to protecting your privacy. This protocol outlines how we collect, use, and safeguard your information.</p>
                  <p><strong className="text-on-surface">Data Collection.</strong> We collect personal identification, financial transaction data, device fingerprints, and behavioral biometrics for security purposes.</p>
                  <p><strong className="text-on-surface">Data Usage.</strong> Your data is used for account management, fraud detection, service improvement, and regulatory compliance.</p>
                  <p><strong className="text-on-surface">Data Security.</strong> All data is encrypted at rest and in transit using AES-256 and TLS 1.3 protocols.</p>
                  <p><strong className="text-on-surface">Third Parties.</strong> We do not sell your data. Limited sharing occurs only with regulatory bodies as required by law.</p>
                  <p><strong className="text-on-surface">Your Rights.</strong> You may request data export, correction, or deletion by contacting support@neurobank.io.</p>
                </>
              )}
            </div>
            <button onClick={() => setShowModal(null)} className="mt-6 w-full py-3 rounded-lg bg-electric-blue text-pure-white text-label-md hover:bg-primary-container transition-colors">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
