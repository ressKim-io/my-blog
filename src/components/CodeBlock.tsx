'use client';

import { useState, useRef } from 'react';

interface CodeBlockProps {
  children: React.ReactNode;
  className?: string;
}

export default function CodeBlock({ children, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLPreElement>(null);

  const language = className?.replace('language-', '');

  const handleCopy = async () => {
    if (!codeRef.current) return;
    const code = codeRef.current.textContent ?? '';
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard 거부 시 silent */
    }
  };

  return (
    <div className="relative group">
      <pre ref={codeRef} className={className}>
        {children}
      </pre>
      <div className="absolute top-3 right-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {language && (
          <span className="text-[10.5px] font-mono uppercase tracking-wider text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-900/60 backdrop-blur">
            {language}
          </span>
        )}
        <button
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy code'}
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-mono backdrop-blur transition-colors ${
            copied
              ? 'bg-emerald-900/70 text-emerald-300'
              : 'bg-zinc-800/80 text-zinc-300 hover:text-white hover:bg-zinc-700'
          }`}
        >
          {copied ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
    </div>
  );
}
