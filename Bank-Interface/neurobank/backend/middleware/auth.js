import { adminAuth } from "../firebase.js";

export async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ message: "Unauthorized" });
  try {
    req.user = await adminAuth.verifyIdToken(header.slice(7));
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}

// Firebase custom claims are top-level fields on the decoded token object.
// After setCustomUserClaims(uid, { role: "admin" }), req.user.role === "admin".
export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin")
    return res.status(403).json({ message: "Admin access required" });
  next();
}
