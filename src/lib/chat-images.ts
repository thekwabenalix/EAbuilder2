/** Prepare chart screenshots for ea-chat (compress + parse data URLs). */

const MAX_FILE_BYTES = 3_500_000;
const MAX_WIDTH = 1400;

export async function compressChatImage(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:image/")) return dataUrl;
  if (estimateDataUrlBytes(dataUrl) <= MAX_FILE_BYTES) return dataUrl;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_WIDTH / Math.max(img.width, 1));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);

      let quality = 0.88;
      let out = canvas.toDataURL("image/jpeg", quality);
      while (estimateDataUrlBytes(out) > MAX_FILE_BYTES && quality > 0.45) {
        quality -= 0.08;
        out = canvas.toDataURL("image/jpeg", quality);
      }
      resolve(out);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return dataUrl.length;
  const b64 = dataUrl.slice(comma + 1).replace(/\s/g, "");
  return Math.ceil((b64.length * 3) / 4);
}

export function parseImageDataUrl(
  dataUrl: string,
): { media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } | null {
  const trimmed = dataUrl.trim();
  const comma = trimmed.indexOf(",");
  if (comma === -1) return null;

  const header = trimmed.slice(0, comma).toLowerCase();
  const data = trimmed.slice(comma + 1).replace(/\s/g, "");
  if (!data || !header.startsWith("data:image/")) return null;

  let media_type = header.slice(5).split(";")[0]!.trim();
  if (media_type === "image/jpg") media_type = "image/jpeg";
  if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(media_type)) {
    return null;
  }

  return {
    media_type: media_type as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
    data,
  };
}

/** Images for the current API call: pending attachments, or the latest user message in history. */
export function collectChatImages<T extends { role: string; images?: string[] }>(
  pending: string[],
  history: T[],
): string[] {
  if (pending.length > 0) return pending;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg?.role === "user" && msg.images?.length) return msg.images;
  }
  return [];
}

export async function prepareChatImages(dataUrls: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const url of dataUrls.slice(0, 3)) {
    out.push(await compressChatImage(url));
  }
  return out;
}
