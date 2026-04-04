# Authority Distillation

Minimal horizontal landing page for Dylan Galloway's founder articulation service.

## What it does
- Presents the service as a horizontal swipe/drag experience
- Takes payment with Stripe Checkout
- Routes paid clients into a booking flow with fixed weekly slots
- Sends booking notification emails via Resend
- Sends a client confirmation email after booking
- Opens a pre-filled mail draft for the free draft-polish entry point

## Page flow
- `Raw Thinking`
- `Example`
- `Distillation`
- `Essays / Notes`
- `What Leaves The Room`
- `Example 2`
- `Example 3`
- `Reading`
- `Purchase`

## Local setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a local env file:
   ```bash
   cp .env.example .env
   ```
3. Add at minimum a real Stripe key and local base URL:
   ```env
   STRIPE_SECRET_KEY=sk_test_your_real_key
   BASE_URL=http://localhost:3000
   PORT=3000
   PRICE_GBP_PENCE=45000
   DATA_DIR=./data
   ```
4. Start the app:
   ```bash
   npm run dev
   ```

## Environment variables
- `PORT`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `BASE_URL`
- `PRICE_GBP_PENCE`
- `DATA_DIR`
- `RESEND_API_KEY`
- `NOTIFY_TO_EMAIL`
- `NOTIFY_FROM_EMAIL`

## Stripe flow
1. Visitor clicks the paid CTA
2. Stripe Checkout opens
3. After payment, the visitor lands on the booking page
4. They choose one of the available weekly slots
5. Booking is saved locally to JSON storage
6. Client + owner notification emails are sent if Resend is configured

## Booking storage
- Bookings are stored in `bookings.json` under `DATA_DIR`
- Free polish requests are not submitted to the server; they open a mail draft instead

## Local webhook testing
```bash
stripe listen --forward-to localhost:3000/webhook/stripe
```

Then set the returned signing secret in `.env` as:

```env
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Production notes
- Production is deployed on Render
- The live domain is `https://dylangalloway.com`
- Resend is used for outbound booking emails
- The sender address is `bookings@updates.dylangalloway.com`

## Notes
- The booking flow currently uses app-side JSON storage rather than a database
- Calendar invites are still sent manually
