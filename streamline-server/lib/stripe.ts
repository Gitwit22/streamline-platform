import Stripe from "stripe";

const apiKey = process.env.STRIPE_SECRET_KEY;

// Pin explicitly so an SDK upgrade can't silently change payload shapes.
// Field locations for this version are handled in lib/stripeFields.ts.
export const STRIPE_API_VERSION = "2025-12-15.clover" as const;

export const stripe: Stripe = apiKey
	? new Stripe(apiKey, { apiVersion: STRIPE_API_VERSION, typescript: true })
	: (new Proxy(
			{},
			{
				get(_target, prop) {
					throw Object.assign(new Error("missing_stripe_key"), {
						code: "MISSING_STRIPE_KEY",
						prop: String(prop),
					});
				},
			}
		) as any as Stripe);
