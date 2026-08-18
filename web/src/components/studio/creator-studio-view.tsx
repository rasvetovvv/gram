"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Eye,
  FileText,
  Heart,
  Save,
  Sparkles,
  Star,
  Users,
  WalletCards
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { socialApi } from "@/lib/social-api";
import type { CreatorAnalytics, CreatorSeriesPoint } from "@/lib/social-types";
import styles from "./studio.module.css";

const settingsSchema = z
  .object({
    paid_subscription_enabled: z.boolean(),
    monthly_price: z.number().int("Только целое количество").min(1).max(10000)
  })
  .superRefine((value, context) => {
    if (value.paid_subscription_enabled && value.monthly_price < 5) {
      context.addIssue({
        code: "custom",
        path: ["monthly_price"],
        message: "Цена подписки — от 5 звёзд"
      });
    }
  });

type SettingsForm = z.infer<typeof settingsSchema>;
type SeriesMetric = "views" | "followers" | "stars";

const metricLabels: Record<SeriesMetric, string> = {
  views: "Просмотры",
  followers: "Подписчики",
  stars: "Звёзды"
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось загрузить данные";
}

function AnalyticsChart({ analytics }: { analytics: CreatorAnalytics }) {
  const [metric, setMetric] = useState<SeriesMetric>("views");
  const points = analytics.series ?? [];
  const maxValue = Math.max(1, ...points.map((point) => point[metric]));
  const total = points.reduce((sum, point) => sum + point[metric], 0);

  return (
    <section className={styles.dynamics} aria-labelledby="dynamics-title">
      <div className={styles.sectionHeading}>
        <div>
          <h2 id="dynamics-title">Динамика за {analytics.period_days} дней</h2>
          <p>Только события, зафиксированные GRAM</p>
        </div>
        <strong>{formatNumber(total)} <small>{metricLabels[metric].toLowerCase()}</small></strong>
      </div>
      <div className={styles.chartTabs} role="tablist" aria-label="Показатель графика">
        {(Object.keys(metricLabels) as SeriesMetric[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={metric === key}
            data-active={metric === key}
            onClick={() => setMetric(key)}
          >
            {metricLabels[key]}
          </button>
        ))}
      </div>
      {points.length ? (
        <div className={styles.chart} role="img" aria-label={`${metricLabels[metric]} по дням`}>
          {points.map((point: CreatorSeriesPoint) => {
            const value = point[metric];
            return (
              <span key={`${point.date}-${metric}`} className={styles.chartColumn}>
                <i style={{ height: `${Math.max(4, (value / maxValue) * 100)}%` }} title={`${point.date}: ${value}`} />
                <small>{new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(new Date(point.date))}</small>
              </span>
            );
          })}
        </div>
      ) : (
        <div className={styles.chartEmpty}>
          <BarChart3 size={28} />
          <strong>Данных пока недостаточно</strong>
          <p>График появится после первых просмотров и подписок.</p>
        </div>
      )}
    </section>
  );
}

export function CreatorStudioView() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["creator", "settings"], queryFn: socialApi.creatorSettings });
  const analytics = useQuery({ queryKey: ["creator", "analytics"], queryFn: socialApi.creatorAnalytics });

  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: { paid_subscription_enabled: false, monthly_price: 25 }
  });

  useEffect(() => {
    if (settings.data) form.reset(settings.data);
  }, [form, settings.data]);

  const updateSettings = useMutation({
    mutationFn: socialApi.updateCreatorSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(["creator", "settings"], data);
      form.reset(data);
    }
  });

  const paidEnabled = useWatch({ control: form.control, name: "paid_subscription_enabled" });
  const metrics = useMemo(() => {
    if (!analytics.data) return [];
    return [
      { label: "Просмотры", value: analytics.data.views, icon: Eye, tone: "cyan" },
      { label: "Подписчики", value: analytics.data.followers, icon: Users, tone: "mint" },
      { label: "Заработано", value: analytics.data.earned, icon: Star, tone: "gold", suffix: "★" },
      { label: "Вовлечённость", value: analytics.data.engagement, icon: Heart, tone: "pink", suffix: "%" },
      { label: "Публикации", value: analytics.data.posts, icon: FileText, tone: "violet" },
      { label: "Спонсоры", value: analytics.data.sponsors, icon: Sparkles, tone: "orange" }
    ];
  }, [analytics.data]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Студия автора</h1>
          <p>Монетизация и аналитика вашего профиля</p>
        </div>
      </header>

      {analytics.isPending ? (
        <section className={styles.heroLoading} aria-label="Статистика загружается"><span /><span /></section>
      ) : analytics.isError ? (
        <section className={styles.loadError}>
          <BarChart3 size={28} />
          <strong>Не удалось открыть аналитику</strong>
          <p>{messageFrom(analytics.error)}</p>
          <button type="button" onClick={() => analytics.refetch()}>Повторить</button>
        </section>
      ) : (
        <>
          <section className={styles.balanceHero} aria-label="Баланс автора">
            <span className={styles.creatorMark}><Sparkles size={34} /></span>
            <div>
              <span>Доступно автору</span>
              <strong>{formatNumber(analytics.data.balance)} <small>★</small></strong>
              <p>{formatNumber(analytics.data.earned)} ★ заработано за {analytics.data.period_days} дней</p>
            </div>
          </section>

          <section className={styles.metrics} aria-label={`Обзор за ${analytics.data.period_days} дней`}>
            {metrics.map((metric) => {
              const Icon = metric.icon;
              return (
                <div key={metric.label} data-tone={metric.tone}>
                  <span><Icon size={17} /> {metric.label}</span>
                  <strong>{formatNumber(metric.value)}{metric.suffix ? ` ${metric.suffix}` : ""}</strong>
                </div>
              );
            })}
          </section>
        </>
      )}

      <section className={styles.monetization} aria-labelledby="monetization-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="monetization-title">Платная подписка</h2>
            <p>Доступ к закрытым публикациям за звёзды каждый месяц</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={paidEnabled}
            className={styles.switch}
            data-active={paidEnabled}
            disabled={settings.isPending || settings.isError}
            onClick={() => form.setValue("paid_subscription_enabled", !paidEnabled, { shouldDirty: true })}
          >
            <span />
            <span className={styles.srOnly}>{paidEnabled ? "Выключить" : "Включить"} платную подписку</span>
          </button>
        </div>

        {settings.isError ? (
          <div className={styles.inlineError}>
            <span>{messageFrom(settings.error)}</span>
            <button type="button" onClick={() => settings.refetch()}>Повторить</button>
          </div>
        ) : (
          <form className={styles.settingsForm} onSubmit={form.handleSubmit((values) => updateSettings.mutate(values))}>
            <label>
              <span>Цена в месяц</span>
              <span className={styles.priceField} data-disabled={!paidEnabled}>
                <input
                  type="number"
                  min={5}
                  max={10000}
                  disabled={!paidEnabled || settings.isPending}
                  aria-invalid={Boolean(form.formState.errors.monthly_price)}
                  {...form.register("monthly_price", { valueAsNumber: true })}
                />
                <Star size={17} fill="currentColor" />
              </span>
              {form.formState.errors.monthly_price ? (
                <small role="alert">{form.formState.errors.monthly_price.message}</small>
              ) : (
                <small>Подписчик увидит точную сумму до подтверждения.</small>
              )}
            </label>
            <button
              className={styles.saveButton}
              type="submit"
              disabled={!form.formState.isDirty || updateSettings.isPending || settings.isPending}
            >
              <Save size={18} />
              {updateSettings.isPending ? "Сохраняем…" : form.formState.isDirty ? "Сохранить" : "Сохранено"}
            </button>
            {updateSettings.isError ? <p className={styles.formError}>{messageFrom(updateSettings.error)}</p> : null}
          </form>
        )}
      </section>

      {analytics.data ? <AnalyticsChart analytics={analytics.data} /> : null}

      {analytics.data ? (
        <section className={styles.topPosts} aria-labelledby="top-posts-title">
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="top-posts-title">Лучшие публикации</h2>
              <p>По просмотрам за выбранный период</p>
            </div>
          </div>
          {analytics.data.top_posts.length ? (
            <ol>
              {analytics.data.top_posts.map((post, index) => (
                <li key={post.id}>
                  <span>{index + 1}</span>
                  <p>{post.content}</p>
                  <dl>
                    <div><Eye size={14} /><dt className={styles.srOnly}>Просмотры</dt><dd>{formatNumber(post.views_count)}</dd></div>
                    <div><Heart size={14} /><dt className={styles.srOnly}>Отметки нравится</dt><dd>{formatNumber(post.likes_count)}</dd></div>
                  </dl>
                </li>
              ))}
            </ol>
          ) : (
            <div className={styles.topPostsEmpty}>
              <WalletCards size={26} />
              <p>Опубликуйте первый пост — его реальные показатели появятся здесь.</p>
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
