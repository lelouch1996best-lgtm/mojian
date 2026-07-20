"use client";

import { useRouter } from "next/navigation";
import AssetLibrary from "@/components/AssetLibrary";

export default function AssetsPage() {
  const router = useRouter();

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-slate-400 hover:text-slate-600"
            title="返回"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M15 18l-6-6 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-slate-800">资产库</h1>
        </div>
      </header>

      <AssetLibrary />
    </main>
  );
}
