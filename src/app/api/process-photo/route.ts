import { NextResponse } from "next/server";
import sharp from "sharp";

const MODEL = "@cf/black-forest-labs/flux-2-klein-9b";

export async function GET() {
  const configured = Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);
  return NextResponse.json({
    configured,
    provider: "Cloudflare Workers AI",
    model: MODEL,
    message: configured ? "Cloudflare AI credentials are configured." : "Cloudflare AI credentials are missing."
  });
}

export async function POST(request: Request) {
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken) {
      return NextResponse.json(
        { error: "ИИ не подключён. Проверьте CLOUDFLARE_ACCOUNT_ID и CLOUDFLARE_API_TOKEN." },
        { status: 503 }
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Загрузите файл изображения." }, { status: 400 });
    }
    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: "Файл больше 8 МБ. Уменьшите размер фотографии и повторите." }, { status: 413 });
    }

    const resizedImage = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize(511, 511, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();

    const prompt = [
      "Edit the supplied real-estate interior photograph. This is a photo enhancement task, not a redesign.",
      "Preserve the exact same room, architecture, geometry, wall positions, ceiling, floor, windows, doors, radiators, sockets, built-in appliances, furniture, objects, camera viewpoint and composition.",
      "Do not add, remove, move, replace or invent anything. Do not change the layout or room dimensions.",
      "Only make subtle professional real-estate photo corrections: natural exposure, neutral white balance, realistic colors, restrained contrast, reduced noise and clearer details.",
      "The result must look like the same original photograph of the same property."
    ].join(" ");

    const upstreamForm = new FormData();
    upstreamForm.append("prompt", prompt);
    upstreamForm.append("input_image_0", new Blob([resizedImage], { type: "image/jpeg" }), "interior-photo.jpg");
    upstreamForm.append("width", "1024");
    upstreamForm.append("height", "768");
    upstreamForm.append("guidance", "3.5");

    const upstream = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`
        },
        body: upstreamForm,
        signal: AbortSignal.timeout(110000)
      }
    );

    if (!upstream.ok) {
      const details = await upstream.text();
      console.error("Cloudflare Workers AI error:", upstream.status, details);
      return NextResponse.json(
        { error: `Cloudflare AI вернул HTTP ${upstream.status}: ${details.slice(0, 500)}` },
        { status: upstream.status >= 500 ? 502 : upstream.status }
      );
    }

    const contentType = upstream.headers.get("content-type") || "";
    if (contentType.startsWith("image/")) {
      return new Response(await upstream.arrayBuffer(), {
        headers: { "Content-Type": contentType, "Cache-Control": "no-store" }
      });
    }

    const payload = await upstream.json() as { result?: { image?: string }; errors?: Array<{ message?: string }> };
    const imageBase64 = payload.result?.image;
    if (!imageBase64) {
      console.error("Unexpected Cloudflare AI response:", JSON.stringify(payload).slice(0, 1000));
      return NextResponse.json(
        { error: payload.errors?.[0]?.message || "FLUX не вернул готовое изображение." },
        { status: 502 }
      );
    }

    return new Response(Buffer.from(imageBase64, "base64"), {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" }
    });
  } catch (error) {
    console.error("Photo processing failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка обработки фотографии." },
      { status: 500 }
    );
  }
}
