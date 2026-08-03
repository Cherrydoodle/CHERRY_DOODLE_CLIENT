"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Address = {
  id: string; label: string; recipientName: string; phoneNumber: string; line1: string; line2: string | null;
  city: string; state: string; postalCode: string; countryCode: string; isDefault: boolean; version: number;
};
type Problem = { detail?: string; errors?: Array<{ path: string; message: string }> };

async function readProblem(response: Response) {
  const problem = (await response.json().catch(() => ({}))) as Problem;
  return problem.errors?.[0]?.message ?? problem.detail ?? "The request could not be completed.";
}

const emptyForm = { label: "Shipping", recipientName: "", phoneNumber: "", line1: "", line2: "", city: "", state: "", postalCode: "", countryCode: "IN", isDefault: false };

export function AddressesManager() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Address | null>(null);

  const load = async () => {
    try {
      const response = await fetch("/api/v1/me/addresses");
      if (!response.ok) throw new Error(await readProblem(response));
      const payload = (await response.json()) as { data: Address[] };
      setAddresses(payload.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your addresses.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/v1/me/addresses");
        if (!response.ok) throw new Error(await readProblem(response));
        const payload = (await response.json()) as { data: Address[] };
        if (cancelled) return;
        setAddresses(payload.data);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load your addresses.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submitCreate = async (values: typeof emptyForm) => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/me/addresses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, line2: values.line2 || undefined }),
      });
      if (!response.ok) throw new Error(await readProblem(response));
      setAdding(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The address could not be saved.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitEdit = async (address: Address, values: typeof emptyForm) => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/me/addresses/${address.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, line2: values.line2 || null, expectedVersion: address.version }),
      });
      if (!response.ok) throw new Error(await readProblem(response));
      setEditingId(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The address could not be updated.");
    } finally {
      setSubmitting(false);
    }
  };

  const setDefault = async (address: Address) => {
    setError(null);
    try {
      const response = await fetch(`/api/v1/me/addresses/${address.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isDefault: true, expectedVersion: address.version }),
      });
      if (!response.ok) throw new Error(await readProblem(response));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not set this address as default.");
    }
  };

  const remove = async (address: Address) => {
    setError(null);
    try {
      const response = await fetch(`/api/v1/me/addresses/${address.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: address.version }),
      });
      if (!response.ok && response.status !== 204) throw new Error(await readProblem(response));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The address could not be deleted.");
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <section className="mx-auto mt-12 max-w-2xl px-6 pb-16">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-3xl font-black">Your addresses</h1>
        <Link href="/account" className="text-sm text-primary hover:underline">Back to account</Link>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">Manage the shipping addresses saved to your account.</p>

      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}

      <div className="mt-6 space-y-4">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && addresses.length === 0 && !adding && (
          <p className="rounded-3xl border bg-white p-6 text-sm text-muted-foreground">You haven&apos;t saved any addresses yet.</p>
        )}
        {addresses.map((address) => (
          <div key={address.id} className="rounded-3xl border bg-white p-6">
            {editingId === address.id ? (
              <AddressForm
                initial={{ label: address.label, recipientName: address.recipientName, phoneNumber: address.phoneNumber, line1: address.line1, line2: address.line2 ?? "", city: address.city, state: address.state, postalCode: address.postalCode, countryCode: address.countryCode, isDefault: address.isDefault }}
                submitting={submitting}
                onCancel={() => setEditingId(null)}
                onSubmit={(values) => submitEdit(address, values)}
              />
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm">
                    <div className="flex items-center gap-2 font-bold">
                      {address.label}
                      {address.isDefault && <span className="chip bg-mint">Default</span>}
                    </div>
                    <p className="mt-1 text-muted-foreground">{address.recipientName} · {address.phoneNumber}</p>
                    <p className="mt-1 text-muted-foreground">
                      {[address.line1, address.line2, address.city, address.state, address.postalCode, address.countryCode].filter(Boolean).join(", ")}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-3 text-sm">
                  <button type="button" onClick={() => setEditingId(address.id)} className="btn-ghost-pink">Edit</button>
                  {!address.isDefault && <button type="button" onClick={() => setDefault(address)} className="btn-ghost-pink">Set as default</button>}
                  <button type="button" onClick={() => setPendingDelete(address)} className="btn-ghost-pink text-destructive">Delete</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6">
        {adding ? (
          <div className="rounded-3xl border bg-white p-6">
            <AddressForm initial={emptyForm} submitting={submitting} onCancel={() => setAdding(false)} onSubmit={submitCreate} />
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="btn-primary">Add new address</button>
        )}
      </div>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete address</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && `Delete the "${pendingDelete.label}" address? This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingDelete && remove(pendingDelete)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function AddressForm({ initial, submitting, onCancel, onSubmit }: {
  initial: typeof emptyForm;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: typeof emptyForm) => void;
}) {
  const [postalCode, setPostalCode] = useState(initial.postalCode);
  const [countryCode, setCountryCode] = useState(initial.countryCode);
  // Soft, non-blocking heads-up only -- unlike checkout, saving an address never
  // touches Delhivery, so an unserviceable pincode here is just a hint, not a gate.
  const [serviceabilityWarning, setServiceabilityWarning] = useState(false);

  // Mirrors the debounced fetch below's status into state; there is no way to
  // compute this during render since it depends on an in-flight network request.
  useEffect(() => {
    if (countryCode !== "IN" || !/^[1-9][0-9]{5}$/.test(postalCode.replace(/\s/g, ""))) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setServiceabilityWarning(false);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      fetch(`/api/v1/shipping/serviceability?pincode=${encodeURIComponent(postalCode)}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((payload) => setServiceabilityWarning(payload?.data?.serviceable === false))
        .catch(() => setServiceabilityWarning(false));
    }, 500);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [postalCode, countryCode]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSubmit({
      label: String(data.get("label") || "Shipping"),
      recipientName: String(data.get("recipientName") || ""),
      phoneNumber: String(data.get("phoneNumber") || ""),
      line1: String(data.get("line1") || ""),
      line2: String(data.get("line2") || ""),
      city: String(data.get("city") || ""),
      state: String(data.get("state") || ""),
      postalCode: String(data.get("postalCode") || ""),
      countryCode: String(data.get("countryCode") || "IN"),
      isDefault: data.get("isDefault") === "on",
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="label" label="Label" defaultValue={initial.label} />
        <Field name="recipientName" label="Recipient name" defaultValue={initial.recipientName} minLength={2} />
      </div>
      <Field name="phoneNumber" label="Phone number" defaultValue={initial.phoneNumber} type="tel" minLength={7} />
      <Field name="line1" label="Address line 1" defaultValue={initial.line1} minLength={3} />
      <Field name="line2" label="Address line 2 (optional)" defaultValue={initial.line2} required={false} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="city" label="City" defaultValue={initial.city} minLength={2} />
        <Field name="state" label="State" defaultValue={initial.state} minLength={2} />
        <Field name="postalCode" label="Postal code" value={postalCode} onChange={(event) => setPostalCode(event.target.value)} minLength={3} />
      </div>
      {serviceabilityWarning && (
        <p className="rounded-2xl bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Heads up: we can&apos;t currently deliver to this pincode. You can still save the address.
        </p>
      )}
      <Field name="countryCode" label="Country code" value={countryCode} onChange={(event) => setCountryCode(event.target.value.toUpperCase())} maxLength={2} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isDefault" defaultChecked={initial.isDefault} />
        Set as default address
      </label>
      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-60">{submitting ? "Saving…" : "Save address"}</button>
        <button type="button" onClick={onCancel} className="btn-ghost-pink">Cancel</button>
      </div>
    </form>
  );
}

function Field({ label, required = true, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block text-sm font-bold">
      {label}
      <input {...props} required={required} className="mt-1.5 w-full rounded-2xl border bg-white px-4 py-3 font-normal outline-none focus:border-primary" />
    </label>
  );
}
