import { useMemo, useRef, useState } from 'react';
import type { ServerCostMonthlyPoint } from '../api';

const RANGES: Array<{ months: 6 | 12; label: string }> = [
  { months: 6, label: '6 месяцев' },
  { months: 12, label: '12 месяцев' },
];

const VIEWBOX_WIDTH = 720;
const VIEWBOX_HEIGHT = 260;
const PLOT_LEFT = 56;
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

function formatMonthLabel(month: string): string {
  // month: YYYY-MM
  const date = new Date(`${month}-01T00:00:00`);
  return date.toLocaleDateString('ru-RU', { month: 'short' });
}

function formatFullMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00`);
  return date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

function formatRub(value: number): string {
  return `${value.toLocaleString('ru-RU')} ₽`;
}

export function ServerCostChart({
  data,
  range,
  onRangeChange,
  loading,
  error,
}: {
  data: ServerCostMonthlyPoint[] | null;
  range: 6 | 12;
  onRangeChange: (months: 6 | 12) => void;
  loading: boolean;
  error: string | null;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const layout = useMemo(() => {
    if (!data || data.length === 0) return null;

    const costRub = data[0]!.costRub;
    const maxValue = Math.max(...data.map((p) => p.revenueRub), costRub, 1);
    const step = niceStep(maxValue);
    const yMax = Math.max(Math.ceil(maxValue / step) * step, step);
    const yTicks: number[] = [];
    for (let v = 0; v <= yMax; v += step) yTicks.push(v);

    const yForValue = (v: number) => PLOT_BOTTOM - (v / yMax) * PLOT_HEIGHT;
    const columnWidth = PLOT_WIDTH / data.length;
    const barWidth = Math.min(columnWidth * 0.55, 40);

    const bars = data.map((p, i) => {
      const columnCenter = PLOT_LEFT + columnWidth * (i + 0.5);
      const barHeight = (p.revenueRub / yMax) * PLOT_HEIGHT;
      return {
        point: p,
        x: columnCenter - barWidth / 2,
        y: PLOT_BOTTOM - barHeight,
        width: barWidth,
        height: barHeight,
        columnCenter,
      };
    });

    return { yTicks, yMax, bars, costRub, yForValue, columnWidth };
  }, [data]);

  function handlePointerMove(clientX: number) {
    if (!layout || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    const svgX = ratio * VIEWBOX_WIDTH;
    const idx = Math.floor((svgX - PLOT_LEFT) / layout.columnWidth);
    setHoverIndex(Math.min(Math.max(idx, 0), layout.bars.length - 1));
  }

  const hovered = layout && hoverIndex !== null ? layout.bars[hoverIndex] : null;

  return (
    <section className="card">
      <div className="chart-header">
        <h2>Доход vs расходы на сервера</h2>
        <div className="segmented segmented-compact">
          {RANGES.map((r) => (
            <button
              key={r.months}
              type="button"
              className={range === r.months ? 'active' : ''}
              onClick={() => onRangeChange(r.months)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!error && loading && <p className="hint">Загрузка…</p>}

      {layout && (
        <div className="growth-chart-wrap">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
            className="growth-chart-svg"
            onMouseMove={(e) => handlePointerMove(e.clientX)}
            onMouseLeave={() => setHoverIndex(null)}
          >
            {layout.yTicks.map((tick) => {
              const y = layout.yForValue(tick);
              return (
                <g key={tick}>
                  <line x1={PLOT_LEFT} y1={y} x2={PLOT_RIGHT} y2={y} className="growth-chart-gridline" />
                  <text x={PLOT_LEFT - 8} y={y} dy="0.32em" textAnchor="end" className="growth-chart-axis-label">
                    {tick.toLocaleString('ru-RU')}
                  </text>
                </g>
              );
            })}

            {layout.bars.map((bar) => (
              <text
                key={bar.point.month}
                x={bar.columnCenter}
                y={PLOT_BOTTOM + 20}
                textAnchor="middle"
                className="growth-chart-axis-label"
              >
                {formatMonthLabel(bar.point.month)}
              </text>
            ))}

            {layout.bars.map((bar, i) => (
              <rect
                key={bar.point.month}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={Math.max(bar.height, 0)}
                rx={3}
                className={`cost-chart-bar${hoverIndex === i ? ' hovered' : ''}`}
              />
            ))}

            {layout.costRub > 0 && (
              <line
                x1={PLOT_LEFT}
                y1={layout.yForValue(layout.costRub)}
                x2={PLOT_RIGHT}
                y2={layout.yForValue(layout.costRub)}
                className="cost-chart-baseline"
              />
            )}

            {hovered && (
              <line
                x1={hovered.columnCenter}
                y1={PLOT_TOP}
                x2={hovered.columnCenter}
                y2={PLOT_BOTTOM}
                className="growth-chart-crosshair"
              />
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
                left: `${(hovered.columnCenter / VIEWBOX_WIDTH) * 100}%`,
                top: `${(hovered.y / VIEWBOX_HEIGHT) * 100}%`,
              }}
            >
              <div className="growth-chart-tooltip-value">{formatRub(hovered.point.revenueRub)}</div>
              <div className="growth-chart-tooltip-date">
                {formatFullMonth(hovered.point.month)}
                {layout.costRub > 0
                  ? ` · покрывает ${Math.round((hovered.point.revenueRub / layout.costRub) * 100)}% расходов`
                  : ''}
              </div>
            </div>
          )}
        </div>
      )}

      {layout && layout.costRub > 0 && (
        <p className="hint section-hint growth-chart-hint">
          Пунктир — текущие расходы на сервера в месяц: <strong>{formatRub(layout.costRub)}</strong>
        </p>
      )}
    </section>
  );
}
