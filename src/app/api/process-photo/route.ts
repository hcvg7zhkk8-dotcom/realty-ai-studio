import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = "@cf/runwayml/stable-diffusion-v1-5-img2img";

export async function POST(request: Request) {
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken) {
      return NextResponse.json(
        { error: "ИИ не подключён: добавьте CLOUDFLARE_ACCOUNT_ID и CLOUDFLARE_API_TOKEN в Secrets Codespaces." },
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

    const image_b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const prompt = [
      "Professionally enhance this exact real-estate interior photograph for a property listing.",
      "Preserve the original room, exact architecture, geometry, wall positions, ceiling height, floor, windows, doors, radiators, sockets, built-in appliances, furniture and every permanent feature.",
      "Do not redesign, remodel, add, remove or move any architectural element or furniture.",
      "Keep the same camera viewpoint and composition. Apply only subtle natural photographic improvements: balanced exposure, realistic white balance, gentle noise reduction, natural detail and professional interior-photo clarity.",
      "The result must remain a faithful photograph of the same real property, not a newly imagined interior."
    ].join(" ");

    const upstream = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
          Accept: "image/png"
        },
        body: JSON.stringify({
          prompt,
          negative_prompt: "different room, changed layout, moved walls, extra windows, missing windows, changed doors, changed furniture, added furniture, removed furniture, invented objects, distorted geometry, fisheye, oversaturated, CGI, illustration, painting, text, watermark",
          image_b64,
          strength: 0.18,
          guidance: 5,
          num_steps: 20
        }),
        signal: AbortSignal.timeout(110000)
      }
    );

    if (!upstream.ok) {
      const details = await upstream.text();
      console.error("Cloudflare Workers AI error:", upstream.status, details);
      return NextResponse.json(
        { error: `Cloudflare AI: HTTP ${upstream.status}. Проверьте API-токен, права доступа, лимит и доступность модели.` },
        { status: upstream.status >= 500 ? 502 : upstream.status }
      );
    }

    const contentType = upstream.headers.get("content-type") || "image/png";
    if (!contentType.startsWith("image/")) {
      console.error("Unexpected Cloudflare AI response:", await upstream.text());
      return NextResponse.json({ error: "ИИ-сервис вернул неожиданный формат ответа." }, { status: 502 });
    }

    return new Response(await upstream.arrayBuffer(), {
      headers: { "Content-Type": contentType, "Cache-Control": "no-store" }
    });
  } catch (error) {
    console.error("Photo processing failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка обработки фотографии." },
      { status: 500 }
    );
  }
}
