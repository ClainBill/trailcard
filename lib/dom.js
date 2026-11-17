// Tiny DOM helpers. Everything is built with nodes and textContent, never
// innerHTML, because field values come from arbitrary web pages.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}

export function timeAgo(ts, now = Date.now()) {
  const min = Math.round((now - ts) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export function dueText(due, now = Date.now()) {
  const diff = due - now;
  if (diff <= 0) return 'Due now';
  const min = diff / 60_000;
  if (min < 60) return `Due in ${Math.max(1, Math.round(min))}m`;
  const hr = min / 60;
  if (hr < 23.5) return `Due in ${Math.round(hr)}h`;
  const days = Math.round(hr / 24);
  return days === 1 ? 'Due tomorrow' : `Due in ${days} days`;
}

// Fetches an image and stores a downscaled copy, so cards keep working after
// the original URL changes or blocks hotlinking. Falls back to the URL.
export async function toDataUrl(src, max = 480) {
  if (!src || src.startsWith('data:')) return src;
  try {
    const blob = await (await fetch(src)).blob();
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return src;
  }
}
