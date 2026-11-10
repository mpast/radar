import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvents } from '../src/sources/events.mjs';

const origin = { coordinates: [40.4, -3.7] };
const base = { id: '1', name: 'Hackathon Madrid', startDate: '2027-02-10', endDate: '2027-02-11', url: 'https://eventos.wiki/events/test', status: 'scheduled', location: { address: { country: 'ES', region: 'Madrid' }, geo: { lat: 40.4, lon: -3.7 } } };
test('filters events to relevant, upcoming events in Spain and calculates distance', () => {
  const events = normalizeEvents({ events: [base, {...base, id: 'past', endDate: '2026-01-01'}, {...base, id: 'abroad', location: {address: {country: 'FR'}}}, {...base, id: 'other', name: 'Cooking festival'}, {...base, id: 'cancel', status: 'cancelled'}, {...base, id: 'unsafe', url: 'javascript:alert(1)'}, {...base, id: 'unknown', location: {address: {country: 'ES'}}}] }, origin, new Date('2027-02-10T12:00:00Z'));
  assert.deepEqual(events.map(e => e.id), ['1', 'unknown']);
  assert.equal(events[0].distance, 0);
  assert.equal(events[1].distance, null);
  assert.equal(normalizeEvents({events:[base]}, origin, new Date('2027-02-12T00:00:00Z')).length, 0);
});
test('rejects an invalid feed', () => assert.throws(() => normalizeEvents({events: null}, origin)));

test('normal requests use cached events while an explicit refresh fetches new data', async () => {
  const { searchEvents } = await import('../src/sources/events.mjs?refresh-test');
  let calls = 0;
  const fetcher = async url => {
    if (url.includes('events.json')) {
      calls++;
      return { ok: true, json: async () => ({ events: [{ ...base, name: `Hackathon ${calls}`, startDate: '2099-02-10', endDate: '2099-02-11' }] }) };
    }
    return { ok: false };
  };
  assert.equal((await searchEvents(null, fetcher)).events[0].name, 'Hackathon 1');
  assert.equal((await searchEvents(null, fetcher)).events[0].name, 'Hackathon 1');
  assert.equal(calls, 1);
  assert.equal((await searchEvents(null, fetcher, { refresh: true })).events[0].name, 'Hackathon 2');
  assert.equal(calls, 2);
});

test('reports unavailable general sources even when hackathons are returned', async () => {
  const { searchEvents } = await import('../src/sources/events.mjs?coverage-test');
  const html = '<a href="/calendario/hackeps/" class="dec" data-event-end="2099-11-29"><div class="dec-date">28–29 nov 2099</div><div class="dec-location">Lleida</div><h3 class="dec-title">HackEPS 2099</h3><p class="dec-desc">Hackathon presencial</p></a>';
  const fetcher = async url => url.includes('hackathonspain.com') ? { ok: true, text: async () => html } : { ok: false };
  const result = await searchEvents(null, fetcher);
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.coverage, { primary: 'unavailable', hackathonsAvailable: true, missingDetails: 0 });
});

test('reports unavailable hackathon source even when the feed is empty', async () => {
  const { searchEvents } = await import('../src/sources/events.mjs?empty-coverage-test');
  const fetcher = async url => url.includes('events.json') ? { ok: true, json: async () => ({ events: [] }) } : { ok: false };
  const result = await searchEvents(null, fetcher);
  assert.deepEqual(result.events, []);
  assert.equal(result.coverage.hackathonsAvailable, false);
});

test('reports partial event details when one nationwide listing cannot be fetched', async () => {
  const { searchEvents } = await import('../src/sources/events.mjs?partial-grid-test');
  const detail = { '@type': 'Event', '@id': '1', name: 'Hackathon Madrid', startDate: '2099-02-10', endDate: '2099-02-11', url: 'https://eventos.wiki/events/2099/one', location: { address: { addressCountry: 'ES', addressRegion: 'Madrid' } } };
  const fetcher = async url => {
    if (url === 'https://eventos.wiki/events/') return { ok: true, text: async () => '<link href="/_server-islands/NextEventsGrid?e=default">' };
    if (url.includes('NextEventsGrid')) return { ok: true, text: async () => '<a class="event-card" href="/events/2099/one">One</a><a href="/events/2099/two">Two</a>' };
    if (url.endsWith('/one')) return { ok: true, text: async () => `<script type="application/ld+json">${JSON.stringify(detail)}</script>` };
    return { ok: false };
  };
  const result = await searchEvents(null, fetcher);
  assert.equal(result.events.length, 1);
  assert.equal(result.coverage.primary, 'grid');
  assert.equal(result.coverage.missingDetails, 1);
});

test('parses only Spanish fallback events and their date ranges', async () => {
  const { parseFallback } = await import('../src/sources/events.mjs');
  const html = '<h2>España</h2><div><a class="ev-row" href="https://example.com" rel="nofollow"><span class="ev-when">24–27 nov 2026</span><span class="ev-name">Security &amp; CTF</span><span class="ev-place">Madrid</span></a></div><h2>Latinoamérica</h2><a class="ev-row" href="https://example.org"><span class="ev-name">Other</span></a>';
  const events = normalizeEvents(parseFallback(html), null, new Date('2026-11-01'));
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'Security & CTF');
  assert.equal(events[0].endDate, '2026-11-27');
  assert.equal(events[0].source, 'BBReports');
  assert.throws(() => parseFallback('<h2>Other</h2>'));
});

test('reads calendar links and structured event details safely', async () => {
  const { calendarIsland, calendarLinks, calendarEvent } = await import('../src/sources/events.mjs');
  assert.equal(calendarIsland('<link href="/_server-islands/CalendarContent?e=default&amp;p=abc">'), 'https://eventos.wiki/_server-islands/CalendarContent?e=default&p=abc');
  const props = JSON.stringify({ events: [1, [[0, { url: [0, '/events/2027/hackathon'], end: [3, '2027-02-11T18:00:00Z'] }], [0, { url: [0, '//evil.test/a'], end: [3, '2027-02-11T18:00:00Z'] }]]] }).replaceAll('"', '&quot;');
  assert.deepEqual(calendarLinks(`<astro-island component-export="Agenda" props="${props}">`, new Date('2027-02-01')), ['https://eventos.wiki/events/2027/hackathon']);
  const detail = { '@type': 'Event', '@id': '1', name: 'Hackathon', startDate: '2027-02-10', endDate: '2027-02-11', url: 'https://eventos.wiki/events/2027/hackathon', location: { name: 'Venue', address: { addressRegion: 'Madrid', addressCountry: 'ES' } } };
  const event = calendarEvent(`<script type="application/ld+json">${JSON.stringify(detail)}</script>`);
  assert.equal(normalizeEvents({ events: [event] }, null, new Date('2027-02-01'))[0].region, 'Madrid');
  assert.throws(() => calendarIsland('<html></html>'));
});

test('reads the nationwide events grid including later years and only safe event links', async () => {
  const { eventGridIsland, eventGridLinks } = await import('../src/sources/events.mjs');
  assert.equal(eventGridIsland('<link href="/_server-islands/NextEventsGrid?e=default&amp;p=abc">'), 'https://eventos.wiki/_server-islands/NextEventsGrid?e=default&p=abc');
  const html = '<a class="event-card" href="/events/2027/hackathon">One</a><a href="/events/2027/hackathon">Duplicate</a><a href="//other.test/events/2027/fake">Other</a><a href="/events/2028/conference">Next year</a>';
  assert.deepEqual(eventGridLinks(html), ['https://eventos.wiki/events/2027/hackathon', 'https://eventos.wiki/events/2028/conference']);
  assert.throws(() => eventGridIsland('<html></html>'));
  assert.throws(() => eventGridLinks('<html></html>'));
});

test('parses hackathons and deduplicates equal names and dates', async () => {
  const { parseHackathons, deduplicateEvents } = await import('../src/sources/events.mjs');
  const html = '<a href="/calendario/hackeps/" class="dec" data-event-end="2027-11-29"><div class="dec-date">28–29 nov 2027</div><div class="dec-location">Lleida</div><h3 class="dec-title">HackEPS 2027</h3><p class="dec-desc">Hackathon presencial</p></a>';
  const event = normalizeEvents(parseHackathons(html), null, new Date('2027-11-01'))[0];
  assert.equal(event.type, 'hackathon');
  assert.equal(event.startDate, '2027-11-28');
  assert.equal(deduplicateEvents([event, { ...event, name: 'HACKEPS 2027' }]).length, 1);
  assert.throws(() => parseHackathons('<html></html>'));
});
