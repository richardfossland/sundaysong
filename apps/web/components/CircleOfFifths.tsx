"use client";

import { circleNodes, circlePositionOf } from "@/lib/keyFlowExplain";

/**
 * A lightweight circle-of-fifths visual for the flow page. Pure SVG, no deps.
 * The "flow from" key is highlighted, and any successor keys are marked so you
 * can SEE that smooth moves stay near the from-key while distant ones sit
 * across the ring. Geometry comes from the pure `circleNodes` helper.
 */
export function CircleOfFifths({
  fromKey,
  successorKeys = [],
}: {
  fromKey: string | null | undefined;
  successorKeys?: (string | null | undefined)[];
}) {
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const r = 84;
  const nodeR = 18;

  const nodes = circleNodes();
  const fromPos = circlePositionOf(fromKey);
  const successorPositions = new Set(
    successorKeys.map((k) => circlePositionOf(k)).filter((p): p is number => p !== null),
  );

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Circle of fifths${fromKey ? `, flowing from ${fromKey}` : ""}`}
      style={{ display: "block", margin: "0 auto" }}
    >
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--line)" strokeWidth={1} />
      {nodes.map((n) => {
        const x = cx + r * Math.sin(n.angle);
        const y = cy - r * Math.cos(n.angle);
        const isFrom = n.position === fromPos;
        const isSuccessor = !isFrom && successorPositions.has(n.position);
        const fill = isFrom ? "var(--ember)" : isSuccessor ? "var(--gold)" : "var(--paper-2)";
        const textFill = isFrom || isSuccessor ? "#fff" : "var(--ink-soft)";
        return (
          <g key={n.key}>
            {isFrom &&
              [...successorPositions].map((sp) => {
                const sn = nodes[sp]!;
                return (
                  <line
                    key={`spoke-${sp}`}
                    x1={x}
                    y1={y}
                    x2={cx + r * Math.sin(sn.angle)}
                    y2={cy - r * Math.cos(sn.angle)}
                    stroke="var(--gold)"
                    strokeWidth={1}
                    strokeOpacity={0.45}
                  />
                );
              })}
            <circle
              cx={x}
              cy={y}
              r={nodeR}
              fill={fill}
              stroke={isFrom ? "var(--ember-deep)" : "var(--line)"}
              strokeWidth={isFrom ? 2 : 1}
            />
            <text
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="var(--font-mono)"
              fontSize={11}
              fontWeight={isFrom ? 700 : 500}
              fill={textFill}
            >
              {n.key}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
