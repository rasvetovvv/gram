"use client";

import { ArrowRight, LifeBuoy, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { HELP_ARTICLES, HELP_CATEGORIES, type HelpCategory } from "./help-data";
import styles from "./public-info.module.css";

function searchable(article: (typeof HELP_ARTICLES)[number]) {
  return [article.title, article.summary, ...article.steps, ...(article.notes ?? []), ...article.keywords]
    .join(" ")
    .toLocaleLowerCase("ru");
}

export function HelpCenter() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | HelpCategory>("all");
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    return HELP_ARTICLES.filter(
      (article) =>
        (category === "all" || article.category === category) &&
        (!needle || searchable(article).includes(needle))
    );
  }, [category, query]);

  return (
    <>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>Help Center / Support</p>
        <h1>Help Center</h1>
        <p className={styles.heroLead}>
          Step-by-step answers about your account, privacy, chats, channels, posts, Stars, and
          safety.
        </p>
      </header>

      <div className={styles.helpToolbar}>
        <label className={styles.searchBox}>
          <Search size={20} aria-hidden />
          <span className="sr-only">Search the help center</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="For example: hide status, create a channel, recover password"
          />
        </label>
        <div className={styles.categoryRow} aria-label="Help categories">
          {HELP_CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCategory(item.id)}
              aria-pressed={category === item.id}
              className={`${styles.categoryButton} ${
                category === item.id ? styles.categoryButtonActive : ""
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length ? (
        <div className={styles.articleList} aria-live="polite">
          {filtered.map((article) => {
            const categoryLabel = HELP_CATEGORIES.find((item) => item.id === article.category)?.label;
            return (
              <details key={article.slug} id={article.slug} className={styles.helpItem}>
                <summary>{article.title}</summary>
                <div className={styles.helpAnswer}>
                  <span className={styles.helpMeta}>{categoryLabel}</span>
                  <p>{article.summary}</p>
                  <ol>
                    {article.steps.map((step) => <li key={step}>{step}</li>)}
                  </ol>
                  {article.notes?.length ? (
                    <ul>
                      {article.notes.map((note) => <li key={note}>{note}</li>)}
                    </ul>
                  ) : null}
                </div>
              </details>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState} aria-live="polite">
          Nothing found. Change your search or contact support.
        </div>
      )}

      <aside className={`${styles.callout} mt-8`}>
        <strong className="flex items-center gap-2">
          <LifeBuoy size={18} />
          No answer, or need a staff review?
        </strong>
        <p>
          Describe the problem through the <Link href="/report">contact form</Link> and keep your
          ticket number. Don&apos;t send your password or a one-time code.
        </p>
        <Link href="/report" className={`${styles.secondaryLink} mt-4`}>
          Open the form
          <ArrowRight size={15} />
        </Link>
      </aside>
    </>
  );
}