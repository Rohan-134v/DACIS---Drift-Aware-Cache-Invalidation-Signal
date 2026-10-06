import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:4000/api/:path*",
      },
      // DACIS WebSocket stream — direct to FastAPI backend
      {
        source: "/dacis-ws/:path*",
        destination: "http://localhost:8000/ws/:path*",
      },
    ];
  },
};

export default nextConfig;
