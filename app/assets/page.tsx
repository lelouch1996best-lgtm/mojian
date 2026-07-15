"use client";

import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import AssetLibrary from "@/components/AssetLibrary";

function BrushIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 21L7.5 16.5M7.5 16.5C6 15 6 13 7.5 11.5L14 5C15.5 3.5 17.5 3.5 19 5C20.5 6.5 20.5 8.5 19 10L12.5 16.5C11 18 9 18 7.5 16.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function AssetsPage() {
  const router = useRouter();

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
            title="返回首页"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-warm-950 text-warm-50">
              <BrushIcon size={18} />
              <span className="sr-only">墨间</span>
            </div>
            <span
              className="font-serif font-bold text-[20px] text-warm-950"
              style={{ letterSpacing: "2px" }}
            >
              墨间
            </span>
          </a>
          <div className="h-8 w-px bg-warm-300" />
          <div>
            <h1 className="text-xl font-bold text-slate-800">资产库</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              浏览所有企划下生成的图片与视频
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="md" onClick={() => router.push("/")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mr-1">
              <path
                d="M15 18l-6-6 6-6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            返回首页
          </Button>
        </div>
      </header>

      <AssetLibrary />
    </main>
  );
}
