const express = require('express');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const Stripe = require('stripe');

dotenv.config();

const app = express();
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
const pricePence = Number(process.env.PRICE_GBP_PENCE || 45000);
const storageRoot = process.env.DATA_DIR || path.join(__dirname, 'data');

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('Missing STRIPE_SECRET_KEY in environment variables.');
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const dataDir = storageRoot;
const publicDir = path.join(__dirname, 'public');
const bookingsPath = path.join(dataDir, 'bookings.json');
const freePolishPath = path.join(dataDir, 'free-polish.json');
const resendApiKey = process.env.RESEND_API_KEY || '';
const notifyToEmail = process.env.NOTIFY_TO_EMAIL || '';
const notifyFromEmail = process.env.NOTIFY_FROM_EMAIL || '';
const defaultWeeklySlotSchedule = [
  { weekday: 2, weekdayName: 'Tuesday', hour: 10, minute: 0 },
  { weekday: 3, weekdayName: 'Wednesday', hour: 14, minute: 0 },
  { weekday: 5, weekdayName: 'Friday', hour: 11, minute: 0 }
];
const temporaryWeeklySlotSchedule = [
  { weekday: 1, weekdayName: 'Monday', hour: 14, minute: 0 },
  { weekday: 2, weekdayName: 'Tuesday', hour: 10, minute: 0 },
  { weekday: 5, weekdayName: 'Friday', hour: 11, minute: 0 }
];
const temporaryScheduleEndsAt = new Date(Date.UTC(2026, 4, 1, 0, 0, 0));
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const defaultPreparationChecklist = [
  'Send a rough note, voice memo, or messy draft before the session if you have one.',
  'Bring one specific articulation problem, not three adjacent ones.',
  'Expect a written articulation after the call that you can use as a memo, narrative, or draft.'
];
const lensFeedUrl = process.env.LENS_FEED_URL || 'https://lensbrief.substack.com/feed';
const calendarBookingUrl = process.env.CALENDAR_BOOKING_URL || '';
const bookingEmail = process.env.BOOKING_EMAIL || 'dylan.galloway@proton.me';

function ensureDataFile(filePath, fallbackValue) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallbackValue, null, 2));
  }
}

function readJsonFile(filePath, fallbackValue) {
  ensureDataFile(filePath, fallbackValue);

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return fallbackValue;
  }
}

function writeJsonFile(filePath, value) {
  ensureDataFile(filePath, Array.isArray(value) ? [] : {});
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function getBookings() {
  return readJsonFile(bookingsPath, {});
}

function extractBookingDate(bookingTime) {
  return String(bookingTime || '').slice(0, 10);
}

function parseBookingDateTime(bookingTime) {
  const date = new Date(bookingTime);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isWeekdayBooking(bookingTime) {
  const date = parseBookingDateTime(bookingTime);
  if (!date) {
    return false;
  }

  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

function hasExistingBookingOnDate(bookingTime, ignoredSessionId) {
  const bookingDate = extractBookingDate(bookingTime);
  const bookings = getBookings();

  return Object.entries(bookings).some(([sessionId, booking]) => {
    if (sessionId === ignoredSessionId) {
      return false;
    }

    return extractBookingDate(booking.bookingTime) === bookingDate;
  });
}

function formatDateKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatIsoDateTime(date) {
  return `${formatDateKey(date)}T${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

function startOfWeekUtc(date) {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  utcDate.setUTCDate(utcDate.getUTCDate() + diffToMonday);
  return utcDate;
}

function buildScheduledSlot(weekStart, slot) {
  const date = new Date(weekStart);
  date.setUTCDate(weekStart.getUTCDate() + (slot.weekday - 1));
  date.setUTCHours(slot.hour, slot.minute, 0, 0);

  return {
    bookingTime: formatIsoDateTime(date),
    label: `${slot.weekdayName} ${date.getUTCDate()} ${monthNames[date.getUTCMonth()]} — ${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')} GMT`,
    date
  };
}

function scheduleForWeek(weekStart) {
  return weekStart.getTime() < temporaryScheduleEndsAt.getTime()
    ? temporaryWeeklySlotSchedule
    : defaultWeeklySlotSchedule;
}

function availableSlotsResponse(now = new Date()) {
  const bookings = getBookings();
  const bookedByDate = new Set(
    Object.values(bookings).map((booking) => extractBookingDate(booking.bookingTime)).filter(Boolean)
  );
  const slots = [];

  for (let weekOffset = 0; weekOffset < 6 && slots.length < 3; weekOffset += 1) {
    const weekStart = startOfWeekUtc(now);
    weekStart.setUTCDate(weekStart.getUTCDate() + (weekOffset * 7));
    const weeklySlotSchedule = scheduleForWeek(weekStart);

    const weekSlots = weeklySlotSchedule
      .map((slot) => buildScheduledSlot(weekStart, slot))
      .filter((slot) => slot.date.getTime() > now.getTime())
      .filter((slot) => !bookedByDate.has(extractBookingDate(slot.bookingTime)))
      .map((slot) => ({
        bookingTime: slot.bookingTime,
        label: slot.label
      }));

    slots.push(...weekSlots);
  }

  return {
    heading: 'Available appointment slots',
    slots: slots.slice(0, 3)
  };
}

function findAvailableSlot(bookingTime) {
  const available = availableSlotsResponse();
  return available.slots.find((slot) => slot.bookingTime === bookingTime) || null;
}

function saveBooking(sessionId, booking) {
  const bookings = getBookings();
  bookings[sessionId] = booking;
  writeJsonFile(bookingsPath, bookings);
}

function getBooking(sessionId) {
  const bookings = getBookings();
  return bookings[sessionId] || null;
}

function getFreePolishRequests() {
  return readJsonFile(freePolishPath, []);
}

function saveFreePolishRequest(entry) {
  const requests = getFreePolishRequests();
  requests.push(entry);
  writeJsonFile(freePolishPath, requests);
}

function getSessionCustomerEmail(session) {
  return session.customer_email || session.customer_details?.email || null;
}

function getSessionCustomerName(session) {
  return session.customer_details?.name || null;
}

function emailNotificationsEnabled() {
  return Boolean(resendApiKey && notifyToEmail && notifyFromEmail);
}

function sendHtmlFile(res, fileName) {
  return res.type('html').sendFile(path.join(publicDir, fileName));
}

function decodeXmlEntities(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function tagValue(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? decodeXmlEntities(match[1]).trim() : '';
}

function stripHtml(value = '') {
  return decodeXmlEntities(String(value).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function estimateReadingMinutes(value = '') {
  const wordCount = stripHtml(value).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 230));
}

function sanitizeLensHtml(html = '') {
  return decodeXmlEntities(html)
    .replace(/<div><hr><\/div>[\s\S]*$/i, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/\sstyle=(["'])[\s\S]*?\1/gi, '')
    .replace(/\sdata-[\w-]+=(["'])[\s\S]*?\1/gi, '')
    .replace(/\shref=(["'])javascript:[\s\S]*?\1/gi, ' href="#"')
    .replace(/\ssrc=(["'])javascript:[\s\S]*?\1/gi, '');
}

function parseLensFeed(xml) {
  const itemMatches = Array.from(String(xml).matchAll(/<item\b[\s\S]*?<\/item>/gi)).slice(0, 3);

  return itemMatches.map((match, index) => {
    const itemXml = match[0];
    const title = tagValue(itemXml, 'title') || `The Lens ${index + 1}`;
    const link = tagValue(itemXml, 'link');
    const publishedAt = tagValue(itemXml, 'pubDate');
    const rawContent = tagValue(itemXml, 'content:encoded') || tagValue(itemXml, 'description');
    const plainText = stripHtml(rawContent);
    const fallbackContent = `<p>${escapeHtml(plainText || 'Essay content is temporarily unavailable.')}</p>`;

    return {
      id: String(index + 1),
      title,
      link,
      publishedAt,
      byline: 'Dylan Galloway',
      readingMinutes: estimateReadingMinutes(rawContent),
      excerpt: plainText.length > 180 ? `${plainText.slice(0, 177).trim()}...` : plainText,
      html: sanitizeLensHtml(rawContent || fallbackContent)
    };
  });
}

const LENS_CACHE_TTL_MS = 60 * 60 * 1000;
const lensCache = { posts: [], fetchedAt: 0, fetching: null };

async function refreshLensCache() {
  if (lensCache.fetching) {
    return lensCache.fetching;
  }

  lensCache.fetching = (async () => {
    try {
      const response = await fetch(lensFeedUrl, {
        headers: { Accept: 'application/rss+xml, application/xml, text/xml' }
      });
      if (!response.ok) {
        throw new Error(`Lens feed returned ${response.status}`);
      }
      const xml = await response.text();
      lensCache.posts = parseLensFeed(xml);
      lensCache.fetchedAt = Date.now();
    } catch (error) {
      console.error('Lens cache refresh error:', error.message);
    } finally {
      lensCache.fetching = null;
    }
    return lensCache.posts;
  })();

  return lensCache.fetching;
}

async function getLensPosts() {
  const stale = Date.now() - lensCache.fetchedAt > LENS_CACHE_TTL_MS;
  if (stale || !lensCache.posts.length) {
    await refreshLensCache();
  }
  return lensCache.posts;
}

// Warm the cache at startup and refresh hourly.
refreshLensCache();
setInterval(refreshLensCache, LENS_CACHE_TTL_MS);

async function sendEmail({ to, subject, text, replyTo }) {
  if (!emailNotificationsEnabled()) {
    return { sent: false, reason: 'Email notifications not configured.' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: notifyFromEmail,
      to: Array.isArray(to) ? to : [to],
      reply_to: replyTo || undefined,
      subject,
      text
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend error ${response.status}: ${body}`);
  }

  return { sent: true };
}

async function sendBookingNotifications({ customerEmail, customerName, bookingLabel, focus }) {
  if (!emailNotificationsEnabled()) {
    return;
  }

  const ownerText = [
    'New Authority Distillation booking',
    '',
    `Client: ${customerName || 'Unknown'}`,
    `Email: ${customerEmail || 'Unknown'}`,
    `Session: ${bookingLabel}`,
    `Focus: ${focus || 'None provided'}`
  ].join('\n');

  const clientText = [
    'Authority Distillation confirmed.',
    '',
    'We have a 90-minute working session scheduled.',
    '',
    'You will receive a calendar invitation shortly with the meeting link.',
    '',
    'Before the session, bring the one idea you want to articulate clearly.',
    'It might be a narrative, positioning question, or something you’ve been trying to express but haven’t quite found the language for.',
    '',
    'If helpful, you can reply with a few sentences of context beforehand.',
    '',
    'Looking forward to the conversation.',
    '',
    '— Dylan'
  ].join('\n');

  await Promise.all([
    sendEmail({
      to: notifyToEmail,
      subject: `New booking: ${bookingLabel}`,
      text: ownerText,
      replyTo: customerEmail || undefined
    }),
    customerEmail
      ? sendEmail({
          to: customerEmail,
          subject: 'Authority Distillation confirmed',
          text: clientText,
          replyTo: notifyToEmail
        })
      : Promise.resolve()
  ]);
}

app.post('/webhook/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return res.status(200).json({ received: true, note: 'No webhook secret configured.' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('Checkout completed:', {
      id: session.id,
      amount_total: session.amount_total,
      currency: session.currency,
      customer_email: getSessionCustomerEmail(session)
    });
  }

  return res.json({ received: true });
});

app.use(express.json());

function renderIndexWithLens(res) {
  try {
    const template = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    const safeJson = JSON.stringify(lensCache.posts).replace(/</g, '\\u003c');
    const dataScript = `<script id="lens-data" type="application/json">${safeJson}</script>`;
    const html = template.replace('<!-- LENS_DATA -->', dataScript);
    return res.type('html').send(html);
  } catch (error) {
    console.error('Index render error:', error.message);
    return sendHtmlFile(res, 'index.html');
  }
}

app.get('/', async (_req, res) => {
  await getLensPosts();
  return renderIndexWithLens(res);
});

app.get('/booking', (_req, res) => {
  return sendHtmlFile(res, 'booking.html');
});

app.get('/confirmation', (_req, res) => {
  return sendHtmlFile(res, 'confirmation.html');
});

app.get('/v2', async (_req, res) => {
  await getLensPosts();
  return renderIndexWithLens(res);
});

app.get('/api/calendar-config', (_req, res) => {
  return res.json({
    calendarUrl: calendarBookingUrl,
    bookingEmail
  });
});

app.get('/api/lens-posts', async (_req, res) => {
  try {
    const posts = await getLensPosts();
    return res.json({ source: lensFeedUrl, posts });
  } catch (error) {
    console.error('Lens feed error:', error.message);
    return res.status(502).json({
      error: 'Unable to load The Lens right now.',
      posts: []
    });
  }
});

app.get('/test', (_req, res) => {
  return res
    .type('html')
    .send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authority Distillation Test</title>
  </head>
  <body>
    <h1>Authority Distillation test route</h1>
    <p>This page confirms the Express server is returning readable HTML.</p>
  </body>
</html>`);
});

app.use(express.static(publicDir));

app.post('/api/create-checkout-session', async (_req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_creation: 'always',
      billing_address_collection: 'auto',
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: 'Authority Distillation',
              description: '90-minute thinking session, one specific problem clarified'
            },
            unit_amount: pricePence
          },
          quantity: 1
        }
      ],
      metadata: {
        product: 'authority_distillation'
      },
      success_url: `${baseUrl}/book-next.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?cancelled=1`
    });

    return res.json({ url: session.url });
  } catch (error) {
    console.error('Checkout session error:', error.message);
    return res.status(500).json({ error: 'Unable to create checkout session.' });
  }
});

app.post('/api/book-session', (_req, res) => {
  return res.status(410).json({
    error: 'App-side slot booking has been removed. Use the real calendar handoff after checkout.'
  });
});

app.post('/api/free-polish', (req, res) => {
  const { email, note } = req.body || {};
  if (!email || !note) {
    return res.status(400).json({ error: 'Email and note are required.' });
  }

  const entry = {
    email: String(email).slice(0, 200),
    note: String(note).slice(0, 500),
    createdAt: new Date().toISOString()
  };
  saveFreePolishRequest(entry);
  console.log('Free polish request:', entry);
  return res.json({ ok: true });
});

app.get('/api/available-slots', (_req, res) => {
  return res.status(410).json({
    error: 'Fixed weekly slots have been removed. Use the real calendar handoff after checkout.'
  });
});

app.get('/api/checkout-session/:id', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.id);
    const booking = getBooking(req.params.id);

    return res.json({
      status: session.status,
      payment_status: session.payment_status,
      customer_email: getSessionCustomerEmail(session),
      customer_name: getSessionCustomerName(session),
      amount_total: session.amount_total,
      currency: session.currency,
      booking,
      preparation_checklist: defaultPreparationChecklist
    });
  } catch (_error) {
    return res.status(404).json({ error: 'Session not found.' });
  }
});

app.listen(port, host, () => {
  console.log(`Authority Distillation site running at ${baseUrl}`);
});
