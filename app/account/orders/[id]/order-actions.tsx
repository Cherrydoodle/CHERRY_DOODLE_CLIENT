"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Props = { orderId: string; status: string; returnStatus: string };

export function OrderActions({ orderId, status, returnStatus }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showReturnForm, setShowReturnForm] = useState(false);

  const canCancel = status === "pending" || status === "processing";
  const canRequestReturn = status === "delivered" && returnStatus === "none";

  async function cancelOrder() {
    if (!window.confirm("Cancel this order? This cannot be undone.")) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/me/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error("cancel failed");
      router.refresh();
    } catch {
      setMessage("Your order could not be cancelled. It may already be on its way — contact us for help.");
    } finally {
      setBusy(false);
    }
  }

  async function submitReturnRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get("reason");
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/me/orders/${orderId}/return-request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) throw new Error("return request failed");
      setShowReturnForm(false);
      router.refresh();
    } catch {
      setMessage("Your return request could not be submitted. Please try again or contact us.");
    } finally {
      setBusy(false);
    }
  }

  if (!canCancel && !canRequestReturn) return null;

  return (
    <div className="mt-6 rounded-3xl border bg-white p-6 text-sm">
      {canCancel && (
        <button type="button" onClick={cancelOrder} disabled={busy} className="btn-ghost-pink disabled:opacity-60">
          {busy ? "Cancelling…" : "Cancel order"}
        </button>
      )}

      {canRequestReturn && !showReturnForm && (
        <button type="button" onClick={() => setShowReturnForm(true)} className="btn-ghost-pink">
          Request a return
        </button>
      )}

      {canRequestReturn && showReturnForm && (
        <form onSubmit={submitReturnRequest} className="space-y-3">
          <label htmlFor="return-reason" className="block font-medium">Why are you returning this order?</label>
          <textarea
            id="return-reason"
            name="reason"
            required
            minLength={1}
            maxLength={500}
            rows={3}
            placeholder="e.g. item arrived damaged, wrong item received"
            className="w-full rounded-2xl border px-4 py-2.5 text-sm outline-none focus:border-primary"
          />
          <div className="flex gap-3">
            <button type="submit" disabled={busy} className="btn-primary disabled:opacity-60">
              {busy ? "Submitting…" : "Submit return request"}
            </button>
            <button type="button" onClick={() => setShowReturnForm(false)} className="btn-ghost-pink">Cancel</button>
          </div>
        </form>
      )}

      <p className="mt-3 text-muted-foreground" aria-live="polite">{message}</p>
    </div>
  );
}
