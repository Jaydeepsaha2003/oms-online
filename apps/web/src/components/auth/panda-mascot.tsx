/**
 * Playful login mascot. The panda covers its eyes with its paws while you type a
 * hidden password, and peeks over them when you reveal it. Pure SVG + CSS
 * transitions (soft radial shading + drop shadows give it a 3D feel).
 */
export function PandaMascot({
  covering = false,
  peeking = false,
  looking = 'center',
  className,
}: {
  /** Password focused & hidden → paws fully over the eyes. */
  covering?: boolean;
  /** Password focused & revealed → paws lowered, eyes peek over the top. */
  peeking?: boolean;
  /** Nudge the pupils (e.g. glance down at the email while typing). */
  looking?: 'center' | 'down';
  className?: string;
}) {
  const pawY = covering ? -76 : peeking ? -42 : 0;
  const dy = looking === 'down' ? 4 : 0;
  const springy = 'transform 380ms cubic-bezier(.34,1.56,.64,1)';

  return (
    <svg viewBox="0 0 220 210" className={className} role="img" aria-label="Panda mascot">
      <defs>
        <radialGradient id="pHead" cx="42%" cy="34%" r="72%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e4e9ef" />
        </radialGradient>
        <radialGradient id="pBlack" cx="38%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#42424a" />
          <stop offset="100%" stopColor="#101014" />
        </radialGradient>
        <filter id="pShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#0f172a" floodOpacity="0.18" />
        </filter>
      </defs>

      {/* ground shadow */}
      <ellipse cx="110" cy="198" rx="54" ry="9" fill="#0f172a" opacity="0.12" />

      <g filter="url(#pShadow)">
        {/* ears */}
        <circle cx="64" cy="52" r="24" fill="url(#pBlack)" />
        <circle cx="156" cy="52" r="24" fill="url(#pBlack)" />
        <circle cx="64" cy="52" r="11" fill="#5a3a44" opacity="0.55" />
        <circle cx="156" cy="52" r="11" fill="#5a3a44" opacity="0.55" />

        {/* head */}
        <circle cx="110" cy="104" r="66" fill="url(#pHead)" stroke="#dbe1e8" strokeWidth="1" />

        {/* eye patches */}
        <g fill="url(#pBlack)">
          <ellipse cx="86" cy="100" rx="19" ry="25" transform="rotate(-16 86 100)" />
          <ellipse cx="134" cy="100" rx="19" ry="25" transform="rotate(16 134 100)" />
        </g>

        {/* eyes */}
        <g>
          <circle cx="90" cy="102" r="10" fill="#ffffff" />
          <circle cx="130" cy="102" r="10" fill="#ffffff" />
          <circle cx="90" cy={102 + dy} r="5" fill="#1b1b22" style={{ transition: 'cy 200ms ease' }} />
          <circle cx="130" cy={102 + dy} r="5" fill="#1b1b22" style={{ transition: 'cy 200ms ease' }} />
          <circle cx="87.5" cy="99.5" r="1.8" fill="#ffffff" />
          <circle cx="127.5" cy="99.5" r="1.8" fill="#ffffff" />
        </g>

        {/* nose + mouth */}
        <ellipse cx="110" cy="126" rx="8" ry="5.5" fill="#20202a" />
        <path d="M110 131 q -7 8 -15 3" stroke="#20202a" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <path d="M110 131 q 7 8 15 3" stroke="#20202a" strokeWidth="2.6" fill="none" strokeLinecap="round" />

        {/* cheeks */}
        <ellipse cx="72" cy="130" rx="9" ry="5" fill="#ffb3c1" opacity="0.55" />
        <ellipse cx="148" cy="130" rx="9" ry="5" fill="#ffb3c1" opacity="0.55" />
      </g>

      {/* paws — slide up to cover / peek */}
      <g style={{ transform: `translateY(${pawY}px)`, transition: springy }}>
        <g filter="url(#pShadow)">
          {/* left paw */}
          <ellipse cx="86" cy="178" rx="26" ry="30" fill="url(#pBlack)" />
          <ellipse cx="86" cy="166" rx="8.5" ry="6.5" fill="#ffc2cc" opacity="0.85" />
          <circle cx="77" cy="156" r="3.6" fill="#ffc2cc" opacity="0.85" />
          <circle cx="86" cy="152" r="3.6" fill="#ffc2cc" opacity="0.85" />
          <circle cx="95" cy="156" r="3.6" fill="#ffc2cc" opacity="0.85" />
          {/* right paw */}
          <ellipse cx="134" cy="178" rx="26" ry="30" fill="url(#pBlack)" />
          <ellipse cx="134" cy="166" rx="8.5" ry="6.5" fill="#ffc2cc" opacity="0.85" />
          <circle cx="125" cy="156" r="3.6" fill="#ffc2cc" opacity="0.85" />
          <circle cx="134" cy="152" r="3.6" fill="#ffc2cc" opacity="0.85" />
          <circle cx="143" cy="156" r="3.6" fill="#ffc2cc" opacity="0.85" />
        </g>
      </g>
    </svg>
  );
}

export default PandaMascot;
