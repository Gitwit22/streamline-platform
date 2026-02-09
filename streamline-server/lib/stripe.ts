import Stripe from "stripe";

const apiKey = process.env.STRIPE_SECRET_KEY;

export const stripe: Stripe = apiKey
	? new Stripe(apiKey, { typescript: true })
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
