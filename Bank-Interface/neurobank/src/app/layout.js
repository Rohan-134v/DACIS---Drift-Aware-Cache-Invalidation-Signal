"use client";
import "./globals.css";
import { ToastProvider } from "./components/Toast";

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark h-full">
      <head>
        <title>NeuroBank — Secure Neural Banking</title>
        <meta name="description" content="A futuristic digital banking platform with AI-powered security, wealth management, and real-time fraud telemetry." />
        <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-full bg-void-black text-on-surface antialiased overflow-x-hidden">
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
