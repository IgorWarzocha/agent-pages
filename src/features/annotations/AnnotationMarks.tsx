import type { Annotation } from './contract';

export function AnnotationMarks({ items, active, onSelect, width, height }: {
  items: Annotation[]; active?: string; onSelect: (id: string) => void; width: number; height: number;
}) {
  return <svg className="annotation-marks" width={width} height={height} aria-label="Page annotations">
    <defs><marker id="annotation-arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="none" stroke="currentColor" /></marker></defs>
    {items.map((item, index) => {
      const { x, y, width: markWidth, height: markHeight } = item.bounds;
      const points = item.points.map(point => `${point.x},${point.y}`).join(' ');
      const textWidth = Math.min(260, Math.max(1, width - 16));
      const textY = Math.max(8, Math.min(y + 16, height - 64));
      const textHeight = Math.min(180, Math.max(1, height - textY - 8));
      return <g key={item.id} className={item.id === active ? 'selected' : ''}>
        {item.kind === 'text'
          ? <foreignObject x={Math.max(8, Math.min(x, width - textWidth - 8))} y={textY} width={textWidth} height={textHeight}>
            <div className="annotation-text" style={{ maxHeight: textHeight }} data-annotation-ui role="button" tabIndex={0} aria-label={`Text annotation ${index + 1}: ${item.comment || 'Empty'}`} onClick={() => onSelect(item.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(item.id); } }}>{item.comment || 'Text'}</div>
          </foreignObject>
          : item.kind === 'arrow' || item.kind === 'draw'
          ? <polyline points={points} fill="none" markerEnd={item.kind === 'arrow' ? 'url(#annotation-arrowhead)' : undefined} />
          : <rect x={x} y={y} width={Math.max(2, markWidth)} height={Math.max(2, markHeight)} rx="3" />}
        <g className="annotation-pin" data-annotation-ui role="button" tabIndex={0} aria-label={`Annotation ${index + 1}: ${item.comment || item.kind}`} onClick={() => onSelect(item.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(item.id); } }} transform={`translate(${Math.max(12, x)},${Math.max(12, y)})`}>
          <circle r="12" /><text textAnchor="middle" dominantBaseline="central">{index + 1}</text>
        </g>
      </g>;
    })}
  </svg>;
}
