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
const bookingsPath = path.join(dataDir, 'bookings.json');
const freePolishPath = path.join(dataDir, 'free-polish.json');
const weeklySlotSchedule = [
  { weekday: 2, hour: 10, minute: 0, label: 'Tuesday — 10:00' },
  { weekday: 3, hour: 14, minute: 0, label: 'Wednesday — 14:00' },
  { weekday: 5, hour: 11, minute: 0, label: 'Friday — 11:00' }
];
const defaultPreparationChecklist = [
  'Send a rough note, voice memo, or messy draft before the session if you have one.',
  'Bring one specific articulation problem, not three adjacent ones.',
  'Expect a written articulation after the call that you can use as a memo, narrative, or draft.'
];

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
    label: slot.label,
    date
  };
}

function availableSlotsResponse(now = new Date()) {
  const bookings = getBookings();
  const bookedByDate = new Set(
    Object.values(bookings).map((booking) => extractBookingDate(booking.bookingTime)).filter(Boolean)
  );

  for (let weekOffset = 0; weekOffset < 3; weekOffset += 1) {
    const weekStart = startOfWeekUtc(now);
    weekStart.setUTCDate(weekStart.getUTCDate() + (weekOffset * 7));

    const slots = weeklySlotSchedule
      .map((slot) => buildScheduledSlot(weekStart, slot))
      .filter((slot) => slot.date.getTime() > now.getTime())
      .filter((slot) => !bookedByDate.has(extractBookingDate(slot.bookingTime)))
      .map((slot) => ({
        bookingTime: slot.bookingTime,
        label: slot.label,
        dayLabel: slot.label.split(' — ')[0]
      }));

    if (slots.length > 0) {
      return {
        heading: weekOffset === 0 ? 'Available times this week' : 'Available times next week',
        slots
      };
    }
  }

  return {
    heading: 'Available times',
    slots: []
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
      customer_email: session.customer_email
    });
  }

  return res.json({ received: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/create-checkout-session', async (_req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
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
      success_url: `${baseUrl}/booking.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?cancelled=1`
    });

    return res.json({ url: session.url });
  } catch (error) {
    console.error('Checkout session error:', error.message);
    return res.status(500).json({ error: 'Unable to create checkout session.' });
  }
});

app.post('/api/book-session', async (req, res) => {
  try {
    const { sessionId, bookingTime, focus } = req.body || {};
    if (!sessionId || !bookingTime) {
      return res.status(400).json({ error: 'Missing sessionId or bookingTime.' });
    }

    if (!isWeekdayBooking(bookingTime)) {
      return res.status(400).json({ error: 'Please choose a Monday to Friday session time.' });
    }

    const selectedSlot = findAvailableSlot(bookingTime);
    if (!selectedSlot) {
      return res.status(409).json({ error: 'That slot is no longer available. Please choose another available time.' });
    }

    if (hasExistingBookingOnDate(bookingTime, sessionId)) {
      return res.status(409).json({ error: 'That day is already booked. Please choose another weekday.' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      return res.status(403).json({ error: 'Payment required before booking.' });
    }

    saveBooking(sessionId, {
      bookingTime,
      bookingLabel: selectedSlot.label,
      focus: (focus || '').toString().slice(0, 500),
      updatedAt: new Date().toISOString()
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error('Booking error:', error.message);
    return res.status(500).json({ error: 'Unable to save booking.' });
  }
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
  return res.json(availableSlotsResponse());
});

app.get('/api/checkout-session/:id', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.id);
    const booking = getBooking(req.params.id);

    return res.json({
      status: session.status,
      payment_status: session.payment_status,
      customer_email: session.customer_email,
      customer_name: session.customer_details?.name || null,
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
