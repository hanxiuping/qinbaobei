"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import SparkMD5 from "spark-md5";

const CHUNK_SIZE = 4 * 1024 * 1024;

type MemoryKind = "photo" | "video";

type MemoryItem = {
  id: string;
  title: string;
  date: string;
  time: string;
  kind: MemoryKind;
  source?: string;
  streamUrl?: string;
  thumbnail?: string;
  fileName?: string;
  size?: number;
  cloudPath?: string;
  status: "local" | "uploading" | "cloud" | "failed";
  progress: number;
};

type BaiduStatus = {
  appDirectory: string;
  appName: string;
  connected: boolean;
  backendBound: boolean;
  hasSecretKey: boolean;
  redirectUri: string;
  scope: string;
};

type BaiduCloudFile = {
  id: string;
  name: string;
  path: string;
  size: number;
  mtime: number;
  kind: "photo" | "video" | "file";
  thumbnail?: string;
  dlink?: string;
};

const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

function formatMonthDay(date: string) {
  const d = new Date(`${date}T00:00:00`);
  return `${MONTHS[d.getMonth()]}${d.getDate()}日`;
}

function formatWeekdate(date: string) {
  return new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(new Date(`${date}T00:00:00`));
}

function readableSize(size?: number) {
  if (!size) return "";
  if (size > 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(1)}GB`;
  if (size > 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  return `${(size / 1024).toFixed(0)}KB`;
}

const USERS = ["小树", "大树"] as const;
type User = (typeof USERS)[number];

export function MemoryHome() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [selected, setSelected] = useState<MemoryItem | null>(null);
  const [filter, setFilter] = useState<"all" | MemoryKind>("all");
  const [currentUser, setCurrentUser] = useState<User>(() => {
    if (typeof window !== "undefined") return (localStorage.getItem("album_user") as User) || "小树";
    return "小树";
  });
  const [baiduStatus, setBaiduStatus] = useState<BaiduStatus | null>(null);
  const [toast, setToast] = useState<string>("");
  const [loadingCloud, setLoadingCloud] = useState(false);
  const [dateFolders, setDateFolders] = useState<string[]>([]);
  const [expandedYear, setExpandedYear] = useState<string | null>(null);
  const [loadedDates, setLoadedDates] = useState<Set<string>>(new Set());
  const [loadingDate, setLoadingDate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    return memories
      .filter((item) => (filter === "all" || item.kind === filter) && (!expandedYear || item.date.startsWith(expandedYear)))
      .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  }, [filter, memories, expandedYear]);

  const grouped = useMemo(() => {
    return filtered.reduce<Record<string, MemoryItem[]>>((groups, item) => {
      (groups[item.date] = groups[item.date] ? [...groups[item.date], item] : [item]);
      return groups;
    }, {});
  }, [filtered]);

  const yearList = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const folder of dateFolders) {
      const year = folder.slice(0, 4);
      if (!map[year]) map[year] = [];
      map[year].push(folder);
    }
    return Object.keys(map)
      .sort((a, b) => b.localeCompare(a))
      .map((year) => ({ year, months: map[year].sort((a, b) => b.localeCompare(a)) }));
  }, [dateFolders]);

  const photoCount = filtered.filter((item) => item.kind === "photo").length;
  const videoCount = filtered.filter((item) => item.kind === "video").length;

  // ─── Viewer history management (mobile back button) ──────────────────
  useEffect(() => {
    if (!selected) return;
    history.pushState({ viewer: true }, "");
    const onPop = () => setSelected(null);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (history.state?.viewer) history.back();
    };
  }, [selected]);

  // ─── Load on mount / user change ─────────────────────────────────────
  useEffect(() => {
    localStorage.setItem("album_user", currentUser);
    setMemories([]);
    setDateFolders([]);
    setLoadedDates(new Set());
    setExpandedYear(null);
    void refreshBaiduStatus().then(() => {
      void loadCloudFiles(true);
    });
    const params = new URLSearchParams(window.location.search);
    const baidu = params.get("baidu");
    if (baidu === "connected") {
      showToast("百度网盘已绑定");
      window.history.replaceState({}, "", "/");
    } else if (baidu === "failed") {
      showToast(`百度授权失败：${params.get("message") ?? "请检查回调地址配置"}`);
      window.history.replaceState({}, "", "/");
    } else if (baidu === "denied") {
      showToast("已取消百度授权");
      window.history.replaceState({}, "", "/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // ─── Lazy-load months when year expanded ─────────────────────────────
  useEffect(() => {
    if (!expandedYear) return;
    const months = yearList.find((y) => y.year === expandedYear)?.months;
    if (!months) return;

    // Immediately load the first unloaded month (don't rely solely on observer)
    const firstUnloaded = months.find((m) => !loadedDates.has(m));
    if (firstUnloaded && !loadingDate) void loadDateFiles(firstUnloaded);

    // Also set up observer for subsequent months
    const nextMonth = months.find((m) => !loadedDates.has(m) && m !== firstUnloaded);
    if (!nextMonth) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) void loadDateFiles(nextMonth);
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [expandedYear, yearList, loadedDates, loadingDate]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 4000);
  }

  function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter(
      (file) => file.type.startsWith("image/") || file.type.startsWith("video/"),
    );
    if (!files.length) return;

    const additions: MemoryItem[] = files.map((file) => {
      const fileDate = new Date(file.lastModified || Date.now());
      const ext = file.name.match(/\.[^/.]+$/)?.[0] ?? "";
      const yyyy = fileDate.getFullYear();
      const mm = String(fileDate.getMonth() + 1).padStart(2, "0");
      const dd = String(fileDate.getDate()).padStart(2, "0");
      const ts = Math.floor(fileDate.getTime() / 1000);
      const newFileName = `${yyyy}-${mm}-${dd}-${ts}${ext}`;
      return {
        id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
        title: newFileName.replace(/\.[^/.]+$/, ""),
        date: fileDate.toISOString().slice(0, 10),
        time: fileDate.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }),
        kind: file.type.startsWith("video/") ? "video" : "photo",
        source: URL.createObjectURL(file),
        fileName: newFileName,
        size: file.size,
        status: "local",
        progress: 0,
      };
    });

    setMemories((current) => [...additions, ...current]);

    if (baiduStatus?.connected) {
      void uploadToBaidu(files, additions.map((item) => item.id));
    } else {
      showToast("还没绑定百度网盘，点右上角「绑定」后即可自动上传到网盘");
    }
  }

  async function computeChunkMD5s(file: File): Promise<string[]> {
    const md5s: string[] = [];
    for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
      const chunk = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await chunk.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      md5s.push(SparkMD5.hashBinary(binary));
    }
    return md5s;
  }

  function updateProgress(itemId: string, chunkDone: number, totalChunks: number) {
    const pct = Math.round((chunkDone / totalChunks) * 100);
    setMemories((current) =>
      current.map((item) => (item.id === itemId ? { ...item, progress: pct } : item)),
    );
  }

  async function uploadSingleFile(file: File, itemId: string) {
    setMemories((current) =>
      current.map((item) => (item.id === itemId ? { ...item, status: "uploading", progress: 0 } : item)),
    );

    const item = memories.find((m) => m.id === itemId);
    const uploadName = item?.fileName || file.name;
    const fileDate = new Date(file.lastModified || Date.now()).toISOString();

    try {
      const md5s = await computeChunkMD5s(file);
      const totalChunks = md5s.length;

      const initRes = await fetch("/api/baidu/upload/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: uploadName, size: file.size, md5s, fileDate, user: currentUser }),
      });
      const initText = await initRes.text();
      let initData: { path?: string; uploadid?: string; return_type?: number; requiredBlocks?: number[]; fsId?: string; message?: string; error?: string };
      try { initData = JSON.parse(initText); } catch {
        throw new Error(`init 返回非JSON (HTTP ${initRes.status}): ${initText.slice(0, 120)}`);
      }
      if (!initRes.ok) throw new Error(initData.message ?? initData.error ?? `init 失败 HTTP ${initRes.status}`);

      if (initData.return_type === 2) {
        setMemories((current) =>
          current.map((item) => (item.id === itemId ? { ...item, status: "cloud", progress: 100 } : item)),
        );
        return;
      }

      const { path: filePath, uploadid, requiredBlocks } = initData;
      if (!filePath || !uploadid || !requiredBlocks) throw new Error("init 返回数据不完整");

      for (const blockIdx of requiredBlocks) {
        const offset = blockIdx * CHUNK_SIZE;
        const chunk = file.slice(offset, offset + CHUNK_SIZE);
        const formData = new FormData();
        formData.append("file", chunk, file.name);
        formData.append("path", filePath);
        formData.append("uploadid", uploadid);
        formData.append("partseq", String(blockIdx));

        const chunkRes = await fetch("/api/baidu/upload/chunk", { method: "POST", body: formData });
        const chunkText = await chunkRes.text();
        let chunkData: { ok?: boolean; message?: string; error?: string };
        try { chunkData = JSON.parse(chunkText); } catch {
          throw new Error(`chunk 返回非JSON (HTTP ${chunkRes.status}): ${chunkText.slice(0, 120)}`);
        }
        if (!chunkRes.ok) throw new Error(chunkData.message ?? chunkData.error ?? `分片 ${blockIdx} 失败`);
        updateProgress(itemId, blockIdx + 1, totalChunks);
      }

      const finishRes = await fetch("/api/baidu/upload/finish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: filePath, size: file.size, uploadid, block_list: md5s }),
      });
      const finishText = await finishRes.text();
      let finishData: { ok?: boolean; message?: string; error?: string };
      try { finishData = JSON.parse(finishText); } catch {
        throw new Error(`finish 返回非JSON (HTTP ${finishRes.status}): ${finishText.slice(0, 120)}`);
      }
      if (!finishRes.ok) throw new Error(finishData.message ?? finishData.error ?? `finish 失败 HTTP ${finishRes.status}`);

      setMemories((current) =>
        current.map((item) => (item.id === itemId ? { ...item, status: "cloud", progress: 100 } : item)),
      );
    } catch (caught) {
      setMemories((current) =>
        current.map((item) => (item.id === itemId ? { ...item, status: "failed", progress: 0 } : item)),
      );
      showToast(caught instanceof Error ? `上传失败：${caught.message}` : "上传到百度网盘失败");
    }
  }

  async function uploadToBaidu(files: File[], ids: string[]) {
    for (let i = 0; i < files.length; i++) {
      await uploadSingleFile(files[i], ids[i]);
    }
    const final = ids.filter((id) =>
      memories.find((m) => m.id === id)?.status !== "failed",
    );
    if (final.length) showToast(`已上传 ${final.length} 个文件到网盘`);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (event.dataTransfer.files) addFiles(event.dataTransfer.files);
  }

  async function refreshBaiduStatus() {
    try {
      const response = await fetch("/api/baidu/status");
      const text = await response.text();
      const status = JSON.parse(text) as BaiduStatus;
      setBaiduStatus(status);
    } catch {
      /* 后端未就绪时静默 */
    }
  }

  async function loadCloudFiles(silent = false) {
    if (!silent) setLoadingCloud(true);
    try {
      const response = await fetch(`/api/baidu/files?user=${encodeURIComponent(currentUser)}`);
      const text = await response.text();
      let payload: { dates?: string[]; message?: string };
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`服务端返回非JSON (HTTP ${response.status}): ${text.slice(0, 120)}`);
      }
      if (!response.ok) throw new Error(payload.message ?? "读取网盘失败");
      setDateFolders(payload.dates ?? []);
      setLoadedDates(new Set());
      setMemories((current) => current.filter((item) => item.status === "local" || item.status === "uploading"));
      // Auto-expand most recent year
      if (payload.dates?.length) {
        const latestYear = payload.dates[0].slice(0, 4);
        setExpandedYear(latestYear);
      }
    } catch {
      /* 静默 */
    } finally {
      setLoadingCloud(false);
    }
  }

  async function loadDateFiles(datePath: string) {
    if (loadedDates.has(datePath) || loadingDate) return;
    setLoadingDate(true);
    try {
      const response = await fetch(`/api/baidu/files?date=${encodeURIComponent(datePath)}&user=${encodeURIComponent(currentUser)}`);
      const payload: { files?: BaiduCloudFile[] } = await response.json();
      const items = (payload.files ?? [])
        .filter((file) => file.kind === "photo" || file.kind === "video")
        .map(toCloudMemory);
      setMemories((current) => [...current, ...items]);
      setLoadedDates((prev) => new Set(prev).add(datePath));
    } catch {
      /* 静默 */
    } finally {
      setLoadingDate(false);
    }
  }

  async function deleteCloudFile(item: MemoryItem) {
    if (!item.cloudPath) return;
    if (!window.confirm(`确定删除「${item.title}」？此操作不可恢复。`)) return;

    try {
      const res = await fetch("/api/baidu/delete", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: item.cloudPath }),
      });
      const text = await res.text();
      let data: { ok?: boolean; message?: string };
      try { data = JSON.parse(text); } catch { throw new Error("服务端返回异常"); }
      if (!res.ok) throw new Error(data.message ?? "删除失败");

      setMemories((current) => current.filter((m) => m.id !== item.id));
      setSelected(null);
      showToast("已删除");
    } catch (err) {
      showToast(err instanceof Error ? `删除失败：${err.message}` : "删除失败");
    }
  }

  function expandYear(year: string) {
    setExpandedYear(year);
  }

  function getViewerSrc(item: MemoryItem): string {
    if (item.source) return item.source;
    if (item.cloudPath) {
      return item.kind === "video"
        ? `/api/baidu/stream?path=${encodeURIComponent(item.cloudPath)}`
        : `/api/baidu/thumbnail?path=${encodeURIComponent(item.cloudPath)}&size=2048`;
    }
    return item.thumbnail || "";
  }

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-avatar">亲</span>
          <div className="brand-text">
            <strong>亲宝贝</strong>
            <small>家庭云相册</small>
          </div>
        </div>

        <div className="user-picker">
          {USERS.map((u) => (
            <button
              key={u}
              type="button"
              className={`user-tab ${currentUser === u ? "active" : ""}`}
              onClick={() => setCurrentUser(u)}
            >
              {u}
            </button>
          ))}
        </div>

        <div className="topbar-actions">
          {baiduStatus?.connected && (
              <button type="button" className="link-btn" onClick={() => void loadCloudFiles(false)} disabled={loadingCloud}>
                {loadingCloud ? "读取中..." : "刷新"}
              </button>
          )}
          {!baiduStatus?.connected && (
            <a className="link-btn" href="/api/baidu/auth">绑定网盘</a>
          )}
          <button type="button" className="add-btn" onClick={() => fileInputRef.current?.click()} aria-label="添加照片或视频">
            +
          </button>
          <button
            type="button"
            className="link-btn"
            onClick={async () => {
              await fetch("/api/portal/session", { method: "DELETE" });
              window.location.reload();
            }}
          >
            退出
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={handleFileChange}
            hidden
          />
        </div>
      </header>

      {memories.length > 0 && (
        <div className="filter-bar">
          <div className="tabs">
            <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
              全部
            </button>
            <button type="button" className={filter === "photo" ? "active" : ""} onClick={() => setFilter("photo")}>
              照片
            </button>
            <button type="button" className={filter === "video" ? "active" : ""} onClick={() => setFilter("video")}>
              视频
            </button>
          </div>
          <div className="count">
            {photoCount} 照片 · {videoCount} 视频
          </div>
        </div>
      )}

      <main className="content">
        {dateFolders.length === 0 && !loadingCloud ? (
          <div className="empty">
            <div className="empty-icon">📷</div>
            <h2>还没有照片或视频</h2>
            <p>
              {baiduStatus?.connected
                ? "点右下角「+」添加照片视频，会自动按日期归档到百度网盘。"
                : "网盘还没绑定授权，请联系管理员完成一次授权（仅需一次，之后所有设备都能用）。"}
            </p>
            {baiduStatus?.connected ? (
              <button type="button" className="primary-btn" onClick={() => void loadCloudFiles(false)}>
                读取网盘已有文件
              </button>
            ) : (
              <a className="admin-link" href="/api/baidu/auth">
                管理员一次性授权 →
              </a>
            )}
          </div>
        ) : !expandedYear ? (
          /* ─── Year cards view ─────────────────────────────────── */
          <div className="year-list">
            {yearList.map(({ year, months }) => {
              const yearMemories = memories.filter((m) => m.date.startsWith(year));
              const photoCnt = yearMemories.filter((m) => m.kind === "photo").length;
              const videoCnt = yearMemories.filter((m) => m.kind === "video").length;
              return (
                <button
                  key={year}
                  type="button"
                  className="year-card"
                  onClick={() => expandYear(year)}
                >
                  <span className="year-label">{year}</span>
                  <span className="year-info">
                    {photoCnt > 0 && `${photoCnt}张照片`}
                    {photoCnt > 0 && videoCnt > 0 && " · "}
                    {videoCnt > 0 && `${videoCnt}个视频`}
                    {!photoCnt && !videoCnt && `${months.length}个月`}
                  </span>
                  <span className="year-arrow">›</span>
                </button>
              );
            })}
            {loadingCloud && <div style={{ textAlign: "center", padding: "24px", color: "#bbb", fontSize: 13 }}>加载中...</div>}
          </div>
        ) : (
          /* ─── Timeline view (expanded year) ────────────────────── */
          <div className="timeline">
            <div className="year-nav">
              <button type="button" className="year-back" onClick={() => setExpandedYear(null)}>
                ‹ 全部年份
              </button>
              <span className="year-current">{expandedYear}</span>
            </div>
            {Object.entries(grouped).map(([date, items]) => (
              <section className="day" key={date}>
                <div className="day-head">
                  <span className="day-date">{formatMonthDay(date)}</span>
                  <span className="day-week">{formatWeekdate(date)}</span>
                  <span className="day-count">{items.length}张</span>
                </div>
                <div className="grid">
                  {items.map((item) => (
                    <button
                      type="button"
                      className={`cell ${item.kind === "video" ? "is-video" : ""}`}
                      key={item.id}
                      onClick={() => setSelected(item)}
                    >
                      {(item.source || item.thumbnail) ? (
                        item.kind === "photo" ? (
                          <img
                            src={item.source ?? item.thumbnail}
                            alt=""
                            loading="lazy"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : (
                          <video
                            src={undefined}
                            poster={item.thumbnail || undefined}
                            muted
                            playsInline
                            preload="none"
                            onMouseEnter={(e) => {
                              const v = e.target as HTMLVideoElement;
                              v.src = item.streamUrl || item.source || "";
                              v.play().catch(() => {});
                            }}
                            onMouseLeave={(e) => {
                              const v = e.target as HTMLVideoElement;
                              v.pause();
                              v.removeAttribute("src");
                              v.load();
                            }}
                          />
                        )
                      ) : (
                        <span className="cell-placeholder" />
                      )}
                      {item.kind === "video" && <span className="badge-video">&#9654;</span>}
                      {item.status === "uploading" && (
                        <span className="badge-upload">
                          <span className="spinner" /> {item.progress > 0 ? `${item.progress}%` : "上传中"}
                        </span>
                      )}
                      {item.status === "failed" && <span className="badge-fail">失败</span>}
                    </button>
                  ))}
                </div>
              </section>
            ))}
            <div ref={sentinelRef} style={{ height: 1 }} />
            {loadingDate && <div style={{ textAlign: "center", padding: "16px", color: "#bbb", fontSize: 13 }}>加载中...</div>}
          </div>
        )}
      </main>

      {memories.length > 0 && (
        <button type="button" className="fab" onClick={() => fileInputRef.current?.click()} aria-label="添加">
          +
        </button>
      )}

      {toast && <div className="toast">{toast}</div>}

      {selected ? (
        <div className="viewer" role="dialog" aria-modal="true" onClick={() => setSelected(null)}>
          <button className="viewer-close" type="button" aria-label="关闭">×</button>
          <div className="viewer-media" onClick={(e) => e.stopPropagation()}>
            {selected.source || selected.thumbnail || selected.cloudPath ? (
              selected.kind === "photo" ? (
                <img src={getViewerSrc(selected)} alt={selected.title} />
              ) : (
                <video src={selected.streamUrl || selected.source} poster={selected.thumbnail} controls autoPlay playsInline />
              )
            ) : (
              <div className="viewer-empty">无预览</div>
            )}
          </div>
          <div className="viewer-info" onClick={(e) => e.stopPropagation()}>
            <h3>{selected.title}</h3>
            <p>
              {formatMonthDay(selected.date)} {selected.time}
              {selected.fileName ? ` · ${readableSize(selected.size)}` : ""}
            </p>
            <span className={`status-pill ${selected.status}`}>
              {selected.status === "cloud"
                ? "已保存到网盘"
                : selected.status === "uploading"
                  ? `上传中 ${selected.progress}%`
                  : selected.status === "failed"
                    ? "上传失败"
                    : "本地待上传"}
            </span>
            {selected.status === "cloud" && selected.cloudPath && (
              <button type="button" className="delete-btn" onClick={() => void deleteCloudFile(selected)}>
                删除
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function toCloudMemory(file: BaiduCloudFile): MemoryItem {
  const isVideo = file.kind === "video";
  const dateFromPath = extractDateFromPath(file.path);
  const dateObj = dateFromPath || (file.mtime ? new Date(file.mtime * 1000) : new Date());
  return {
    id: `cloud-${file.id}`,
    title: file.name.replace(/\.[^/.]+$/, ""),
    date: dateObj.toISOString().slice(0, 10),
    time: dateObj.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }),
    kind: isVideo ? "video" : "photo",
    thumbnail: file.thumbnail,
    streamUrl: isVideo ? `/api/baidu/stream?path=${encodeURIComponent(file.path)}` : undefined,
    fileName: file.name,
    size: file.size,
    cloudPath: file.path,
    status: "cloud",
    progress: 100,
  };
}

function extractDateFromPath(path: string): Date | null {
  const filename = path.split("/").pop() ?? "";
  const m = filename.match(/^(\d{4})-(\d{2})-(\d{2})-\d+/);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
    if (!isNaN(d.getTime())) return d;
  }
  const m2 = path.match(/\/(\d{4}-\d{2})\//);
  if (m2) {
    const d = new Date(`${m2[1]}-01T00:00:00`);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}
