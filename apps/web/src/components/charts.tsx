'use client';

import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';

/**
 * Chart conventions (from the dataviz method): one axis, 2px lines, bars ≤ 24px with 4px rounded
 * data-ends, hairline solid grid, values lead in tooltips, text in text tokens (never series
 * colour), and every chart has a table twin.
 */

const AXIS_TICK = { fill: 'var(--chart-muted)', fontSize: 12 };

function TooltipCard({
  title,
  rows,
}: {
  title: ReactNode;
  rows: Array<{ color?: string; label: string; value: string }>;
}) {
  return (
    <div className="rounded-xl border bg-popover px-3 py-2.5 text-[13px] shadow-lift">
      <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="flex items-center gap-2">
          {row.color && (
            <span className="h-0.5 w-3 rounded-full" style={{ background: row.color }} aria-hidden />
          )}
          <span className="font-bold tabular-nums">{row.value}</span>
          <span className="text-muted-foreground">{row.label}</span>
        </p>
      ))}
    </div>
  );
}

export interface LineSeries<K extends string> {
  key: K;
  label: string;
  color: string;
}

export function TrendChart<K extends string>({
  data,
  series,
  xKey,
  formatX,
  height = 260,
}: {
  data: Array<Record<string, string | number>>;
  series: Array<LineSeries<K>>;
  xKey: string;
  formatX: (value: string) => string;
  height?: number;
}) {
  const last = data.at(-1);
  return (
    <div>
      {/* Legend: always present for 2+ series, line keys mirror the marks. */}
      <div className="mb-3 flex flex-wrap gap-4 text-[13px]">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-2 font-semibold">
            <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} aria-hidden />
            {s.label}
            {last && (
              <span className="font-normal text-muted-foreground tabular-nums">
                {String(last[s.key])} on the last day
              </span>
            )}
          </span>
        ))}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1} />
            <XAxis
              dataKey={xKey}
              tickFormatter={formatX}
              tick={AXIS_TICK}
              axisLine={{ stroke: 'var(--chart-axis)' }}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
            <Tooltip
              cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1 }}
              content={(props) =>
                props.active && props.payload?.length ? (
                  <TooltipCard
                    title={formatX(String(props.label))}
                    rows={series.map((s) => ({
                      color: s.color,
                      label: s.label,
                      value: String(props.payload?.find((p) => p.dataKey === s.key)?.value ?? 0),
                    }))}
                  />
                ) : null
              }
            />
            {series.map((s) => (
              <Line
                key={s.key}
                // Counts per day: straight segments, never curves that imply values between days.
                type="linear"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--card)', fill: s.color }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Horizontal bars for comparing magnitude across named categories: one hue, value at the tip. */
export function RankedBars({
  data,
  color = 'var(--chart-1)',
  valueSuffix = '',
}: {
  data: Array<{ label: string; value: number }>;
  color?: string;
  valueSuffix?: string;
}) {
  const height = data.length * 40 + 8;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 44, bottom: 0, left: 0 }}
          barCategoryGap={12}
        >
          <CartesianGrid horizontal={false} stroke="var(--chart-grid)" strokeWidth={1} />
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="label"
            width={190}
            tick={{ fill: 'var(--foreground)', fontSize: 13, fontWeight: 600 }}
            axisLine={{ stroke: 'var(--chart-axis)' }}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
            content={(props) =>
              props.active && props.payload?.[0] ? (
                <TooltipCard
                  title={String(props.label)}
                  rows={[{ label: 'tickets', value: `${props.payload[0].value}${valueSuffix}` }]}
                />
              ) : null
            }
          />
          <Bar dataKey="value" fill={color} barSize={20} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            <LabelList
              dataKey="value"
              position="right"
              style={{ fill: 'var(--foreground)', fontSize: 13, fontWeight: 700 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A single ratio against its limit: same-ramp track, severity in the fill. */
export function Meter({
  value,
  label,
  tone = 'leaf',
}: {
  value: number | null;
  label: string;
  tone?: 'leaf' | 'accent' | 'warning';
}) {
  const pct = value === null ? 0 : Math.round(value * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">{label}</span>
        <span className="figure text-2xl font-black">{value === null ? '—' : `${pct}%`}</span>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a native <meter> can't take the same-ramp track styling */}
      <div
        className={cn(
          'mt-2 h-2.5 overflow-hidden rounded-full',
          tone === 'leaf' ? 'bg-leaf-soft' : tone === 'accent' ? 'bg-accent-soft' : 'bg-warning-soft',
        )}
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={cn(
            'h-full rounded-full',
            tone === 'leaf' ? 'bg-leaf' : tone === 'accent' ? 'bg-accent' : 'bg-warning',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** The table twin every chart ships with (WCAG-clean, and the home of every value). */
export function ChartTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}) {
  return (
    <details className="mt-4 rounded-xl border bg-background-deep/30 text-[13px]">
      <summary className="cursor-pointer px-3.5 py-2 font-semibold text-muted-foreground hover:text-foreground">
        View as table
      </summary>
      <div className="max-h-72 overflow-auto px-3.5 pb-3 scrollbar-thin">
        <table className="w-full">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {columns.map((c, i) => (
                <th key={c} className={cn('py-2 font-bold', i > 0 && 'text-right')}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((row) => (
              <tr key={String(row[0])}>
                {row.map((cell, i) => (
                  <td
                    key={`${row[0]}-${columns[i]}`}
                    className={cn('py-1.5', i > 0 && 'text-right tabular-nums')}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
