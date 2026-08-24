import { FormEvent, useEffect, useRef, useState } from "react";
import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import { DonationCheckout, DonationSettings } from "../interface";
import { CrossIcon, HeartIcon, SpinnerIcon } from "./Icons";

/**
 * Paddle.js is a CDN-loaded singleton, so the instance is memoised at module
 * scope: initialising twice loads the script twice and the second overlay can
 * open against a stale environment.  The token is part of the key so a config
 * change (sandbox → live) still re-initialises.
 */
let paddleInstance: Promise<Paddle | undefined> | null = null;
let paddleKey = "";

/**
 * The event callback belongs to the *instance*, not to a render, so the live
 * handler is kept here and swapped by the mounted dialog. Without this a
 * remount would silently keep talking to the first dialog's state setters.
 */
let checkoutEventHandler: ((eventName: string) => void) | null = null;

function loadPaddle(settings: {
  client_token: string;
  environment: "sandbox" | "production";
}) {
  const key = `${settings.environment}:${settings.client_token}`;
  if (!paddleInstance || paddleKey !== key) {
    paddleKey = key;
    paddleInstance = initializePaddle({
      token: settings.client_token,
      environment: settings.environment,
      eventCallback: (event) => checkoutEventHandler?.(String(event.name ?? "")),
    });
  }
  return paddleInstance;
}

/** Pull a readable message out of a DRF error body. */
function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const body = payload as Record<string, unknown>;
    if (typeof body.error === "string") return body.error;
    // Field errors arrive as { amount: ["The minimum donation is 1."] }.
    for (const value of Object.values(body)) {
      if (typeof value === "string") return value;
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    }
  }
  return fallback;
}

type Phase = "form" | "submitting" | "thanks";

interface DonateDialogProps {
  settings: DonationSettings;
  onClose: () => void;
}

/**
 * Pay-what-you-want donation dialog.
 *
 * The amount is never charged from here: the server creates the Paddle
 * transaction and this only opens the overlay for it, so the browser cannot
 * name its own price.  Paddle collects the email, address and payment details
 * — this form deliberately asks for none of them.
 */
function DonateDialog({ settings, onClose }: DonateDialogProps) {
  const [amount, setAmount] = useState(settings.presets[0] ?? "5");
  const [currency, setCurrency] = useState(settings.currency);
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState("");

  const amountRef = useRef<HTMLInputElement>(null);
  // Focus came from a button that stays mounted behind the dialog; returning
  // focus there on close is what keeps keyboard navigation from restarting.
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    amountRef.current?.focus();
    amountRef.current?.select();
    return () => {
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // The overlay reports its own outcome; the webhook is what actually records
  // the donation, so this only drives what the visitor sees.
  useEffect(() => {
    checkoutEventHandler = (eventName: string) => {
      if (eventName === "checkout.completed") setPhase("thanks");
      if (eventName === "checkout.closed") setPhase("form");
    };
    return () => {
      checkoutEventHandler = null;
    };
  }, []);

  const min = Number(settings.min_amount);
  const max = Number(settings.max_amount);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter an amount.");
      return;
    }
    if (parsed < min || parsed > max) {
      setError(`Choose an amount between ${min} and ${max} ${currency}.`);
      return;
    }

    setPhase("submitting");
    try {
      const response = await fetch("/api/v1/donate/checkout/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, currency, message: message.trim() }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          errorMessage(payload, `Could not start the checkout (${response.status}).`)
        );
      }

      const checkout = payload as DonationCheckout;
      const paddle = await loadPaddle(checkout);
      if (paddle) {
        paddle.Checkout.open({ transactionId: checkout.transaction_id });
        setPhase("form");
        return;
      }

      // Paddle.js could not load — a hosted link is the only remaining route,
      // and Paddle only fills it in for accounts that have one configured.
      if (checkout.checkout_url) {
        window.open(checkout.checkout_url, "_blank", "noopener,noreferrer");
        setPhase("form");
        return;
      }
      throw new Error("The payment window could not be opened. Please try again.");
    } catch (err) {
      setPhase("form");
      setError(err instanceof Error ? err.message : "Could not start the checkout.");
    }
  };

  return (
    <div
      className="donate-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="donate-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="donate-title"
      >
        <button
          type="button"
          className="donate-close"
          onClick={onClose}
          aria-label="Close donation dialog"
        >
          <CrossIcon size={18} />
        </button>

        {phase === "thanks" ? (
          <div className="donate-thanks">
            <HeartIcon size={32} className="donate-thanks-icon" />
            <h2 id="donate-title" className="donate-title">
              Thank you
            </h2>
            <p className="donate-lede">
              Your receipt is on its way by email. Every contribution goes
              straight into the retrieval and model costs behind each search.
            </p>
            <button type="button" className="primary-button" onClick={onClose}>
              Back to Recommendica
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h2 id="donate-title" className="donate-title">
              <HeartIcon size={20} />
              <span>Support Recommendica</span>
            </h2>
            <p className="donate-lede">
              Recommendica is free and has no accounts or ads. Every search runs
              real embedding and language-model calls — a donation keeps them
              running. It buys no features and unlocks nothing.
            </p>

            <fieldset className="donate-amounts" disabled={phase === "submitting"}>
              <legend className="donate-label">Amount</legend>
              {settings.presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`donate-preset${amount === preset ? " is-selected" : ""}`}
                  onClick={() => setAmount(preset)}
                  aria-pressed={amount === preset}
                >
                  {preset} {currency}
                </button>
              ))}
            </fieldset>

            <div className="donate-row">
              <div className="donate-field">
                <label className="donate-label" htmlFor="donate-amount">
                  Or enter your own
                </label>
                <input
                  id="donate-amount"
                  ref={amountRef}
                  className="donate-input"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  disabled={phase === "submitting"}
                  aria-describedby="donate-bounds"
                />
                <p className="donate-hint" id="donate-bounds">
                  Between {settings.min_amount} and {settings.max_amount} {currency}.
                </p>
              </div>

              {settings.currencies.length > 1 && (
                <div className="donate-field donate-field-currency">
                  <label className="donate-label" htmlFor="donate-currency">
                    Currency
                  </label>
                  <select
                    id="donate-currency"
                    className="donate-input"
                    value={currency}
                    onChange={(event) => setCurrency(event.target.value)}
                    disabled={phase === "submitting"}
                  >
                    {settings.currencies.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="donate-field">
              <label className="donate-label" htmlFor="donate-message">
                Note (optional)
              </label>
              <input
                id="donate-message"
                className="donate-input"
                type="text"
                maxLength={280}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Anything you'd like us to know"
                disabled={phase === "submitting"}
              />
            </div>

            {error && (
              <p className="donate-error" role="alert">
                {error}
              </p>
            )}

            <div className="donate-actions">
              <button
                type="submit"
                className="primary-button"
                disabled={phase === "submitting"}
              >
                {phase === "submitting" && (
                  <SpinnerIcon size={16} className="button-spinner" />
                )}
                <span>
                  {phase === "submitting" ? "Opening checkout…" : "Continue to payment"}
                </span>
              </button>
              <button type="button" className="ghost-button" onClick={onClose}>
                Not now
              </button>
            </div>

            <p className="donate-foot">
              Payments are handled by Paddle, the merchant of record. Card
              details never reach this site.
              {settings.environment === "sandbox" && " Sandbox mode — no real charge."}
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export default DonateDialog;
