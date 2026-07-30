import { useEffect, useMemo, useRef, useState } from 'react';
import { getUsersGrowth, type UsersGrowthPoint } from '../api';

const RANGES: Array<{ days: 7 | 30 | 90; label: string }> = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: 90, label: '90 дней' },
];

const VIEWBOX_WIDTH = 720;
const VIEWBOX_HEIGHT = 260;
const PLOT_LEFT = 46;
const PLOT_RIGHT = VIEWBOX_WIDTH - 16;
const PLOT_TOP = 16;
const PLOT_BOTTOM = VIEWBOX_HEIGHT - 30;
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT;
const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP;

/** Округляет шаг сетки Y до "красивого" числа (1/2/5 * 10^n) вместо произвольного деления диапазона. */
function niceStep(maxValue: number, targetTicks = 4): number {
  if (maxValue <= 0) return 1;
  const rough = maxValue / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const niceResidual = residual >= 5 ? 5 : residual >= 2 ? 2 : 1;
  return niceResidual * magnitude;
}

function formatShortDate(dateStr: string): string {
  // dateStr: YYYY-MM-DD
  return `${dateStr.slice(8, 10)}.${dateStr.slice(5, 7)}`;
}

function formatFullDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  });
}

export function UsersGrowthChart() {
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [series, setSeries] = useState<UsersGrowthPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    setError(null);
    setHoverIndex(null);
    getUsersGrowth(range)
      .then((res) => setSeries(res.series))
      .catch(() => setError('Не удалось загрузить график роста.'));
  }, [range]);

  const layout = useMemo(() => {
    if (!series || series.length === 0) return null;

    const maxTotal = Math.max(...series.map((p) => p.totalUsers), 1);
    const step = niceStep(maxTotal);
    const yMax = Math.max(Math.ceil(maxTotal / step) * step, step);
    const yTicks = [];
    for (let v = 0; v <= yMax; v += step) yTicks.push(v);

    const xForIndex = (i: number) =>
      series.length === 1 ? (PLOT_LEFT + PLOT_RIGHT) / 2 : PLOT_LEFT + (i / (series.length - 1)) * PLOT_WIDTH;
    const yForValue = (v: number) => PLOT_BOTTOM - (v / yMax) * PLOT_HEIGHT;

    const points = series.map((p, i) => ({ x: xForIndex(i), y: yForValue(p.totalUsers), point: p }));

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const areaPath =
      `M ${points[0]!.x.toFixed(1)} ${PLOT_BOTTOM} ` +
      points.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') +
      ` L ${points[points.length - 1]!.x.toFixed(1)} ${PLOT_BOTTOM} Z`;

    // Подписи по оси X: первая, последняя и несколько промежуточных — никогда не подписываем каждую точку.
    const labelEvery = Math.max(1, Math.ceil(series.length / 6));
    const xLabelIndexes = new Set<number>();
    for (let i = 0; i < series.length; i += labelEvery) xLabelIndexes.add(i);
    xLabelIndexes.add(series.length - 1);

    return { yTicks, yMax, points, linePath, areaPath, xLabelIndexes };
  }, [series]);

  function handlePointerMove(clientX: number) {
    if (!layout || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    const svgX = ratio * VIEWBOX_WIDTH;
    const clamped = Math.min(Math.max(svgX, PLOT_LEFT), PLOT_RIGHT);
    const idx = Math.round(((clamped - PLOT_LEFT) / PLOT_WIDTH) * (layout.points.length - 1));
    setHoverIndex(Math.min(Math.max(idx, 0), layout.points.length - 1));
  }

  const hovered = layout && hoverIndex !== null ? layout.points[hoverIndex] : null;
  const last = layout ? layout.points[layout.points.length - 1] : null;

  return (
    <section className="card">
      <div className="chart-header">
        <h2>Рост пользователей</h2>
        <div className="segmented segmented-compact">
          {RANGES.map((r) => (
            <button key={r.days} type="button" className={range === r.days ? 'active' : ''} onClick={() => setRange(r.days)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!error && !series && <p className="hint">Загрузка…</p>}

      {layout && (
        <div className="growth-chart-wrap">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
            className="growth-chart-svg"
            onMouseMove={(e) => handlePointerMove(e.clientX)}
            onMouseLeave={() => setHoverIndex(null)}
          >
            <defs>
              <linearGradient id="usersGrowthFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-violet)" stopOpacity="0.2" />
                <stop offset="100%" stopColor="var(--accent-violet)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {layout.yTicks.map((tick) => {
              const y = PLOT_BOTTOM - (tick / layout.yMax) * PLOT_HEIGHT;
              return (
                <g key={tick}>
                  <line x1={PLOT_LEFT} y1={y} x2={PLOT_RIGHT} y2={y} className="growth-chart-gridline" />
                  <text x={PLOT_LEFT - 8} y={y} dy="0.32em" textAnchor="end" className="growth-chart-axis-label">
                    {tick.toLocaleString('ru-RU')}
                  </text>
                </g>
              );
            })}

            {series?.map((p, i) =>
              layout.xLabelIndexes.has(i) ? (
                <text
                  key={p.date}
                  x={layout.points[i]!.x}
                  y={PLOT_BOTTOM + 20}
                  textAnchor="middle"
                  className="growth-chart-axis-label"
                >
                  {formatShortDate(p.date)}
                </text>
              ) : null,
            )}

            <path d={layout.areaPath} fill="url(#usersGrowthFill)" stroke="none" />
            <path d={layout.linePath} fill="none" className="growth-chart-line" />

            {last && (
              <circle cx={last.x} cy={last.y} r={5} className="growth-chart-end-dot" />
            )}

            {hovered && (
              <>
                <line
                  x1={hovered.x}
                  y1={PLOT_TOP}
                  x2={hovered.x}
                  y2={PLOT_BOTTOM}
                  className="growth-chart-crosshair"
                />
                <circle cx={hovered.x} cy={hovered.y} r={5} className="growth-chart-hover-dot" />
              </>
            )}

            <rect
              x={PLOT_LEFT}
              y={PLOT_TOP}
              width={PLOT_WIDTH}
              height={PLOT_HEIGHT}
              fill="transparent"
              onMouseMove={(e) => handlePointerMove(e.clientX)}
            />
          </svg>

          {hovered && (
            <div
              className="growth-chart-tooltip"
              style={{
                left: `${(hovered.x / VIEWBOX_WIDTH) * 100}%`,
                top: `${(hovered.y / VIEWBOX_HEIGHT) * 100}%`,
              }}
            >
              <div className="growth-chart-tooltip-value">{hovered.point.totalUsers.toLocaleString('ru-RU')}</div>
              <div className="growth-chart-tooltip-date">
                {formatFullDate(hovered.point.date)}
                {hovered.point.newUsers > 0 ? ` · +${hovered.point.newUsers} новых` : ''}
              </div>
            </div>
          )}
        </div>
      )}

      {series && series.length > 0 && (
        <p className="hint section-hint growth-chart-hint">
          Всего пользователей на конец периода: <strong>{series[series.length - 1]!.totalUsers}</strong>
        </p>
      )}
    </section>
  );
}
