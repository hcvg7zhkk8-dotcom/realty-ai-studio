import { NextResponse } from "next/server";

const MODEL = "@cf/moondream/moondream3.1-9B-A2B";

type Segment = {
  type: "wall" | "window" | "door";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

function extractJson(value: string): unknown {
  const cleaned = value.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Модель не вернула структурированную разметку.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function POST(request: Request) {
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !apiToken) {
      return NextResponse.json({ error: "ИИ не подключён. Добавьте CLOUDFLARE_ACCOUNT_ID и CLOUDFLARE_API_TOKEN в Secrets Codespaces." }, { status: 503 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Загрузите изображение планировки." }, { status: 400 });
    }
    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: "Изображение больше 8 МБ. Уменьшите файл и повторите." }, { status: 413 });
    }

    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const image = `data:${file.type};base64,${base64}`;
    const question = `Analyze this apartment floor plan image. Return ONLY valid JSON, no markdown or explanation, with this exact structure: {"marks":[{"type":"wall","x1":0,"y1":0,"x2":1000,"y2":1000}]}. Coordinates must be normalized from 0 to 1000 relative to the FULL image: x grows left to right, y grows top to bottom. Detect only clearly visible architectural line segments: wall segments as type "wall", window openings/lines as type "window", door leaf or door opening arcs as type "door". Split long walls at corners and junctions. Do not invent hidden walls or furniture. Ignore dimensions, labels, furniture, symbols that are not doors/windows, page borders, and shadows. Include as many clear segments as possible, maximum 100. If the image is not a floor plan, return {"marks":[]}. Be conservative: only trace lines that are actually visible.`;

    const upstream = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          task: "query",
          image,
          question,
          reasoning: false,
          temperature: 0,
          max_tokens: 6000,
          stream: false
        }),
        signal: AbortSignal.timeout(110000)
      }
    );

    if (!upstream.ok) {
      const details = await upstream.text();
      console.error("Cloudflare plan vision error:", upstream.status, details);
      return NextResponse.json({ error: `Cloudflare Vision вернул HTTP ${upstream.status}. Проверьте токен и дневную квоту.` }, { status: upstream.status >= 500 ? 502 : upstream.status });
    }

    const payload = await upstream.json() as { result?: { answer?: string }; answer?: string };
    const answer = payload.result?.answer ?? payload.answer;
    if (typeof answer !== "string") {
      console.error("Unexpected Moondream response:", payload);
      return NextResponse.json({ error: "ИИ вернул неизвестный формат разметки." }, { status: 502 });
    }

    const parsed = extractJson(answer) as { marks?: Segment[] };
    const marks = Array.isArray(parsed.marks) ? parsed.marks.filter((mark) =>
      mark &&
      (mark.type === "wall" || mark.type === "window" || mark.type === "door") &&
      [mark.x1, mark.y1, mark.x2, mark.y2].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000) &&
      Math.hypot(mark.x2 - mark.x1, mark.y2 - mark.y1) > 8
    ).slice(0, 100).map((mark) => ({
      type: mark.type,
      x1: mark.x1 / 10,
      y1: mark.y1 / 10,
      x2: mark.x2 / 10,
      y2: mark.y2 / 10
    })) : [];

    return NextResponse.json({ marks, model: MODEL });
  } catch (error) {
    console.error("Plan tracing failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка распознавания планировки." }, { status: 500 });
  }
}
