# Go Live

Primary domain: `dylangalloway.com`

## Render

Create a new `Web Service` from:

- Repo: `dylan-747/authority-distillation`
- Blueprint: use `render.yaml`
- Plan: `Starter`
- Persistent disk mount path: `/var/data`

Set these environment variables:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `BASE_URL`
- `PRICE_GBP_PENCE=45000`
- `DATA_DIR=/var/data`

For the first deploy, set:

- `BASE_URL=https://<your-render-service>.onrender.com`

## Stripe test mode

1. Create the Stripe account.
2. Stay in test mode.
3. Copy the test secret key into Render as `STRIPE_SECRET_KEY`.
4. Add a webhook endpoint:
   - `https://<your-render-service>.onrender.com/webhook/stripe`
5. Copy the webhook signing secret into Render as `STRIPE_WEBHOOK_SECRET`.

Use Stripe test cards for checkout verification.

## Test flow

Verify this full flow on the Render URL:

1. Homepage loads.
2. DG favicon appears.
3. Free polish form submits.
4. `Distill a Thought` opens Stripe Checkout.
5. Test payment succeeds.
6. Redirect lands on `booking.html?session_id=...`.
7. Booking saves successfully.
8. Confirmation page shows paid status, session time, and prep guidance.
9. Restart or redeploy the service and confirm booking data still exists.

## Domain cutover

In Render:

1. Add custom domain `dylangalloway.com`.
2. Optionally add `www.dylangalloway.com`.
3. Copy the DNS records Render gives you.

In IONOS:

1. Open DNS settings for `dylangalloway.com`.
2. Add the exact records Render requires.
3. Remove conflicting old records if necessary.
4. Remove conflicting `AAAA` records if Render instructs you to.

When the domain is live, change:

- `BASE_URL=https://dylangalloway.com`

Then verify the same full flow again on the `.com` domain.

## Stripe live mode

1. Complete Stripe live onboarding.
2. Replace `STRIPE_SECRET_KEY` with the live key.
3. Replace `STRIPE_WEBHOOK_SECRET` with a live webhook secret.
4. Set the live webhook endpoint to:
   - `https://dylangalloway.com/webhook/stripe`

## Redirect other domains

In IONOS, permanently forward these to `https://dylangalloway.com`:

- `dylangalloway.co.uk`
- `dylangalloway.info`
- `dylangalloway.store`
