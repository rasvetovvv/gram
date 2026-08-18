"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, MessagesSquare, ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthBrand } from "./auth-shell";
import styles from "./auth.module.css";

/** Marks the intro as seen, so it opens once per browser rather than on every visit. */
export const INTRO_KEY = "gram.intro.seen";

/**
 * The three-slide first run from `authref/`: icon tile, title, one paragraph, dots and a
 * violet action that reads "Далее" until the last slide.
 *
 * The middle slide describes what GRAM actually does — rotating refresh sessions you can
 * revoke — rather than borrowing the reference's claim of an in-house encrypted protocol.
 */
const SLIDES = [
  {
    key: "welcome",
    icon: Sparkles,
    title: "Добро пожаловать в GRAM",
    text: "Публикации, истории, сообщения и подарки — вся социальная жизнь в одном лёгком приложении."
  },
  {
    key: "sessions",
    icon: ShieldCheck,
    title: "Сессии под вашим контролем",
    text: "Вход держится на коротком токене и обновляемой сессии. Каждое устройство видно в настройках, и любое можно отключить."
  },
  {
    key: "ready",
    icon: MessagesSquare,
    title: "Всё готово",
    text: "Создайте аккаунт за минуту и присоединяйтесь к сообществу."
  }
] as const;

export function WelcomeCarousel() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index];
  const Icon = slide.icon;
  const last = index === SLIDES.length - 1;

  /** Marking it seen before leaving is what keeps `/login` from sending us straight back. */
  function leave(to: string) {
    try {
      window.localStorage.setItem(INTRO_KEY, "1");
    } catch {
      // Private mode: the intro simply shows again next time.
    }
    router.replace(to);
  }

  return (
    <main className={styles.plainViewport}>
      <header className={styles.introHeader}>
        <AuthBrand compact />
        <button type="button" className={styles.introSkip} onClick={() => leave("/login")}>
          Пропустить
        </button>
      </header>

      <div className={styles.introStage}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={slide.key}
            className={styles.introStage}
            style={{ padding: 0, flex: "initial" }}
            initial={reduceMotion ? undefined : { opacity: 0, y: 14 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -14 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className={styles.introTile} aria-hidden>
              <Icon size={38} />
            </span>
            <h1 className={styles.introTitle}>{slide.title}</h1>
            <p className={styles.introText}>{slide.text}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className={styles.introFooter}>
        <div className={styles.introDots} role="tablist" aria-label="Слайды">
          {SLIDES.map((item, position) => (
            <button
              key={item.key}
              role="tab"
              aria-selected={position === index}
              aria-label={item.title}
              onClick={() => setIndex(position)}
              className={`${styles.introDot} ${position === index ? styles.introDotActive : ""}`}
            />
          ))}
        </div>
        <button
          type="button"
          className={styles.introButton}
          onClick={() => (last ? leave("/register") : setIndex((current) => current + 1))}
        >
          {last ? "Начать" : "Далее"}
          {last ? null : <ArrowRight size={19} />}
        </button>
        <button type="button" className={styles.introSkip} onClick={() => leave("/login")}>
          У меня уже есть аккаунт
        </button>
      </div>
    </main>
  );
}
