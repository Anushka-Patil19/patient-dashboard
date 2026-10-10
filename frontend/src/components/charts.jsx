import {
  Area,
  AreaChart,
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
import { SERIES_SLOTS, useChartTheme } from '../hooks/useChartTheme.js';
import { formatNumber, formatPeriod } from '../lib/format.js';

function ChartTooltip({ active, payload, label, labelFormatter, theme }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="min-w-36 rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{ background: theme.surface, borderColor: theme['line-strong'], color: theme.ink }}
    >
      <p className="mb-1 font-semibold">{labelFormatter ? labelFormatter(label) : label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5" style={{ color: theme['ink-2'] }}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
            {p.name}
          </span>
          <span className="tabular font-medium">{formatNumber(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

const axisProps = (theme) => ({
  stroke: theme['line-strong'],
  tick: { fill: theme.muted, fontSize: 11 },
  tickLine: false,
});

/** Single-series volume over time: 2px line with a 10% area wash. */
export function VolumeChart({ data, granularity, height = 220 }) {
  const theme = useChartTheme();
  const fmt = (p) => formatPeriod(p, granularity);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke={theme.line} />
        <XAxis dataKey="period" tickFormatter={fmt} minTickGap={24} {...axisProps(theme)} />
        <YAxis allowDecimals={false} axisLine={false} {...axisProps(theme)} />
        <Tooltip
          content={<ChartTooltip theme={theme} labelFormatter={fmt} />}
          cursor={{ stroke: theme['line-strong'], strokeWidth: 1 }}
        />
        <Area
          type="monotone"
          dataKey="total"
          name="Encounters"
          stroke={theme['series-1']}
          strokeWidth={2}
          fill={theme['series-1']}
          fillOpacity={0.1}
          activeDot={{ r: 4, stroke: theme.surface, strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Up to three diagnoses over time; colour slot is fixed per selected diagnosis. */
export function TrendLines({ data, series, labels, granularity, height = 240 }) {
  const theme = useChartTheme();
  const fmt = (p) => formatPeriod(p, granularity);
  const rows = data.map((d) => Object.fromEntries([['period', d.period], ...series.map((s) => [s.code, d[s.code] ?? 0])]));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke={theme.line} />
        <XAxis dataKey="period" tickFormatter={fmt} minTickGap={24} {...axisProps(theme)} />
        <YAxis allowDecimals={false} axisLine={false} {...axisProps(theme)} />
        <Tooltip content={<ChartTooltip theme={theme} labelFormatter={fmt} />} cursor={{ stroke: theme['line-strong'] }} />
        {series.map((s) => (
          <Line
            key={s.code}
            type="monotone"
            dataKey={s.code}
            name={labels[s.code] ?? s.code}
            stroke={theme[SERIES_SLOTS[s.slot]]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: theme.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Horizontal single-series bars with the value at the tip. */
export function HBarChart({ data, labelKey, valueKey = 'count', name = 'Encounters' }) {
  const theme = useChartTheme();
  const height = Math.max(120, data.length * 30 + 16);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }} barCategoryGap={6}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey={labelKey}
          width={150}
          axisLine={false}
          tickLine={false}
          tick={{ fill: theme['ink-2'], fontSize: 12 }}
        />
        <Tooltip content={<ChartTooltip theme={theme} />} cursor={{ fill: theme.line, opacity: 0.5 }} />
        <Bar dataKey={valueKey} name={name} fill={theme['series-1']} radius={[0, 4, 4, 0]} barSize={18} isAnimationActive={false}>
          <LabelList dataKey={valueKey} position="right" fill={theme['ink-2']} fontSize={11} formatter={formatNumber} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Vertical single-series columns with the value on the cap. */
export function ColumnChart({ data, labelKey, valueKey = 'count', name = 'Encounters', height = 220 }) {
  const theme = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 18, right: 4, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke={theme.line} />
        <XAxis dataKey={labelKey} {...axisProps(theme)} />
        <YAxis allowDecimals={false} axisLine={false} {...axisProps(theme)} />
        <Tooltip content={<ChartTooltip theme={theme} />} cursor={{ fill: theme.line, opacity: 0.5 }} />
        <Bar dataKey={valueKey} name={name} fill={theme['series-1']} radius={[4, 4, 0, 0]} barSize={24} isAnimationActive={false}>
          <LabelList dataKey={valueKey} position="top" fill={theme['ink-2']} fontSize={11} formatter={formatNumber} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
