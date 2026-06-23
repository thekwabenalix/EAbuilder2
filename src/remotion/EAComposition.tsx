import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate, Easing, Sequence } from "remotion";

const MONO = '"JetBrains Mono","Cascadia Code","Fira Code","Courier New",monospace';

/* ── Utility sub-components ─────────────────────────────────── */

const WindowDot: React.FC<{ color: string }> = ({ color }) => (
  <div
    style={{
      width: 12,
      height: 12,
      borderRadius: "50%",
      background: color,
      opacity: 0.85,
      flexShrink: 0,
    }}
  />
);

/**
 * Single code line that fades up from its local sequence frame = 0.
 * Must be wrapped in <Sequence layout="none"> so useCurrentFrame()
 * resets to 0 at the sequence's start frame.
 */
const CodeLine: React.FC<{
  text: string;
  color: string;
  comment?: string;
}> = ({ text, color, comment }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1), // crisp ease-out
  });
  const translateY = interpolate(frame, [0, 14], [7, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        fontSize: 13,
        lineHeight: "2.2",
        fontFamily: MONO,
        whiteSpace: "pre",
      }}
    >
      <span style={{ color }}>{text}</span>
      {comment && <span style={{ color: "rgba(255,255,255,0.26)" }}>{comment}</span>}
    </div>
  );
};

/**
 * Typewriter comment — uses string slicing per Remotion best practices,
 * never per-character opacity.
 */
const TypewriterComment: React.FC<{ text: string; charsPerFrame: number }> = ({
  text,
  charsPerFrame,
}) => {
  const frame = useCurrentFrame();
  const count = Math.min(text.length, Math.floor(frame * charsPerFrame));
  const typed = text.slice(0, count);

  // Blinking cursor while typing
  const cursorOpacity = interpolate(frame % 18, [0, 9, 18], [1, 0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        fontSize: 13,
        lineHeight: "2.2",
        fontFamily: MONO,
        color: "rgba(255,255,255,0.27)",
        whiteSpace: "pre",
        marginBottom: 2,
      }}
    >
      {typed}
      {count < text.length && (
        <span style={{ opacity: cursorOpacity, color: "rgba(255,255,255,0.5)" }}>|</span>
      )}
    </div>
  );
};

/**
 * Brain status chip — uses global frame + startFrame prop so all
 * chips stay in the flex row from frame 0 (just invisible/scaled down).
 * Pops in with playful overshoot easing per the timing rules.
 */
const BrainChip: React.FC<{
  label: string;
  value: string;
  dotColor: string;
  bgColor: string;
  borderColor: string;
  startFrame: number;
}> = ({ label, value, dotColor, bgColor, borderColor, startFrame }) => {
  const frame = useCurrentFrame();

  const scale = interpolate(frame, [startFrame, startFrame + 18], [0.5, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.34, 1.56, 0.64, 1), // playful overshoot
  });
  const opacity = interpolate(frame, [startFrame, startFrame + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <div
      style={{
        flex: 1,
        background: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        padding: "8px 6px",
        textAlign: "center",
        transform: `scale(${scale})`,
        opacity,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: dotColor,
        }}
      />
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          color: dotColor,
          fontFamily: MONO,
          letterSpacing: "0.03em",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 9,
          color: "rgba(255,255,255,0.36)",
          fontFamily: MONO,
        }}
      >
        {label}
      </div>
    </div>
  );
};

/* ── Root composition (720 × 440 @ 30fps, 150 frames = 5s loop) ── */

export const EAComposition: React.FC = () => {
  const frame = useCurrentFrame();

  // "✓ compiled" fades in near the end
  const compiledOpacity = interpolate(frame, [108, 122], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(150deg, #07080e 0%, #05070f 100%)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* ── Window chrome ──────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "13px 20px",
          background: "rgba(255,255,255,0.025)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          flexShrink: 0,
        }}
      >
        <WindowDot color="#ff5f57" />
        <WindowDot color="#febc2e" />
        <WindowDot color="#28c840" />
        <span
          style={{
            marginLeft: 14,
            fontSize: 12,
            color: "rgba(255,255,255,0.27)",
            fontFamily: MONO,
            letterSpacing: "0.03em",
          }}
        >
          my_strategy.mq5
        </span>
        <div
          style={{
            marginLeft: "auto",
            fontSize: 11.5,
            color: "#10b981",
            fontFamily: MONO,
            opacity: compiledOpacity,
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          ✓ compiled · 0 errors
        </div>
      </div>

      {/* ── Code body ──────────────────────────────── */}
      <div style={{ flex: 1, padding: "18px 22px 10px", overflow: "hidden" }}>
        {/* Typewriter comment (3 chars/frame → ~16 frames to complete) */}
        <Sequence from={0} layout="none">
          <TypewriterComment
            text='// "EMA 50/200 cross + FVG on H1 → BOS entry"'
            charsPerFrame={3}
          />
        </Sequence>

        {/* Staggered code lines */}
        <Sequence from={14} layout="none">
          <CodeLine text="void OnTick() {" color="#e2e8f0" />
        </Sequence>
        <Sequence from={24} layout="none">
          <CodeLine
            text="  DirectionBrain_Update();"
            color="#e2e8f0"
            comment="  // EMA 50/200 bias"
          />
        </Sequence>
        <Sequence from={38} layout="none">
          <CodeLine text="  SetupBrain_Update();   " color="#e2e8f0" comment="  // FVG on H1" />
        </Sequence>
        <Sequence from={54} layout="none">
          <CodeLine text="  ExecBrain_Update();    " color="#e2e8f0" comment="  // BOS on M5" />
        </Sequence>
        <Sequence from={68} layout="none">
          <CodeLine text="  if (ConfluenceGate()) {" color="#93c5fd" />
        </Sequence>
        <Sequence from={76} layout="none">
          <CodeLine text="    ManageBrain_Execute();" color="#e2e8f0" comment="  // 1% risk, 2R" />
        </Sequence>
        <Sequence from={90} layout="none">
          <CodeLine text="  }" color="#e2e8f0" />
        </Sequence>
        <Sequence from={92} layout="none">
          <CodeLine text="}" color="#e2e8f0" />
        </Sequence>
      </div>

      {/* ── Brain chip row ─────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "10px 14px 14px",
          background: "rgba(0,0,0,0.38)",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}
      >
        <BrainChip
          label="Direction"
          value="BULL ↑"
          dotColor="#10b981"
          bgColor="rgba(16,185,129,0.1)"
          borderColor="rgba(16,185,129,0.28)"
          startFrame={30}
        />
        <BrainChip
          label="Setup"
          value="FVG Hit"
          dotColor="#60a5fa"
          bgColor="rgba(96,165,250,0.1)"
          borderColor="rgba(96,165,250,0.28)"
          startFrame={44}
        />
        <BrainChip
          label="Execution"
          value="BOS ✓"
          dotColor="#f87171"
          bgColor="rgba(248,113,113,0.1)"
          borderColor="rgba(248,113,113,0.28)"
          startFrame={60}
        />
        <BrainChip
          label="Trade"
          value="0.01 lot"
          dotColor="#fbbf24"
          bgColor="rgba(251,191,36,0.1)"
          borderColor="rgba(251,191,36,0.28)"
          startFrame={82}
        />
      </div>
    </AbsoluteFill>
  );
};
