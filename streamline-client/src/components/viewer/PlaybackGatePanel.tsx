/**
 * Viewer-side access gate for protected channels: ticket checkout (PPV),
 * access-code redemption, sign-in prompt (registered) and friendly messages
 * for private / subscriber-only channels. The server enforces all of this;
 * this panel only drives the flow.
 */
import { useEffect, useRef, useState } from "react";
import { Lock, LogIn, Ticket, KeyRound, Loader2 } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { formatPrice, shouldKeepPollingAfterCheckout, type PlaybackGate } from "../../lib/playbackAccess";

type Props = {
  gate: PlaybackGate;
  /** Viewer page path to return to after login / checkout, e.g. /live/<id>. */
  returnPath: string;
  /** Re-ask the server for playback (after redeem / checkout return). */
  onRetry: () => Promise<PlaybackGate>;
  /** Stripe success redirect (?success=1&session_id=…). */
  checkoutSessionId?: string | null;
  checkoutCanceled?: boolean;
  compact?: boolean;
};

function errorText(code: string | undefined): string {
  switch (code) {
    case "invalid_code":
      return "That code isn't valid for this stream.";
    case "code_already_claimed":
      return "That code was already used on another device.";
    case "code_revoked":
      return "That code is no longer valid (refunded or revoked).";
    default:
      return code ? code.replace(/_/g, " ") : "Something went wrong.";
  }
}

export default function PlaybackGatePanel({ gate, returnPath, onRetry, checkoutSessionId, checkoutCanceled, compact }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState("");
  const [unlocking, setUnlocking] = useState(!!checkoutSessionId);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;

  // Returning from Stripe: the webhook grants a device entitlement; poll
  // playback until it lands, and show the access code for other devices.
  useEffect(() => {
    if (!checkoutSessionId) return;
    let stopped = false;
    let attempt = 0;
    let codeFetched = false;
    const step = async () => {
      if (stopped) return;
      attempt += 1;
      const g = await onRetryRef.current().catch(() => ({ kind: "unavailable", message: "" }) as PlaybackGate);
      if (!codeFetched) {
        try {
          const res = await apiFetch(`/api/monetization/code?session_id=${encodeURIComponent(checkoutSessionId)}`, {}, { allowNonOk: true });
          const data = await res.json().catch(() => null);
          if (data?.ready && data.code) {
            codeFetched = true;
            if (!stopped) setIssuedCode(String(data.code));
          }
        } catch {
          // ignore; retried next step
        }
      }
      if (stopped) return;
      if (shouldKeepPollingAfterCheckout(g, attempt)) {
        window.setTimeout(step, 2000);
      } else {
        setUnlocking(false);
      }
    };
    void step();
    return () => {
      stopped = true;
    };
  }, [checkoutSessionId]);

  const checkout = gate.kind === "checkout" ? gate.checkout : null;

  async function buy() {
    if (!checkout) return;
    setErr(null);
    let amountCents: number | undefined;
    if (checkout.monetizationMode === "pwyw") {
      const dollars = Number(amount);
      const min = checkout.pwywMinCents ?? 100;
      if (!Number.isFinite(dollars) || Math.round(dollars * 100) < Math.max(100, min)) {
        setErr(`Minimum is ${formatPrice(Math.max(100, min), checkout.currency)}.`);
        return;
      }
      amountCents = Math.round(dollars * 100);
    }
    setBusy(true);
    try {
      const res = await apiFetch(
        "/api/monetization/checkout",
        {
          method: "POST",
          body: JSON.stringify({ eventId: checkout.eventId, type: "access", amountCents, returnPath }),
        },
        { allowNonOk: true }
      );
      const data = await res.json().catch(() => null);
      if (res.ok && data?.url) {
        window.location.href = data.url;
        return;
      }
      setErr(data?.reason || errorText(data?.error));
    } catch {
      setErr("Checkout failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    if (!checkout || !code.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch(
        "/api/monetization/redeem",
        { method: "POST", body: JSON.stringify({ eventId: checkout.eventId, code: code.trim() }) },
        { allowNonOk: true }
      );
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setShowCode(false);
        setCode("");
        await onRetry();
      } else {
        setErr(errorText(data?.error));
      }
    } catch {
      setErr("Could not redeem the code.");
    } finally {
      setBusy(false);
    }
  }

  const wrap = compact ? "w-full max-w-sm" : "w-full max-w-md";
  const card = `${wrap} rounded-2xl border border-white/10 bg-neutral-950/90 p-5 text-left text-white shadow-xl`;

  const issuedCodeBox = issuedCode ? (
    <div className="mt-3 rounded-xl border border-indigo-400/40 bg-indigo-500/10 p-3" data-testid="gate-issued-code">
      <div className="text-xs text-indigo-200">Your access code (use it to watch on another device):</div>
      <div className="mt-1 font-mono text-lg tracking-widest">{issuedCode}</div>
    </div>
  ) : null;

  if (unlocking && gate.kind !== "granted" && gate.kind !== "waiting_live") {
    return (
      <div className={card} data-testid="gate-unlocking">
        <div className="flex items-center gap-2 font-semibold">
          <Loader2 className="h-4 w-4 animate-spin" /> Payment received — unlocking your access…
        </div>
        <p className="mt-2 text-sm text-neutral-400">This usually takes a few seconds.</p>
        {issuedCodeBox}
      </div>
    );
  }

  if (gate.kind === "login") {
    return (
      <div className={card} data-testid="gate-login">
        <div className="flex items-center gap-2 font-semibold">
          <LogIn className="h-4 w-4" /> Sign in to watch
        </div>
        <p className="mt-2 text-sm text-neutral-400">{gate.message}</p>
        <a
          href={`/login?next=${encodeURIComponent(returnPath)}`}
          className="mt-4 inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-500"
        >
          Sign in
        </a>
      </div>
    );
  }

  if (gate.kind === "forbidden") {
    return (
      <div className={card} data-testid={`gate-forbidden-${gate.reason}`}>
        <div className="flex items-center gap-2 font-semibold">
          <Lock className="h-4 w-4" />
          {gate.reason === "private" ? "Private stream" : gate.reason === "subscriber_not_available" ? "Subscribers only" : "Not available"}
        </div>
        <p className="mt-2 text-sm text-neutral-400">{gate.message}</p>
      </div>
    );
  }

  if (gate.kind === "checkout") {
    return (
      <div className={card} data-testid="gate-checkout">
        <div className="flex items-center gap-2 font-semibold">
          <Ticket className="h-4 w-4" /> {checkout?.eventName || "Ticketed stream"}
        </div>
        <p className="mt-1 text-sm text-neutral-400">{gate.message}</p>
        {checkoutCanceled ? <p className="mt-2 text-xs text-amber-300">Checkout was canceled — you have not been charged.</p> : null}
        {issuedCodeBox}

        {checkout ? (
          <div className="mt-4 space-y-3">
            {checkout.monetizationMode === "pwyw" ? (
              <label className="block text-sm">
                <span className="text-neutral-300">
                  Pay what you want (min {formatPrice(Math.max(100, checkout.pwywMinCents ?? 100), checkout.currency)})
                </span>
                <input
                  type="number"
                  min={Math.max(1, (checkout.pwywMinCents ?? 100) / 100)}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-white"
                  aria-label="Amount"
                />
              </label>
            ) : null}
            <button
              type="button"
              onClick={buy}
              disabled={busy}
              className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-500 disabled:opacity-50"
              data-testid="gate-buy"
            >
              {busy ? "Starting checkout…" : checkout.monetizationMode === "fixed" ? `Buy access — ${formatPrice(checkout.fixedAmountCents, checkout.currency)}` : "Buy access"}
            </button>

            {!showCode ? (
              <button type="button" onClick={() => setShowCode(true)} className="flex items-center gap-1 text-xs text-neutral-400 hover:text-white">
                <KeyRound className="h-3 w-3" /> I have an access code
              </button>
            ) : (
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="ACCESS CODE"
                  className="flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-mono text-sm tracking-widest text-white"
                  aria-label="Access code"
                />
                <button
                  type="button"
                  onClick={redeem}
                  disabled={busy || !code.trim()}
                  className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                >
                  Redeem
                </button>
              </div>
            )}
          </div>
        ) : null}
        {err ? <p className="mt-3 text-sm text-red-300">{err}</p> : null}
      </div>
    );
  }

  if (gate.kind === "unavailable") {
    return (
      <div className={card}>
        <p className="text-sm text-neutral-300">{gate.message}</p>
      </div>
    );
  }

  if (issuedCodeBox) return <div className={card}>{issuedCodeBox}</div>;
  return null;
}

/** True when the gate needs the panel instead of the player/offline view. */
export function gateBlocksPlayback(gate: PlaybackGate): boolean {
  return gate.kind === "checkout" || gate.kind === "login" || gate.kind === "forbidden";
}
