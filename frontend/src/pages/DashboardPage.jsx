import { useEffect, useMemo, useState } from 'react';
import { ColumnChart, HBarChart, TrendLines, VolumeChart } from '../components/charts.jsx';
import { ErrorAlert, PageHeader, Spinner } from '../components/ui.jsx';
import { useApi, useMeta } from '../hooks/useApi.js';
import { SERIES_SLOTS } from '../hooks/useChartTheme.js';
import { useLiveRefresh } from '../hooks/useLiveUpdates.jsx';
import { addDays, formatDate, formatNumber, formatPeriod, percent, SEX_LABEL, todayIST } from '../lib/format.js';
import { initialSeries, MAX_SERIES, toggleSeries } from '../lib/seriesSlots.js';

const PRESETS = [
  ['30d', 'Last 30 days', 29],
  ['90d', 'Last 90 days', 89],
  ['6m', 'Last 6 months', 182],
  ['12m', 'Last 12 months', 364],
];

function StatTile({ label, value, sub, delta }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {(sub || delta) && (
        <p className="mt-1 text-xs text-muted">
          {delta && (
            // More encounters is neither good nor bad, so the delta stays in neutral ink.
            <span className="mr-1 font-medium text-ink">
              {delta.up ? '▲' : '▼'} {delta.text}
            </span>
          )}
          {sub}
        </p>
      )}
    </div>
  );
}

function Panel({ title, subtitle, actions, children }) {
  return (
    <section className="card p-4 md:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export default function DashboardPage() {
  const meta = useMeta();
  const [preset, setPreset] = useState('90d');
  const [custom, setCustom] = useState({ from: addDays(todayIST(), -89), to: todayIST() });
  const [granularity, setGranularity] = useState('auto');
  const [district, setDistrict] = useState('');
  const [series, setSeries] = useState([]);
  const [showTable, setShowTable] = useState(false);

  const range = useMemo(() => {
    if (preset === 'custom') return custom;
    const days = PRESETS.find((p) => p[0] === preset)[2];
    return { from: addDays(todayIST(), -days), to: todayIST() };
  }, [preset, custom]);

  const customInvalid = preset === 'custom' && custom.from > custom.to;
  const query = { ...range, granularity, district };
  const { data, error, loading, reload } = useApi('/analytics/summary', query, { enabled: !customInvalid });
  useLiveRefresh(['encounter.'], reload, 1500);

  // Seed the trend chart with the three most frequent diagnoses, once.
  useEffect(() => {
    if (data && series.length === 0) setSeries(initialSeries(data.byDiagnosis.map((d) => d.code)));
  }, [data, series.length]);

  const labels = useMemo(() => Object.fromEntries((meta?.diagnoses ?? []).map((d) => [d.code, d.label])), [meta]);

  const t = data?.totals;
  const change = t && t.previousPeriodEncounters ? (t.encounters - t.previousPeriodEncounters) / t.previousPeriodEncounters : null;

  return (
    <>
      <PageHeader
        title="Health trends"
        subtitle={data ? `${formatDate(data.range.from)} – ${formatDate(data.range.to)}${data.range.district ? ` · ${data.range.district}` : ''}` : ' '}
        actions={loading && data ? <Spinner label="Updating" /> : null}
      />

      {/* Filters: one row above the charts */}
      <div className="card mb-5 flex flex-wrap items-end gap-3 p-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Date range">
          {[...PRESETS, ['custom', 'Custom']].map(([key, label]) => (
            <button
              key={key}
              className={`btn px-3 py-1.5 ${preset === key ? 'bg-accent-wash text-accent-ink' : 'text-ink-2 hover:bg-surface-2'}`}
              aria-pressed={preset === key}
              onClick={() => setPreset(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-muted">
              From
              <input type="date" className="input mt-0.5 py-1.5" max={todayIST()} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            </label>
            <label className="text-xs text-muted">
              To
              <input type="date" className="input mt-0.5 py-1.5" max={todayIST()} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </label>
          </div>
        )}
        <label className="text-xs text-muted">
          Group by
          <select className="input mt-0.5 py-1.5" value={granularity} onChange={(e) => setGranularity(e.target.value)}>
            <option value="auto">Auto</option>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          District
          <select className="input mt-0.5 py-1.5" value={district} onChange={(e) => setDistrict(e.target.value)}>
            <option value="">All districts</option>
            {meta?.districts.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
      </div>

      {customInvalid && <p className="mb-4 text-sm text-danger">“From” must be on or before “To”.</p>}
      <ErrorAlert error={error} onRetry={reload} />
      {!data && loading && <Spinner />}

      {data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile
              label="Encounters"
              value={formatNumber(t.encounters)}
              delta={change === null ? null : { up: change >= 0, text: `${Math.abs(Math.round(change * 100))}%` }}
              sub="vs previous period"
            />
            <StatTile label="Unique patients" value={formatNumber(t.patients)} />
            <StatTile label="Communicable" value={percent(t.communicable, t.encounters)} sub={`${formatNumber(t.communicable)} encounters`} />
            <StatTile label="Teleconsults" value={percent(t.teleconsults, t.encounters)} sub={`${formatNumber(t.teleconsults)} encounters`} />
            <StatTile label="Follow-ups due" value={formatNumber(t.followUpsNext7Days)} sub="next 7 days" />
          </div>

          <Panel title="Encounters over time" subtitle={`Per ${data.range.granularity}`}>
            {t.encounters === 0 ? <p className="py-10 text-center text-sm text-muted">No encounters in this period.</p> : <VolumeChart data={data.trend} granularity={data.range.granularity} />}
          </Panel>

          <Panel
            title="Disease trends"
            subtitle={`Compare up to ${MAX_SERIES} diagnoses`}
            actions={
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setShowTable((s) => !s)} aria-pressed={showTable}>
                {showTable ? 'Show chart' : 'Show table'}
              </button>
            }
          >
            <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Diagnoses to compare">
              {data.byDiagnosis.map((d) => {
                const sel = series.find((s) => s.code === d.code);
                const full = !sel && series.length >= MAX_SERIES;
                return (
                  <button
                    key={d.code}
                    disabled={full}
                    aria-pressed={Boolean(sel)}
                    onClick={() => setSeries((s) => toggleSeries(s, d.code))}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-40 ${
                      sel ? 'border-line-strong bg-surface-2 text-ink' : 'border-line text-ink-2 hover:bg-surface-2'
                    }`}
                  >
                    {sel && <span className="h-2 w-2 rounded-full" style={{ background: `var(--${SERIES_SLOTS[sel.slot]})` }} aria-hidden />}
                    {d.label}
                  </button>
                );
              })}
            </div>
            {series.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">Select a diagnosis to plot.</p>
            ) : showTable ? (
              <div className="max-h-72 overflow-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-line">
                      <th className="th">Period</th>
                      {series.map((s) => (
                        <th key={s.code} className="th text-right">
                          {labels[s.code]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.trend.map((row) => (
                      <tr key={row.period} className="border-b border-line last:border-0">
                        <td className="td">{formatPeriod(row.period, data.range.granularity)}</td>
                        {series.map((s) => (
                          <td key={s.code} className="td tabular text-right">
                            {row[s.code] ?? 0}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap gap-4 text-xs text-ink-2" aria-label="Legend">
                  {series.map((s) => (
                    <span key={s.code} className="inline-flex items-center gap-1.5">
                      <span className="h-0.5 w-4 rounded" style={{ background: `var(--${SERIES_SLOTS[s.slot]})` }} aria-hidden />
                      {labels[s.code] ?? s.code}
                    </span>
                  ))}
                </div>
                <TrendLines data={data.trend} series={series} labels={labels} granularity={data.range.granularity} />
              </>
            )}
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Diagnoses" subtitle="Encounters by diagnosis category">
              {data.byDiagnosis.length ? <HBarChart data={data.byDiagnosis} labelKey="label" /> : <p className="text-sm text-muted">No data.</p>}
            </Panel>
            <div className="space-y-5">
              <Panel title="Age groups" subtitle="Age at time of encounter">
                <ColumnChart data={data.byAgeBand} labelKey="band" height={200} />
              </Panel>
              <Panel title="Clinical risk flags" subtitle="Encounters with readings outside normal range">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ['High BP (≥140/90)', data.riskFlags.highBp],
                    ['High glucose (≥200 mg/dL)', data.riskFlags.highGlucose],
                    ['Fever (≥38 °C)', data.riskFlags.fever],
                    ['Low SpO₂ (<94%)', data.riskFlags.lowSpo2],
                  ].map(([label, n]) => (
                    <div key={label} className="rounded-lg bg-surface-2 px-3 py-2">
                      <dt className="text-xs text-muted">{label}</dt>
                      <dd className="mt-0.5 font-semibold">
                        {formatNumber(n)} <span className="text-xs font-normal text-muted">({percent(n, t.encounters)})</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </Panel>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Districts" subtitle="Encounters by patient's district">
              <HBarChart data={data.byDistrict} labelKey="district" />
            </Panel>
            <Panel title="Sex" subtitle="Share of encounters">
              <ul className="space-y-3">
                {data.bySex.map((s) => (
                  <li key={s.sex}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-ink-2">{SEX_LABEL[s.sex]}</span>
                      <span className="tabular font-medium">
                        {formatNumber(s.count)} · {percent(s.count, t.encounters)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-accent-wash">
                      <div className="h-2 rounded-full bg-accent" style={{ width: percent(s.count, t.encounters) }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
