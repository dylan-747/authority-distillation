# Authority Distillation Site

Minimal horizontal-canvas website for a founder thought partner.

## Experience
- Calm horizontal navigation by swipe/drag left-right
- Sections: Raw Thinking, Distillation, Essays, Work, Distill a Thought
- Distill panel offers two clear paths:
  - `Distill a Thought — £450` (Stripe payment)
  - `Request Free Polish` lead capture form

## Payment and booking flow
1. Click `Secure Session — £450` to open Stripe Checkout
2. After payment, user lands on booking calendar page
3. User selects a session time and confirms booking
4. Confirmation page appears

## Quick start
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create env file:
   ```bash
   cp .env.example .env
   ```
3. Set Stripe secret key in `.env` (required to start):
   ```env
   STRIPE_SECRET_KEY=sk_test_your_secret_key
   BASE_URL=http://localhost:3000
   PORT=3000
   PRICE_GBP_PENCE=45000
   DATA_DIR=./data
   ```
4. Run:
   ```bash
   npm run dev
   ```

## Webhook (optional, recommended)
```bash
stripe listen --forward-to localhost:3000/webhook/stripe
```
Set the resulting signing secret as `STRIPE_WEBHOOK_SECRET` in `.env`.

## Note
Booking selections and free polish requests are persisted to local JSON files in `data/`.
The confirmation flow returns preparation guidance to the client after payment and booking.
The free polish CTA opens a pre-filled email draft to `dylan.galloway@proton.me`.
