"use client";

import { Check, FileWarning, LockKeyhole, Scale, Send } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import { api } from "@/lib/api";
import type {
  LegalReportInput,
  LegalReportKind,
  LegalReporterRole
} from "@/lib/types";
import styles from "./public-info.module.css";

const KINDS: { value: LegalReportKind; label: string }[] = [
  { value: "copyright", label: "Copyright / DMCA" },
  { value: "trademark", label: "Trademark" },
  { value: "privacy", label: "Privacy and personal data" },
  { value: "illegal_content", label: "Allegedly illegal content" },
  { value: "impersonation", label: "Impersonation" },
  { value: "abuse", label: "Harassment, threats, or danger" },
  { value: "fraud_spam", label: "Fraud or spam" },
  { value: "account_access", label: "Account access" },
  { value: "technical", label: "Technical issue" },
  { value: "other", label: "Other request" }
];

const ROLES: { value: LegalReporterRole; label: string }[] = [
  { value: "rights_holder", label: "Rights holder" },
  { value: "authorized_agent", label: "Authorized agent" },
  { value: "content_subject", label: "Person the content concerns" },
  { value: "platform_user", label: "GRAM user" },
  { value: "other", label: "Other role" }
];

const CONTENT_KINDS = new Set<LegalReportKind>([
  "copyright",
  "trademark",
  "privacy",
  "illegal_content",
  "impersonation",
  "abuse",
  "fraud_spam"
]);

function initialState(kind: LegalReportKind): LegalReportInput {
  return {
    kind,
    reporter_role: "platform_user",
    reporter_name: "",
    reporter_email: "",
    country: "",
    account_username: "",
    content_urls: [],
    original_work: "",
    details: "",
    requested_action: "",
    electronic_signature: "",
    good_faith: false,
    accuracy_confirmed: false,
    consent_to_process: false,
    website: ""
  };
}

export function ReportForm({ initialKind = "copyright" }: { initialKind?: LegalReportKind }) {
  const [form, setForm] = useState<LegalReportInput>(() => initialState(initialKind));
  const [urlText, setUrlText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState<string | null>(null);
  const rightsNotice = form.kind === "copyright" || form.kind === "trademark";
  const contentNotice = CONTENT_KINDS.has(form.kind);

  function update<K extends keyof LegalReportInput>(key: K, value: LegalReportInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const receipt = await api.submitLegalReport({
        ...form,
        content_urls: urlText
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean)
      });
      setReference(receipt.reference_code);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn’t submit your report");
    } finally {
      setPending(false);
    }
  }

  if (reference) {
    return (
      <section className={styles.success} aria-live="polite">
        <div>
          <span className={styles.successMark}><Check size={30} /></span>
          <h2>Report received</h2>
          <p className={styles.heroLead}>
            Save the reference. It will help link a clarification or appeal to this report.
          </p>
          <span className={styles.reference}>{reference}</span>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              className={styles.secondaryLink}
              onClick={() => {
                setForm(initialState(initialKind));
                setUrlText("");
                setReference(null);
              }}
            >
              New report
            </button>
            <Link href="/help" className={styles.primaryLink}>Help Center</Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className={styles.reportGrid}>
      <form className={styles.form} onSubmit={submit} noValidate={false}>
        <fieldset className={styles.formSection}>
          <legend>1. Report type</legend>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              Category
              <select
                value={form.kind}
                onChange={(event) => update("kind", event.target.value as LegalReportKind)}
              >
                {KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              Your role
              <select
                value={form.reporter_role}
                onChange={(event) => update("reporter_role", event.target.value as LegalReporterRole)}
              >
                {ROLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset className={styles.formSection}>
          <legend>2. Contact details</legend>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              Full name
              <input
                required
                minLength={2}
                maxLength={100}
                autoComplete="name"
                value={form.reporter_name}
                onChange={(event) => update("reporter_name", event.target.value)}
              />
            </label>
            <label className={styles.field}>
              Contact email
              <input
                required
                type="email"
                maxLength={254}
                autoComplete="email"
                value={form.reporter_email}
                onChange={(event) => update("reporter_email", event.target.value)}
              />
            </label>
            <label className={styles.field}>
              Country or region <span className={styles.fieldHint}>optional</span>
              <input
                maxLength={80}
                autoComplete="country-name"
                value={form.country ?? ""}
                onChange={(event) => update("country", event.target.value)}
              />
            </label>
            <label className={styles.field}>
              GRAM username <span className={styles.fieldHint}>optional</span>
              <input
                maxLength={32}
                placeholder="@username"
                value={form.account_username ?? ""}
                onChange={(event) => update("account_username", event.target.value)}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className={styles.formSection}>
          <legend>3. Content and circumstances</legend>
          <label className={styles.field}>
            Direct links — one per line {contentNotice ? "*" : "(optional)"}
            <span className={styles.fieldHint}>
              Up to 10 links to a post, profile, message, or community. Each must start with https://.
            </span>
            <textarea
              required={contentNotice}
              value={urlText}
              onChange={(event) => setUrlText(event.target.value)}
              placeholder="https://vexory.xyz/post/…"
            />
          </label>

          {rightsNotice ? (
            <label className={styles.field}>
              Original work or protected subject matter *
              <span className={styles.fieldHint}>
                What exactly is protected, where the original is, and why you have the right to act.
              </span>
              <textarea
                required
                maxLength={3000}
                value={form.original_work ?? ""}
                onChange={(event) => update("original_work", event.target.value)}
              />
            </label>
          ) : null}

          <label className={styles.field}>
            Detailed description *
            <span className={styles.fieldHint}>
              At least 30 characters: what happened, when, who is affected, and what steps you’ve already tried.
            </span>
            <textarea
              required
              minLength={30}
              maxLength={5000}
              value={form.details}
              onChange={(event) => update("details", event.target.value)}
            />
          </label>

          <label className={styles.field}>
            Requested action <span className={styles.fieldHint}>optional</span>
            <textarea
              maxLength={1000}
              value={form.requested_action ?? ""}
              onChange={(event) => update("requested_action", event.target.value)}
              placeholder="For example: restrict access, correct data, or help recover an account"
            />
          </label>
        </fieldset>

        <fieldset className={styles.formSection}>
          <legend>4. Confirmations</legend>
          {rightsNotice ? (
            <>
              <label className={styles.checkbox}>
                <input
                  required
                  type="checkbox"
                  checked={form.good_faith}
                  onChange={(event) => update("good_faith", event.target.checked)}
                />
                <span>I have a good-faith belief that the disputed use is not authorized by the rights holder, its agent, or the law.</span>
              </label>
              <label className={styles.field}>
                Electronic signature *
                <span className={styles.fieldHint}>Full name of the rights holder or authorized agent.</span>
                <input
                  required
                  maxLength={120}
                  value={form.electronic_signature ?? ""}
                  onChange={(event) => update("electronic_signature", event.target.value)}
                />
              </label>
            </>
          ) : null}
          <label className={styles.checkbox}>
            <input
              required
              type="checkbox"
              checked={form.accuracy_confirmed}
              onChange={(event) => update("accuracy_confirmed", event.target.checked)}
            />
            <span>I confirm that the information is accurate and that I am authorized to submit this report.</span>
          </label>
          <label className={styles.checkbox}>
            <input
              required
              type="checkbox"
              checked={form.consent_to_process}
              onChange={(event) => update("consent_to_process", event.target.checked)}
            />
            <span>I consent to the processing of the data provided for review and response in accordance with the Privacy Policy.</span>
          </label>
          <label className={styles.honeypot} aria-hidden="true">
            Website
            <input
              tabIndex={-1}
              autoComplete="off"
              value={form.website ?? ""}
              onChange={(event) => update("website", event.target.value)}
            />
          </label>
        </fieldset>

        {error ? <div className={styles.formError} role="alert">{error}</div> : null}
        <button type="submit" className={styles.submit} disabled={pending}>
          {pending ? "Submitting…" : <><Send size={17} /> Submit report</>}
        </button>
      </form>

      <aside className={styles.sideStack}>
        <section className={styles.sideCard}>
          <h2 className="flex items-center gap-2"><LockKeyhole size={17} /> Don’t send secrets</h2>
          <p>A password, email code, full card number, seed phrase, or private key are not needed for review.</p>
        </section>
        <section className={styles.sideCard}>
          <h2 className="flex items-center gap-2"><Scale size={17} /> For rights holders</h2>
          <ul>
            <li>Provide direct links to each piece of content.</li>
            <li>Describe the original and your authority.</li>
            <li>Sign the notice with your full name.</li>
          </ul>
        </section>
        <section className={styles.sideCard}>
          <h2 className="flex items-center gap-2"><FileWarning size={17} /> Urgent danger</h2>
          <p>If there is an immediate threat to life, contact your local emergency services first, then send the link to GRAM.</p>
        </section>
        <section className={styles.sideCard}>
          <h3>Useful documents</h3>
          <p><Link className={styles.inlineLink} href="/community-guidelines">Community Guidelines</Link></p>
          <p><Link className={styles.inlineLink} href="/privacy">Privacy Policy</Link></p>
          <p><Link className={styles.inlineLink} href="/data-processing">Data Processing</Link></p>
        </section>
      </aside>
    </div>
  );
}
