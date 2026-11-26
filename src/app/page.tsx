
"use client";

import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";

type Photo = {
  id: string;
  file: File;
  url: string;
  processedUrl?: string;
  processedBlob?: Blob;
};

type Settings = {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
};

type PlanMark = {
  id: number;
  type: "wall" | "window" | "door";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

const defaultSettings: Settings = {
  brightness: 110,
  contrast: 108,
  saturation: 108,
  warmth: 0,
};

const tools = [
  { id: "wall", label: "Стена", icon: "━" },
  { id: "window", label: "Окно", icon: "▤" },
  { id: "door", label: "Дверь", icon: "⌒" },
] as const;

export default function Home() {
  const [tab, setTab] = useState<"photos" | "plan">("photos");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [activePhoto, setActivePhoto] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [processing, setProcessing] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [showOriginal, setShowOriginal] = useState(false);
  const [planUrl, setPlanUrl] = useState<string | null>(null);
  const [planName, setPlanName] = useState("");
  const [planAiProcessing, setPlanAiProcessing] = useState(false);
  const [planAiNotice, setPlanAiNotice] = useState("");
  const [marks, setMarks] = useState<PlanMark[]>([]);
  const [tool, setTool] = useState<"wall" | "window" | "door">("wall");
  const [firstPoint, setFirstPoint] = useState<{ x: number; y: number } | null>(null);
  const [projectName, setProjectName] = useState("Новая квартира");
  const [notice, setNotice] = useState("");
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const planArea = useRef<HTMLDivElement>(null);

  const currentPhoto = photos.find((photo) => photo.id === activePhoto) ?? photos[0];

  useEffect(() => {
    fetch("/api/process-photo")
      .then((response) => response.json())
      .then((data: { configured?: boolean }) => setAiConfigured(data.configured === true))
      .catch(() => setAiConfigured(false));
  }, []);

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const valid = Array.from(files).filter((file) => file.type.startsWith("image/"));
    const added = valid.map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      url: URL.createObjectURL(file),
    }));
    setPhotos((old) => [...old, ...added]);
    if (added.length) setActivePhoto(added[0].id);
    setProcessed(0);
    setNotice("");
  }

  function removePhoto(id: string) {
    const photo = photos.find((item) => item.id === id);
    if (photo) {
      URL.revokeObjectURL(photo.url);
      if (photo.processedUrl) URL.revokeObjectURL(photo.processedUrl);
    }
    const next = photos.filter((item) => item.id !== id);
    setPhotos(next);
    if (activePhoto === id) setActivePhoto(next[0]?.id ?? null);
    setProcessed(0);
  }

  function updateSetting(key: keyof Settings, value: number) {
    setSettings((old) => ({ ...old, [key]: value }));
    setProcessed(0);
  }

  function filterString(value: Settings) {
    return `brightness(${value.brightness}%) contrast(${value.contrast}%) saturate(${value.saturation}%)`;
  }

  async function renderPhoto(photo: Photo, useAIResult = true): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Не удалось обработать изображение"));
          return;
        }

        context.filter = filterString(settings);
        context.drawImage(image, 0, 0);
        context.filter = "none";

        if (settings.warmth !== 0) {
          context.globalAlpha = Math.abs(settings.warmth) / 250;
          context.fillStyle = settings.warmth > 0 ? "#ffb36b" : "#79bfff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.globalAlpha = 1;
        }

        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Не удалось сохранить изображение"));
        }, "image/jpeg", 0.94);
      };
      image.onerror = () => reject(new Error("Ошибка загрузки изображения"));
      image.src = useAIResult ? (photo.processedUrl ?? photo.url) : photo.url;
    });
  }

  async function processPhotos() {
    if (!photos.length || processing) return;
    setProcessing(true);
    setProcessed(0);
    setNotice("Отправляем первую фотографию в облачную ИИ-модель...");

    try {
      for (let i = 0; i < photos.length; i++) {
        const form = new FormData();
        form.append("file", photos[i].file);
        const response = await fetch("/api/process-photo", { method: "POST", body: form });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `Ошибка ИИ-сервиса: ${response.status}`);
        }
        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) throw new Error("ИИ-сервис вернул не изображение.");
        const processedUrl = URL.createObjectURL(blob);
        setPhotos((current) => current.map((photo) => {
          if (photo.id !== photos[i].id) return photo;
          if (photo.processedUrl) URL.revokeObjectURL(photo.processedUrl);
          return { ...photo, processedUrl, processedBlob: blob };
        }));
        setProcessed(i + 1);
        setNotice(`ИИ обработал ${i + 1} из ${photos.length} фотографий.`);
      }
      setShowOriginal(false);
      setNotice("ИИ-обработка завершена. Сравните результат с оригиналом и скачайте архив.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось обработать фотографии.");
    } finally {
      setProcessing(false);
    }
  }

  async function downloadPhotos(useAIResult: boolean) {
    if (!photos.length || processing) return;
    if (useAIResult && photos.some((photo) => !photo.processedBlob)) {
      setNotice("Сначала запустите ИИ-обработку всех фотографий.");
      return;
    }
    setProcessing(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder(useAIResult ? "REALTY AI STUDIO - AI" : "REALTY AI STUDIO - manual");
      for (const photo of photos) {
        const blob = await renderPhoto(photo, useAIResult);
        const originalName = photo.file.name.replace(/\.[^.]+$/, "");
        folder?.file(`${originalName}-realty.jpg`, blob);
      }
      const archive = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(archive);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${projectName || "Квартира"}-${useAIResult ? "AI" : "коррекция"}-фото.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Архив готов. Фотографии сохранены.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось собрать архив.");
    } finally {
      setProcessing(false);
    }
  }

  function uploadPlan(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    if (planUrl) URL.revokeObjectURL(planUrl);
    setPlanUrl(URL.createObjectURL(file));
    setPlanName(file.name);
    setMarks([]);
    setFirstPoint(null);
  }

  async function tracePlanWithAI() {
    if (!planUrl || planAiProcessing) return;
    setPlanAiProcessing(true);
    setPlanAiNotice("ИИ анализирует планировку...");
    try {
      const source = await fetch(planUrl);
      const blob = await source.blob();
      const file = new File([blob], planName || "plan-image.png", { type: blob.type || "image/png" });
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/trace-plan", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось распознать планировку.");
      if (!Array.isArray(data.marks) || data.marks.length === 0) {
        throw new Error("ИИ не смог уверенно распознать линии. Попробуйте загрузить более чёткий скан.");
      }
      setMarks(data.marks.map((mark: { type: "wall" | "window" | "door"; x1: number; y1: number; x2: number; y2: number }, index: number) => ({
        id: Date.now() + index,
        type: mark.type,
        x1: mark.x1,
        y1: mark.y1,
        x2: mark.x2,
        y2: mark.y2
      })));
      setFirstPoint(null);
      setPlanAiNotice(`Распознано элементов: ${data.marks.length}. Проверьте линии и при необходимости поправьте их вручную.`);
    } catch (error) {
      setPlanAiNotice(error instanceof Error ? error.message : "Ошибка распознавания планировки.");
    } finally {
      setPlanAiProcessing(false);
    }
  }

  function addPlanMark(event: React.MouseEvent<HTMLDivElement>) {
    if (!planArea.current || !planUrl) return;
    const rect = planArea.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;

    if (!firstPoint) {
      setFirstPoint({ x, y });
      return;
    }

    setMarks((old) => [
      ...old,
      {
        id: Date.now(),
        type: tool,
        x1: firstPoint.x,
        y1: firstPoint.y,
        x2: x,
        y2: y,
      },
    ]);
    setFirstPoint(null);
  }

  function exportPlan() {
    if (!marks.length) {
      setPlanAiNotice("Сначала распознайте планировку или нанесите линии вручную.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = 1800;
    canvas.height = 1400;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#111111";
    ctx.lineCap = "square";
    ctx.lineJoin = "miter";

    const margin = 90;
    const sx = (canvas.width - margin * 2) / 100;
    const sy = (canvas.height - margin * 2) / 100;

    marks.forEach((mark) => {
      const x1 = margin + mark.x1 * sx;
      const y1 = margin + mark.y1 * sy;
      const x2 = margin + mark.x2 * sx;
      const y2 = margin + mark.y2 * sy;
      ctx.beginPath();
      ctx.lineWidth = mark.type === "wall" ? 13 : mark.type === "window" ? 7 : 5;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      if (mark.type === "window") {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.hypot(dx, dy) || 1;
        const ox = (-dy / length) * 9;
        const oy = (dx / length) * 9;
        ctx.beginPath();
        ctx.lineWidth = 3;
        ctx.moveTo(x1 + ox, y1 + oy);
        ctx.lineTo(x2 + ox, y2 + oy);
        ctx.stroke();
      }
    });

    canvas.toBlob((blob) => {
      if (!blob) {
        setPlanAiNotice("Не удалось подготовить JPG.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${projectName || "Планировка"}-план.jpg`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPlanAiNotice("JPG готов для загрузки на Авито. Проверьте точность линий.");
    }, "image/jpeg", 0.95);
  }

  function undoMark() {
    setMarks((old) => old.slice(0, -1));
    setFirstPoint(null);
  }

  function clearPlan() {
    setMarks([]);
    setFirstPoint(null);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-symbol">R</div>
          <div>
            <div className="brand-name">REALTY AI</div>
            <div className="brand-sub">STUDIO</div>
          </div>
        </div>

        <div className="side-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <button className={`nav-item ${tab === "photos" ? "active" : ""}`} onClick={() => setTab("photos")}>
          <span className="nav-icon">▧</span>
          Фотостудия
        </button>
        <button className={`nav-item ${tab === "plan" ? "active" : ""}`} onClick={() => setTab("plan")}>
          <span className="nav-icon">⌗</span>
          Планировщик
        </button>

        <div className="sidebar-bottom">
          <div className="free-label"><span /> Бесплатная версия</div>
          <div className="sidebar-caption">Инструменты для презентации объектов недвижимости</div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="breadcrumb">REALTY AI STUDIO <span>/</span> {tab === "photos" ? "ФОТОСТУДИЯ" : "ПЛАНИРОВЩИК"}</div>
          <div className="topbar-right">
            <span className="status-dot" /> {aiConfigured === true ? "Облачный ИИ подключён" : aiConfigured === false ? "Ручная коррекция · ИИ не подключён" : "Проверка ИИ..."}
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">ИНСТРУМЕНТЫ НЕДВИЖИМОСТИ</div>
              <h1>{tab === "photos" ? "Фотостудия" : "Планировщик"}</h1>
              <p>{tab === "photos" ? "Подготовьте фотографии квартиры к публикации." : "Создайте аккуратную схему помещения на основе исходной планировки."}</p>
            </div>
            <div className="project-field">
              <label htmlFor="project-name">НАЗВАНИЕ ОБЪЕКТА</label>
              <input id="project-name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
            </div>
          </div>

          {tab === "photos" ? (
            <div className="studio-grid">
              <section className="main-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Фотографии объекта</h2>
                    <p>Загрузите все кадры одной квартиры</p>
                  </div>
                  <span className="count-pill">{photos.length} фото</span>
                </div>

                <label className="upload-zone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addPhotos(e.dataTransfer.files); }}>
                  <input type="file" accept="image/*" multiple onChange={(e) => addPhotos(e.target.files)} />
                  <div className="upload-icon">↑</div>
                  <strong>Загрузить фотографии</strong>
                  <span>Перетащите файлы сюда или нажмите для выбора</span>
                  <small>JPG, PNG, WEBP · Можно выбрать сразу несколько файлов</small>
                </label>

                {photos.length > 0 ? (
                  <>
                    <div className="gallery-heading">
                      <span>ГАЛЕРЕЯ ОБЪЕКТА</span>
                      <button className="text-button" onClick={() => { photos.forEach((p) => { URL.revokeObjectURL(p.url); if (p.processedUrl) URL.revokeObjectURL(p.processedUrl); }); setPhotos([]); setActivePhoto(null); setProcessed(0); setNotice(""); }}>Удалить все</button>
                    </div>
                    <div className="photo-gallery">
                      {photos.map((photo) => (
                        <div key={photo.id} className={`photo-thumb ${activePhoto === photo.id ? "selected" : ""}`}>
                          <button className="thumb-image" onClick={() => { setActivePhoto(photo.id); setShowOriginal(false); }}>
                            <img src={photo.url} alt={photo.file.name} />
                          </button>
                          <button className="remove-photo" onClick={() => removePhoto(photo.id)} aria-label="Удалить фото">×</button>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="empty-gallery">
                    <div className="empty-icon">▧</div>
                    <strong>Здесь появятся фотографии квартиры</strong>
                    <span>Можно загрузить кухню, комнаты, санузел и общие планы одним пакетом.</span>
                  </div>
                )}

                {currentPhoto && (
                  <div className="preview-section">
                    <div className="gallery-heading">
                      <span>ПРЕДПРОСМОТР</span>
                      <button className="text-button" onClick={() => setShowOriginal(!showOriginal)}>
                        {showOriginal ? "Показать обработку" : "Показать оригинал"}
                      </button>
                    </div>
                    <div className="large-preview">
                      <img
                        src={showOriginal ? currentPhoto.url : (currentPhoto.processedUrl ?? currentPhoto.url)}
                        alt="Предпросмотр фотографии"
                        style={{ filter: showOriginal ? "none" : filterString(settings) }}
                      />
                      {!showOriginal && settings.warmth !== 0 && (
                        <div className="warmth-overlay" style={{
                          background: settings.warmth > 0 ? "rgba(255,179,107,0.12)" : "rgba(121,191,255,0.12)",
                          opacity: Math.abs(settings.warmth) / 100
                        }} />
                      )}
                      <span className="preview-tag">{showOriginal ? "ОРИГИНАЛ" : currentPhoto.processedBlob ? "ИИ-РЕЗУЛЬТАТ" : "ПРЕДПРОСМОТР"}</span>
                    </div>
                    <div className="file-name">{currentPhoto.file.name}</div>
                  </div>
                )}
              </section>

              <aside className="settings-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Коррекция изображения</h2>
                    <p>Настройки применяются ко всему пакету</p>
                  </div>
                </div>

                <div className="preset-box">
                  <div className="preset-icon">✦</div>
                  <div>
                    <strong>Единый стиль объекта</strong>
                    <span>Одинаковые параметры для всех кадров</span>
                  </div>
                </div>

                <div className="slider-group">
                  <div className="slider-label"><label htmlFor="brightness">Яркость</label><strong>{settings.brightness}%</strong></div>
                  <input id="brightness" type="range" min="60" max="150" value={settings.brightness} onChange={(e) => updateSetting("brightness", Number(e.target.value))} />
                </div>
                <div className="slider-group">
                  <div className="slider-label"><label htmlFor="contrast">Контраст</label><strong>{settings.contrast}%</strong></div>
                  <input id="contrast" type="range" min="60" max="150" value={settings.contrast} onChange={(e) => updateSetting("contrast", Number(e.target.value))} />
                </div>
                <div className="slider-group">
                  <div className="slider-label"><label htmlFor="saturation">Насыщенность</label><strong>{settings.saturation}%</strong></div>
                  <input id="saturation" type="range" min="0" max="160" value={settings.saturation} onChange={(e) => updateSetting("saturation", Number(e.target.value))} />
                </div>
                <div className="slider-group">
                  <div className="slider-label"><label htmlFor="warmth">Температура</label><strong>{settings.warmth > 0 ? `+${settings.warmth}` : settings.warmth}</strong></div>
                  <input id="warmth" type="range" min="-50" max="50" value={settings.warmth} onChange={(e) => updateSetting("warmth", Number(e.target.value))} />
                  <div className="range-hints"><span>Холоднее</span><span>Теплее</span></div>
                </div>

                <button className="secondary-button" onClick={() => { setSettings(defaultSettings); setProcessed(0); }}>Сбросить настройки</button>

                <div className="export-box">
                  <div className="export-title">ЭКСПОРТ ФОТОГРАФИЙ</div>
                  <p>Все загруженные кадры будут обработаны с одинаковыми настройками и собраны в ZIP-архив.</p>
                  {processing && (
                    <div className="progress-wrap">
                      <div className="progress-label"><span>Обработка</span><strong>{processed} / {photos.length}</strong></div>
                      <div className="progress-track"><div style={{ width: `${photos.length ? (processed / photos.length) * 100 : 0}%` }} /></div>
                    </div>
                  )}
                  <button className="primary-button" disabled={!photos.length || processing || aiConfigured !== true} onClick={processPhotos}>
                    {processing ? `ИИ обрабатывает ${processed}/${photos.length}...` : "✦ Запустить ИИ-обработку"}
                  </button>
                  <button className="secondary-button" disabled={!photos.length || processing} onClick={() => downloadPhotos(false)}>
                    ↓ Скачать ручную коррекцию (ZIP)
                  </button>
                  <button className="secondary-button" disabled={!photos.length || processing || photos.some((photo) => !photo.processedBlob)} onClick={() => downloadPhotos(true)}>
                    ↓ Скачать ИИ-обработку (ZIP)
                  </button>
                  {notice && <div className="notice" role="status">{notice}</div>}
                  {aiConfigured === false && <div className="warning-note"><strong>ИИ пока не подключён</strong><p>Чтобы включить облачную обработку, добавьте CLOUDFLARE_ACCOUNT_ID и CLOUDFLARE_API_TOKEN в секреты Codespaces. Пока можно корректировать фотографии вручную и скачивать ZIP.</p></div>}
                  <div className="export-note">Ручная коррекция работает без ключей и без отправки фото на сервер. Облачный ИИ требует бесплатный аккаунт Cloudflare и API-токен. ИИ-результат может менять детали помещения — сравнивайте его с оригиналом.</div>
                </div>
              </aside>
            </div>
          ) : (
            <div className="plan-layout">
              <section className="main-panel plan-main">
                <div className="panel-heading">
                  <div>
                    <h2>Чёрно-белый план</h2>
                    <p>Загрузите эскиз, распознайте линии и скачайте JPG для Авито</p>
                  </div>
                  {planUrl && <span className="count-pill">{marks.length} элементов</span>}
                </div>

                <label className="plan-upload">
                  <input type="file" accept="image/*" onChange={(e) => uploadPlan(e.target.files?.[0])} />
                  <span>↑</span>
                  <strong>{planUrl ? "Заменить изображение планировки" : "Загрузить планировку"}</strong>
                  <small>PNG, JPG или WEBP</small>
                </label>

                {planUrl ? (
                  <>
                    <div className="plan-toolbar">
                      <div className="tool-buttons">
                        {tools.map((item) => (
                          <button key={item.id} className={`tool-button ${tool === item.id ? "chosen" : ""}`} onClick={() => { setTool(item.id); setFirstPoint(null); }}>
                            <span>{item.icon}</span>{item.label}
                          </button>
                        ))}
                      </div>
                      <div className="tool-actions">
                        <button className="text-button" onClick={undoMark}>Отменить</button>
                        <button className="text-button" onClick={clearPlan}>Очистить</button>
                      </div>
                    </div>

                    <button className="primary-button plan-ai-button" onClick={tracePlanWithAI} disabled={planAiProcessing || aiConfigured !== true}>
                      {planAiProcessing ? "ИИ распознаёт планировку..." : "✦ Обвести планировку с помощью ИИ"}
                    </button>
                    {planAiNotice && <div className="notice" role="status">{planAiNotice}</div>}
                    {aiConfigured === false && <div className="export-note">Для автоматической обрисовки нужны ключи Cloudflare Workers AI.</div>}

                    <div className="drawing-hint">
                      {firstPoint ? "Теперь нажмите в точке окончания линии." : "Нажмите в двух точках изображения, чтобы добавить элемент."}
                    </div>

                    <div className="plan-canvas" ref={planArea} onClick={addPlanMark} style={{ background: "#ffffff" }}>
                      <img src={planUrl} alt="" aria-hidden="true" style={{ opacity: 0 }} />
                      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                        <rect x="0" y="0" width="100" height="100" fill="#ffffff" />
                        {marks.map((mark) => (
                          <g key={mark.id}>
                            <line
                              x1={mark.x1} y1={mark.y1} x2={mark.x2} y2={mark.y2}
                              stroke="#111111"
                              strokeWidth={mark.type === "wall" ? 1.15 : mark.type === "window" ? 0.75 : 0.55}
                              strokeLinecap="square"
                            />
                            {mark.type === "window" && (
                              <line x1={mark.x1} y1={mark.y1} x2={mark.x2} y2={mark.y2} stroke="#111111" strokeWidth="0.2" />
                            )}
                          </g>
                        ))}
                        {firstPoint && <circle cx={firstPoint.x} cy={firstPoint.y} r="0.8" fill="#111111" />}
                      </svg>
                    </div>
                    <div className="plan-legend">
                      <span><i className="legend-wall" /> Стены</span>
                      <span><i className="legend-window" /> Окна</span>
                      <span><i className="legend-door" /> Двери</span>
                    </div>
                    <div className="plan-bottom">
                      <span>{planName}</span>
                      <button className="primary-button compact" onClick={exportPlan}>↓ Скачать JPG для Авито</button>
                    </div>
                  </>
                ) : (
                  <div className="plan-empty">
                    <div className="plan-empty-icon">⌗</div>
                    <strong>Рабочее поле планировщика</strong>
                    <span>После загрузки изображения здесь можно будет обозначить стены, двери и окна.</span>
                  </div>
                )}
              </section>

              <aside className="settings-panel plan-info">
                <div className="panel-heading">
                  <div>
                    <h2>Инструменты</h2>
                    <p>Ручная разметка плана</p>
                  </div>
                </div>
                <div className="info-card">
                  <div className="info-card-icon">01</div>
                  <div><strong>Загрузите изображение</strong><span>Используйте фото или скан существующей планировки.</span></div>
                </div>
                <div className="info-card">
                  <div className="info-card-icon">02</div>
                  <div><strong>Выберите элемент</strong><span>Стена, окно или дверь. Для каждого элемента укажите начало и конец линии.</span></div>
                </div>
                <div className="info-card">
                  <div className="info-card-icon">03</div>
                  <div><strong>Сохраните результат</strong><span>Экспортируйте изображение с нанесённой разметкой.</span></div>
                </div>
                <div className="warning-note">
                  <strong>Важно</strong>
                  <p>ИИ распознаёт только видимые линии исходного эскиза. Сверьте результат с оригиналом: скрытые стены и точные размеры автоматически не восстанавливаются.</p>
                </div>
                <div className="plan-stats">
                  <div><span>Добавлено элементов</span><strong>{marks.length}</strong></div>
                  <div><span>Исходный файл</span><strong className="file-status">{planUrl ? "Загружен" : "Не загружен"}</strong></div>
                </div>
              </aside>
            </div>
          )}
          <footer className="page-footer">REALTY AI STUDIO <span>Инструменты для работы с недвижимостью</span></footer>
        </div>
      </section>
    </main>
  );
}
