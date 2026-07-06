"use client";

import { useState } from "react";
import { Image } from "antd";
import { LoaderCircle, Play } from "lucide-react";

/** Lazy image with blur-up placeholder and loading spinner. */
export function LazyImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className={`relative overflow-hidden bg-stone-100 dark:bg-stone-900 ${className || ""}`}>
      {!loaded && !failed && (
        <div className="absolute inset-0 flex items-center justify-center">
          <LoaderCircle className="size-5 animate-spin text-stone-400" />
        </div>
      )}
      {failed ? (
        <div className="flex aspect-[4/3] items-center justify-center text-xs text-stone-400">加载失败</div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`size-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
}

/** Lazy video poster + preview — only loads metadata on mount, full source on click. */
export function LazyVideo({ src, poster, className }: { src: string; poster?: string; className?: string }) {
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (!playing) {
    return (
      <button
        type="button"
        className={`group relative overflow-hidden bg-black ${className || ""}`}
        onClick={() => setPlaying(true)}
      >
        {poster ? (
          <img src={poster} alt="" className="size-full object-cover opacity-80" onLoad={() => setLoaded(true)} />
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center">
            {!loaded && <LoaderCircle className="size-5 animate-spin text-stone-400" />}
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-black/60 text-white transition group-hover:bg-black/80">
            <Play className="size-5 fill-white" />
          </div>
        </div>
      </button>
    );
  }
  return (
    <video src={src} controls autoPlay className={`size-full bg-black ${className || ""}`} preload="metadata" />
  );
}
