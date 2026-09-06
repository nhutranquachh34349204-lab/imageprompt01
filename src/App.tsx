import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';

// ---------------------------------- types ---------------------------------

interface PromptItem {
  id: string;
  prompt: string;
  negative_prompt: string;
  index: number;
}

interface ManifestItem {
  id: string;
  filename: string;
  prompt?: string;
  negative_prompt?: string;
  negative_prompt_applied?: boolean;
  width: number;
  height: number;
  bytes: number;
  created_at: string;
}

interface Manifest {
  generated_at: string;
  generator?: string;
  items: ManifestItem[];
}

interface GalleryItem {
  id: string;
  prompt: string;
  negativePrompt: string;
  index: number;
  image: ManifestItem | null;
}

const PAGE_SIZE = 24;

// -------------------------------- helpers ---------------------------------

function parseIdNum(id: string): number {
  const m = /^IMG_(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

// -------------------------------- components ------------------------------

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyText(text);
        setCopied(ok);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1200);
      }}
      className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
        copied
          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
          : 'border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
      }`}
      title={`Sao chép ${label}`}
    >
      {copied ? '✓ Đã chép' : `Copy ${label}`}
    </button>
  );
}

function Placeholder() {
  return (
    <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-zinc-900">
      <div className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800 text-2xl">
          🖼️
        </div>
        <p className="text-sm font-medium text-zinc-500">Chưa có ảnh</p>
        <p className="mt-1 text-xs text-zinc-600">Chạy lại bước sinh ảnh để tạo</p>
      </div>
    </div>
  );
}

function GalleryCard({
  item,
  onOpen,
}: {
  item: GalleryItem;
  onOpen: (item: GalleryItem) => void;
}) {
  const imgSrc = item.image ? `images/${item.image.filename}` : undefined;

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 shadow-lg shadow-black/30 transition-colors hover:border-zinc-600">
      <div className="relative">
        {imgSrc ? (
          <button
            type="button"
            onClick={() => onOpen(item)}
            className="block w-full cursor-zoom-in"
            aria-label={`Xem ảnh ${item.id}`}
          >
            <img
              src={imgSrc}
              alt={`${item.id} — ${item.prompt.slice(0, 80)}`}
              loading="lazy"
              className="aspect-video w-full object-cover"
            />
          </button>
        ) : (
          <Placeholder />
        )}
        <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-0.5 font-mono text-xs font-semibold text-amber-300 backdrop-blur">
          {item.id}
        </span>
        {item.image && (
          <a
            href={imgSrc}
            download={item.image.filename}
            className="absolute right-2 top-2 rounded-md border border-zinc-600/60 bg-black/70 px-2 py-1 text-[11px] text-zinc-200 opacity-0 backdrop-blur transition-opacity hover:bg-zinc-800 group-hover:opacity-100"
            title="Tải ảnh này"
          >
            ⬇ Tải
          </a>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3">
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="font-mono text-sm font-semibold text-zinc-200">{item.id}</h3>
            {item.image && (
              <span className="text-[11px] text-zinc-500">
                {item.image.width}×{item.image.height} · {formatBytes(item.image.bytes)}
              </span>
            )}
          </div>
          <p className="line-clamp-4 text-[13px] leading-relaxed text-zinc-400">{item.prompt}</p>
          <div className="mt-2 flex justify-end">
            <CopyButton text={item.prompt} label="prompt" />
          </div>
        </div>

        {item.negativePrompt && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-rose-400/80">
                Negative prompt
              </span>
              <CopyButton text={item.negativePrompt} label="negative" />
            </div>
            <p className="line-clamp-3 text-xs leading-relaxed text-zinc-500">
              {item.negativePrompt}
            </p>
          </div>
        )}
      </div>
    </article>
  );
}

function Lightbox({
  items,
  index,
  onClose,
  onNav,
}: {
  items: GalleryItem[];
  index: number;
  onClose: () => void;
  onNav: (next: number) => void;
}) {
  const item = items[index];
  const imgSrc = item.image ? `images/${item.image.filename}` : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') onNav(Math.min(items.length - 1, index + 1));
      else if (e.key === 'ArrowLeft') onNav(Math.max(0, index - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, onClose, onNav]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm text-zinc-300">
        <div className="font-mono font-semibold text-amber-300">
          {item.id}{' '}
          <span className="text-zinc-500">
            ({index + 1}/{items.length})
          </span>
        </div>
        <div className="flex items-center gap-2">
          {imgSrc && (
            <a
              href={imgSrc}
              download={item.image?.filename}
              className="rounded-md border border-zinc-600 px-3 py-1.5 text-xs hover:bg-zinc-800"
            >
              ⬇ Tải ảnh
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-600 px-3 py-1.5 text-xs hover:bg-zinc-800"
          >
            ✕ Đóng (Esc)
          </button>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-hidden px-4 pb-4" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => onNav(Math.max(0, index - 1))}
          disabled={index === 0}
          className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-zinc-700 bg-zinc-900/80 p-3 text-xl text-zinc-200 hover:bg-zinc-800 disabled:opacity-30"
          aria-label="Ảnh trước"
        >
          ‹
        </button>
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={`${item.id} — ${item.prompt.slice(0, 120)}`}
            className="max-h-[calc(100vh-110px)] max-w-full rounded-lg object-contain shadow-2xl"
          />
        ) : (
          <Placeholder />
        )}
        <button
          type="button"
          onClick={() => onNav(Math.min(items.length - 1, index + 1))}
          disabled={index === items.length - 1}
          className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-zinc-700 bg-zinc-900/80 p-3 text-xl text-zinc-200 hover:bg-zinc-800 disabled:opacity-30"
          aria-label="Ảnh sau"
        >
          ›
        </button>
      </div>

      <div className="max-h-[28vh] overflow-y-auto border-t border-zinc-800 bg-zinc-950/90 px-4 py-3 text-xs leading-relaxed text-zinc-400">
        <p className="mb-2">
          <span className="font-semibold text-zinc-200">Prompt: </span>
          {item.prompt}
        </p>
        {item.negativePrompt && (
          <p>
            <span className="font-semibold text-rose-400/90">Negative: </span>
            {item.negativePrompt}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------- app -----------------------------------

export default function App() {
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [page, setPage] = useState(1);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [pRes, mRes] = await Promise.all([
          fetch('prompts.json'),
          fetch('images/manifest.json').catch(() => null),
        ]);
        if (!pRes.ok) throw new Error(`Không tải được prompts.json (HTTP ${pRes.status})`);
        const pData: PromptItem[] = await pRes.json();
        const mData: Manifest | null = mRes?.ok ? ((await mRes.json()) as Manifest) : null;
        if (!alive) return;
        setPrompts(pData);
        setManifest(mData);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const manifestById = useMemo(() => {
    const m = new Map<string, ManifestItem>();
    for (const it of manifest?.items ?? []) m.set(it.id, it);
    return m;
  }, [manifest]);

  const items: GalleryItem[] = useMemo(
    () =>
      prompts.map((p) => ({
        id: p.id,
        prompt: p.prompt,
        negativePrompt: p.negative_prompt,
        index: p.index,
        image: manifestById.get(p.id) ?? null,
      })),
    [prompts, manifestById]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const from = fromId.trim() ? parseIdNum(fromId.trim().toUpperCase().startsWith('IMG_') ? fromId.trim().toUpperCase() : `IMG_${fromId.trim()}`) : 1;
    const to = toId.trim() ? parseIdNum(toId.trim().toUpperCase().startsWith('IMG_') ? toId.trim().toUpperCase() : `IMG_${toId.trim()}`) : Number.MAX_SAFE_INTEGER;
    return items.filter((it) => {
      const num = parseIdNum(it.id);
      if (num < from || num > to) return false;
      if (onlyMissing && it.image) return false;
      if (!q) return true;
      return (
        it.id.toLowerCase().includes(q) ||
        it.prompt.toLowerCase().includes(q) ||
        it.negativePrompt.toLowerCase().includes(q)
      );
    });
  }, [items, query, fromId, toId, onlyMissing]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [query, fromId, toId, onlyMissing]);

  const missingCount = items.filter((i) => !i.image).length;

  const downloadZip = useCallback(async () => {
    const withImages = filtered.filter((i) => i.image);
    if (withImages.length === 0) {
      alert('Không có ảnh nào trong kết quả đang lọc để tải.');
      return;
    }
    const zip = new JSZip();
    let n = 0;
    for (const it of withImages) {
      try {
        const res = await fetch(`images/${it.image!.filename}`);
        if (!res.ok) continue;
        const blob = await res.blob();
        zip.file(it.image!.filename, blob);
        n++;
      } catch {
        /* skip failed fetch */
      }
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prompt-gallery-images.zip';
    a.click();
    URL.revokeObjectURL(url);
    alert(`Đã tải ${n}/${withImages.length} ảnh trong bộ lọc hiện tại.`);
  }, [filtered]);

  const openLightbox = useCallback(
    (item: GalleryItem) => {
      setLightboxIndex(filtered.findIndex((f) => f.id === item.id));
    },
    [filtered]
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-zinc-400">
        Đang tải dữ liệu…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-semibold text-rose-400">Lỗi tải dữ liệu</p>
        <p className="text-sm text-zinc-400">{error}</p>
        <p className="text-xs text-zinc-500">
          Chạy <code className="rounded bg-zinc-800 px-1.5 py-0.5">npm run build</code> để đồng bộ
          prompts.json và images/manifest.json.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50 sm:text-3xl">
          🖼 Prompt Gallery{' '}
          <span className="font-mono text-amber-400">· ImagePrompt01</span>
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          {items.length} prompt từ{' '}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs">
            08_prompts_for_manual_image_generation.txt
          </code>{' '}
          · {items.length - missingCount} ảnh đã sinh ·{' '}
          <span className="text-amber-300">{missingCount} đang thiếu</span>
          {manifest?.generator && <span> · nguồn ảnh: {manifest.generator}</span>}
        </p>
      </header>

      {/* Toolbar */}
      <section className="sticky top-0 z-30 -mx-4 mb-6 border-b border-zinc-800 bg-zinc-950/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-52 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
              🔍
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo từ khoá trong prompt / ID…"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2 pl-9 pr-3 text-sm placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 text-sm">
            <label className="text-zinc-500">ID từ</label>
            <input
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
              placeholder="001"
              inputMode="numeric"
              className="w-20 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 text-center text-sm focus:border-amber-500 focus:outline-none"
            />
            <label className="text-zinc-500">đến</label>
            <input
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              placeholder="179"
              inputMode="numeric"
              className="w-20 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 text-center text-sm focus:border-amber-500 focus:outline-none"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={onlyMissing}
              onChange={(e) => setOnlyMissing(e.target.checked)}
              className="accent-amber-500"
            />
            Chỉ mục chưa có ảnh
          </label>

          <span className="rounded-lg bg-zinc-800/80 px-3 py-2 text-sm font-medium text-zinc-300">
            {filtered.length} kết quả
          </span>

          <button
            type="button"
            onClick={downloadZip}
            className="rounded-lg border border-amber-600/60 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-500/20"
          >
            ⬇ Tải ZIP (kết quả đang lọc)
          </button>
        </div>
      </section>

      {/* Grid */}
      {pageItems.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 p-16 text-center text-zinc-500">
          Không có mục nào khớp bộ lọc.
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {pageItems.map((it) => (
            <GalleryCard key={it.id} item={it} onOpen={openLightbox} />
          ))}
        </section>
      )}

      {/* Pagination */}
      {pageCount > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-30"
          >
            ‹ Trước
          </button>
          <span className="text-sm text-zinc-400">
            Trang <b className="text-zinc-100">{safePage}</b> / {pageCount}
          </span>
          <button
            type="button"
            disabled={safePage >= pageCount}
            onClick={() => setPage(safePage + 1)}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-30"
          >
            Sau ›
          </button>
        </nav>
      )}

      <footer className="mt-10 border-t border-zinc-800 pt-4 text-center text-xs text-zinc-600">
        Gallery tĩnh · Vite + React + TypeScript + Tailwind · Ảnh WebP (edge ≤ 1536px, q85)
      </footer>

      {lightboxIndex !== null && lightboxIndex >= 0 && (
        <Lightbox
          items={filtered}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNav={(i) => setLightboxIndex(i)}
        />
      )}
    </div>
  );
}
