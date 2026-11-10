import { geoDistance } from '../services/location.mjs';

const FEED = 'https://eventos.wiki/events.json';
const FALLBACK = 'https://bbreports.es/agenda';
const CALENDAR = 'https://eventos.wiki/calendar';
const EVENT_LIST = 'https://eventos.wiki/events/';
const HACKATHONS = 'https://hackathonspain.com/calendario/';
const relevant = /hackathon|hackat[oó]n|hack&|cyber|ciber|seguridad|security|hacking|\bctf\b|programaci[oó]n|programming|developer|desarroll|software|\bdev\b|javascript|typescript|python|\bjava\b|\brust\b|\bweb\b|\bcloud\b|\bfrontend\b|\bbackend\b|\bdata\b|\bai\b|inteligencia artificial/i;

export function normalizeEvents(feed, origin, now = new Date()) {
  if (!Array.isArray(feed?.events)) throw Error('Feed inválido');
  return feed.events.flatMap(event => {
    if (!event || typeof event !== 'object') return [];
    const loc = event.location || {}, geo = loc.geo, address = loc.address || {};
    const text = [event.name, event.description, ...(Array.isArray(event.tags) ? event.tags : [])].join(' ');
    const endValue = event.endDate || event.startDate;
    const end = Date.parse(endValue) + (/^\d{4}-\d{2}-\d{2}$/.test(endValue) ? 86399999 : 0);
    const start = Date.parse(event.startDate);
    let url;
    try { url = new URL(event.url); } catch { return []; }
    if (typeof event.name !== 'string' || typeof event.startDate !== 'string' || typeof endValue !== 'string' || !Number.isFinite(start) || !Number.isFinite(end) || end < now.getTime() || event.status === 'cancelled' || !relevant.test(text) || address.country !== 'ES' || !['http:', 'https:'].includes(url.protocol)) return [];
    const coords = [Number(geo?.lat), Number(geo?.lon)];
    const validGeo = geo && geo.lat != null && geo.lon != null && String(geo.lat).trim() !== '' && String(geo.lon).trim() !== '' && Number.isFinite(coords[0]) && Number.isFinite(coords[1]) && Math.abs(coords[0]) <= 90 && Math.abs(coords[1]) <= 180;
    const type = event.type || (/hackathon|hackat[oó]n|datathon|datat[oó]n/i.test(text) ? 'hackathon' : /conference|conferencia|congress|congreso|\bconf\b/i.test(text) ? 'conference' : 'event');
    return [{ source: event.source || 'eventos.wiki', type, id: String(event.id || event.url), name: String(event.name), description: String(event.description || ''), startDate: event.startDate, endDate: event.endDate || event.startDate, region: String(address.region || ''), venue: String(loc.venue || address.locality || ''), url: url.href, mode: event.attendanceMode || 'in-person', distance: validGeo && Array.isArray(origin?.coordinates) ? geoDistance(coords, origin.coordinates) : null, tags: Array.isArray(event.tags) ? event.tags.filter(x => typeof x === 'string').slice(0, 8) : [] }];
  }).sort((a,b) => a.startDate.localeCompare(b.startDate));
}


// BBReports publishes its Spanish cybersecurity agenda as an HTML list.
export function parseFallback(html) {
  const section = html.match(/<h2>España<\/h2>[\s\S]*?(?=<h2>Latinoamérica<\/h2>)/i)?.[0];
  if (!section) throw Error('Agenda alternativa inválida');
  const months = { ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06', jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12' };
  const decode = text => text.replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/<[^>]*>/g, '').trim();
  const events = [];
  for (const row of section.matchAll(/<a\s+class="ev-row"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const field = name => decode(row[2].match(new RegExp('<span class="' + name + '">([\\s\\S]*?)<\\/span>'))?.[1] || '');
    const date = field('ev-when').match(/^(\d{1,2})(?:\s*[–-]\s*(\d{1,2}))?\s+(\w+)\s+(\d{4})$/i);
    if (!date || !months[date[3].toLowerCase()]) continue;
    const makeDate = day => date[4] + '-' + months[date[3].toLowerCase()] + '-' + day.padStart(2, '0');
    events.push({ id: row[1] + date[0], name: field('ev-name'), description: 'Evento de ciberseguridad', startDate: makeDate(date[1]), endDate: makeDate(date[2] || date[1]), url: decode(row[1]), source: 'BBReports', location: { address: { country: 'ES', region: field('ev-place') } } });
  }
  if (!events.length && !section.includes('No hay eventos próximos')) throw Error('Agenda alternativa inválida');
  return { events };
}

// The calendar renders an Astro server island with links to event detail pages.
// Individual pages expose structured schema.org data, including location and topics.
export function calendarIsland(html) {
  const path = html.match(/href="(\/_server-islands\/CalendarContent\?[^"<>]+)"/)?.[1]?.replaceAll('&amp;', '&');
  if (!path) throw Error('Calendario inválido');
  return new URL(path, CALENDAR).href;
}

export function calendarLinks(html, now = new Date()) {
  const encoded = html.match(/<astro-island\b[^>]*component-export="Agenda"[^>]*\bprops="([^"]+)"/)?.[1];
  if (!encoded) throw Error('Calendario inválido');
  const props = JSON.parse(encoded.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
  if (!Array.isArray(props.events?.[1])) throw Error('Calendario inválido');
  return props.events[1].flatMap(entry => {
    const event = entry?.[1], path = event?.url?.[1], end = Date.parse(event?.end?.[1]);
    if (typeof path !== 'string' || !/^\/events\/\d{4}\/[a-z0-9-]+\/?$/i.test(path) || !Number.isFinite(end) || end < now.getTime()) return [];
    return [new URL(path, CALENDAR).href];
  });
}

export function calendarEvent(html) {
  for (const match of html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    let e; try { e = JSON.parse(match[1]); } catch { continue; }
    if (e['@type'] !== 'Event') continue;
    const a = e.location?.address || {}, geo = e.location?.geo;
    return { source: 'eventos.wiki · calendario', id: e['@id'], name: e.name, description: e.description, startDate: e.startDate, endDate: e.endDate, url: e.url, status: e.eventStatus?.endsWith('EventCancelled') ? 'cancelled' : 'scheduled', tags: typeof e.keywords === 'string' ? e.keywords.split(',').map(s => s.trim()) : [], attendanceMode: e.eventAttendanceMode?.includes('Mixed') ? 'hybrid' : e.eventAttendanceMode?.includes('Online') ? 'online' : 'in-person', location: { venue: e.location?.name, address: { country: a.addressCountry, region: a.addressRegion, locality: a.addressLocality }, geo: geo && { lat: geo.latitude, lon: geo.longitude } } };
  }
  throw Error('Evento inválido');
}

// The public nationwide events grid includes future dates across provinces.
export function eventGridIsland(html) {
  const path = html.match(/href="(\/_server-islands\/NextEventsGrid\?[^"<>]+)"/)?.[1]?.replaceAll('&amp;', '&');
  if (!path) throw Error('Listado de eventos inválido');
  return new URL(path, EVENT_LIST).href;
}

export function eventGridLinks(html) {
  if (!/event-card|No hay eventos/i.test(html)) throw Error('Listado de eventos inválido');
  return [...new Set([...html.matchAll(/href="(\/events\/\d{4}\/[a-z0-9-]+\/?)(?:"|[?#])/gi)].map(match => new URL(match[1], EVENT_LIST).href))];
}

async function eventGridFeed(fetcher) {
  const deadline = AbortSignal.timeout(20000);
  const request = async url => {
    const response = await fetcher(url, { signal: AbortSignal.any([deadline, AbortSignal.timeout(8000)]), headers: { accept: 'text/html' } });
    if (!response.ok) throw Error('Listado de eventos no disponible');
    return response.text();
  };
  const links = eventGridLinks(await request(eventGridIsland(await request(EVENT_LIST))));
  const events = [];
  for (let i = 0; i < links.length && !deadline.aborted; i += 6) {
    const batch = await Promise.allSettled(links.slice(i, i + 6).map(async url => ({ ...calendarEvent(await request(url)), source: 'eventos.wiki' })));
    events.push(...batch.filter(result => result.status === 'fulfilled').map(result => result.value));
  }
  if (links.length && !events.length) throw Error('Detalles de eventos no disponibles');
  return { events, missingDetails: links.length - events.length };
}

export function parseHackathons(html) {
  const months = { ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06', jul: '07', ago: '08', sep: '09', sept: '09', oct: '10', nov: '11', dic: '12' };
  const clean = s => s.replace(/<[^>]*>/g, '').replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").trim();
  const events = [];
  for (const row of html.matchAll(/<a\s+href="(\/calendario\/[^"?#]+)"\s+class="dec"\s+data-event-end="(\d{4}-\d\d-\d\d)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const field = c => clean(row[3].match(new RegExp('<(?:div|h3|p) class="' + c + '"[^>]*>([\\s\\S]*?)<\\/(?:div|h3|p)>'))?.[1] || '');
    const date = field('dec-date').match(/(\d{1,2})(?:\s*[–-]\s*\d{1,2})?\s+(\w+)\s+(\d{4})/i);
    const name = field('dec-title'), region = field('dec-location');
    if (!date || !months[date[2].toLowerCase()] || !name || !region) continue;
    const start = `${date[3]}-${months[date[2].toLowerCase()]}-${date[1].padStart(2, '0')}`;
    events.push({ id: new URL(row[1], HACKATHONS).href, source: 'Hackathon Spain', type: 'hackathon', name, description: field('dec-desc'), startDate: start, endDate: row[2], url: new URL(row[1], HACKATHONS).href, location: { address: { country: 'ES', region } } });
  }
  if (!events.length) throw Error('Agenda de hackathons inválida');
  return { events };
}

export function deduplicateEvents(events) {
  const seen = new Set();
  return events.filter(event => {
    const name = event.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const key = `${name}|${event.startDate.slice(0, 10)}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

async function calendarFeed(fetcher) {
  const deadline = AbortSignal.timeout(20000);
  const request = async url => {
    const response = await fetcher(url, { signal: AbortSignal.any([deadline, AbortSignal.timeout(8000)]), headers: { accept: 'text/html' } });
    if (!response.ok) throw Error('Calendario no disponible');
    return response.text();
  };
  const now = new Date();
  // Other months currently require sign-in; the current calendar is public.
  const page = await request(calendarIsland(await request(CALENDAR)));
  const links = [...new Set(calendarLinks(page, now))];
  const events = [];
  // Bound load on the upstream site and tolerate a single unavailable detail page.
  for (let i = 0; i < links.length && !deadline.aborted; i += 6) {
    const batch = await Promise.allSettled(links.slice(i, i + 6).map(async url => calendarEvent(await request(url))));
    events.push(...batch.filter(x => x.status === 'fulfilled').map(x => x.value));
  }
  if (links.length && !events.length) throw Error('Detalles del calendario no disponibles');
  return { events, missingDetails: links.length - events.length };
}

let cached, expires = 0;
export async function searchEvents(origin, fetcher = fetch, { refresh = false } = {}) {
  if (refresh || !cached || Date.now() >= expires) {
    let data, primary = 'feed';
    try {
      const response = await fetcher(FEED, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
      if (!response.ok) throw Error('Fuente no disponible');
      data = await response.json();
      if (!Array.isArray(data?.events)) throw Error('Feed inválido');
    } catch {
      try { data = await eventGridFeed(fetcher); primary = 'grid'; }
      catch {
        try {
          data = await calendarFeed(fetcher); primary = 'calendar';
        } catch {
          try {
            const response = await fetcher(FALLBACK, { signal: AbortSignal.timeout(10000), headers: { accept: 'text/html' } });
            if (!response.ok) throw Error('Fuente alternativa no disponible');
            data = parseFallback(await response.text()); primary = 'security';
          } catch { data = null; primary = 'unavailable'; }
        }
      }
    }
    let hackathonsAvailable = false;
    try {
      const response = await fetcher(HACKATHONS, { signal: AbortSignal.timeout(8000), headers: { accept: 'text/html' } });
      if (response.ok) {
        const hackathons = parseHackathons(await response.text());
        hackathonsAvailable = true;
        if (data) data.events.push(...hackathons.events);
        else data = hackathons;
      }
    } catch { /* The main source remains usable if this source is unavailable. */ }
    if (!data) throw Error('Fuentes de eventos no disponibles');
    cached = { ...data, coverage: { primary, hackathonsAvailable, missingDetails: data.missingDetails || 0 } };
    expires = Date.now() + 15 * 60000;
  }
  return { events: deduplicateEvents(normalizeEvents(cached, origin)), coverage: cached.coverage };
}
